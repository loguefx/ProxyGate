use std::{
    collections::HashMap,
    io::BufReader,
    path::PathBuf,
    sync::{Arc, RwLock},
    time::Duration,
};

use chrono::Utc;
use rcgen::{CertificateParams, KeyPair};
use rustls::{
    crypto::ring::sign::any_supported_type,
    server::{ClientHello, ResolvesServerCert},
    sign::CertifiedKey,
    ServerConfig,
};
use rustls_pemfile::{certs, private_key};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::RwLock as AsyncRwLock;
use x509_parser::prelude::*;

// ─── Public cert info returned to the frontend ────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertInfo {
    pub domain: String,
    pub issuer: String,
    pub expires_at: String,
    pub days_remaining: i64,
    pub status: String, // "valid" | "expiring" | "expired"
}

// ─── SNI resolver — looks up the right cert per incoming hostname ─────────────

struct DynamicCertResolver {
    /// Sync RwLock because ResolvesServerCert::resolve is sync
    certs: Arc<RwLock<HashMap<String, Arc<CertifiedKey>>>>,
}

impl ResolvesServerCert for DynamicCertResolver {
    fn resolve(&self, client_hello: ClientHello) -> Option<Arc<CertifiedKey>> {
        let sni = client_hello.server_name()?;
        let map = self.certs.read().ok()?;
        map.get(sni).cloned()
    }
}

// ─── TlsManager ───────────────────────────────────────────────────────────────

pub struct TlsManager {
    cert_map: Arc<RwLock<HashMap<String, Arc<CertifiedKey>>>>,
    resolver: Arc<DynamicCertResolver>,
    /// ACME HTTP-01 challenge tokens — shared with the HTTP proxy handler
    pub acme_challenges: Arc<AsyncRwLock<HashMap<String, String>>>,
    /// Directory where cert/key PEM files live
    pub cert_dir: PathBuf,
}

impl TlsManager {
    pub fn new(cert_dir: PathBuf) -> Arc<Self> {
        let cert_map = Arc::new(RwLock::new(HashMap::new()));
        let resolver = Arc::new(DynamicCertResolver { certs: cert_map.clone() });
        Arc::new(Self {
            cert_map,
            resolver,
            acme_challenges: Arc::new(AsyncRwLock::new(HashMap::new())),
            cert_dir,
        })
    }

    /// Build a rustls ServerConfig using this manager's SNI resolver.
    pub fn build_server_config(&self) -> Result<ServerConfig, rustls::Error> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()?
            .with_no_client_auth()
            .with_cert_resolver(self.resolver.clone());
        Ok(config)
    }

    /// Returns true if at least one certificate is loaded (HTTPS server is usable).
    pub fn has_certs(&self) -> bool {
        self.cert_map.read().map(|m| !m.is_empty()).unwrap_or(false)
    }

    /// Load a cert/key pair from PEM bytes and register it for `domain`.
    pub fn load_cert_from_pem(
        &self,
        domain: &str,
        cert_pem: &[u8],
        key_pem: &[u8],
    ) -> Result<(), String> {
        let cert_chain = certs(&mut BufReader::new(cert_pem))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to parse cert PEM: {}", e))?;

        if cert_chain.is_empty() {
            return Err("No certificates found in PEM".into());
        }

        let key = private_key(&mut BufReader::new(key_pem))
            .map_err(|e| format!("Failed to read private key: {}", e))?
            .ok_or_else(|| "No private key found in PEM".to_string())?;

        let signing_key = any_supported_type(&key)
            .map_err(|e| format!("Unsupported key type: {}", e))?;

        let certified = Arc::new(CertifiedKey::new(cert_chain, signing_key));

        let mut map = self.cert_map.write().map_err(|e| e.to_string())?;
        map.insert(domain.to_string(), certified);
        Ok(())
    }

    /// Load a cert/key pair from files on disk and register it for `domain`.
    pub async fn load_cert_from_files(
        &self,
        domain: &str,
        cert_path: &PathBuf,
        key_path: &PathBuf,
    ) -> Result<(), String> {
        let cert_pem = tokio::fs::read(cert_path)
            .await
            .map_err(|e| format!("Cannot read cert file {}: {}", cert_path.display(), e))?;
        let key_pem = tokio::fs::read(key_path)
            .await
            .map_err(|e| format!("Cannot read key file {}: {}", key_path.display(), e))?;
        self.load_cert_from_pem(domain, &cert_pem, &key_pem)
    }

    /// Write PEM bytes to disk and load into the SNI resolver.
    pub async fn write_and_load_cert(
        &self,
        domain: &str,
        cert_pem: &str,
        key_pem: &str,
    ) -> Result<(PathBuf, PathBuf), String> {
        tokio::fs::create_dir_all(&self.cert_dir)
            .await
            .map_err(|e| format!("Cannot create cert dir: {}", e))?;

        let cert_path = self.cert_dir.join(format!("{}.crt", sanitize_domain(domain)));
        let key_path = self.cert_dir.join(format!("{}.key", sanitize_domain(domain)));

        tokio::fs::write(&cert_path, cert_pem.as_bytes())
            .await
            .map_err(|e| format!("Cannot write cert: {}", e))?;
        tokio::fs::write(&key_path, key_pem.as_bytes())
            .await
            .map_err(|e| format!("Cannot write key: {}", e))?;

        self.load_cert_from_pem(domain, cert_pem.as_bytes(), key_pem.as_bytes())?;
        Ok((cert_path, key_path))
    }

    /// Scan cert_dir for `{domain}.crt` / `{domain}.key` pairs and load them all.
    pub async fn reload_all_from_disk(&self) {
        let Ok(mut entries) = tokio::fs::read_dir(&self.cert_dir).await else {
            return;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("crt") {
                continue;
            }
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let key_path = self.cert_dir.join(format!("{}.key", stem));
            if key_path.exists() {
                let domain = stem.replace('_', ".");
                if let Err(e) = self.load_cert_from_files(&domain, &path, &key_path).await {
                    eprintln!("[ProxyGate TLS] Failed to load cert for {}: {}", domain, e);
                } else {
                    eprintln!("[ProxyGate TLS] Loaded cert for {}", domain);
                }
            }
        }
    }

    /// Read cert info (issuer, expiry) for a loaded domain.
    pub fn get_cert_info(&self, domain: &str) -> Option<CertInfo> {
        let map = self.cert_map.read().ok()?;
        let ck = map.get(domain)?;
        let der = ck.cert.first()?.as_ref();

        let (_, cert) = X509Certificate::from_der(der).ok()?;
        let not_after = cert.validity().not_after.timestamp();
        let now = Utc::now().timestamp();
        let days = (not_after - now) / 86_400;
        let expires_at = chrono::DateTime::from_timestamp(not_after, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();

        let issuer = cert
            .issuer()
            .iter_common_name()
            .next()
            .and_then(|cn| cn.as_str().ok())
            .unwrap_or("Unknown")
            .to_string();

        let status = if days < 0 {
            "expired"
        } else if days < 30 {
            "expiring"
        } else {
            "valid"
        }
        .to_string();

        Some(CertInfo {
            domain: domain.to_string(),
            issuer,
            expires_at,
            days_remaining: days,
            status,
        })
    }

    /// Remove a cert from the in-memory SNI resolver and delete its files.
    pub async fn remove_cert(&self, domain: &str) -> Result<(), String> {
        {
            let mut map = self.cert_map.write().map_err(|e| e.to_string())?;
            map.remove(domain);
        }
        let stem = sanitize_domain(domain);
        let cert_path = self.cert_dir.join(format!("{}.crt", stem));
        let key_path = self.cert_dir.join(format!("{}.key", stem));
        let _ = tokio::fs::remove_file(&cert_path).await;
        let _ = tokio::fs::remove_file(&key_path).await;
        Ok(())
    }

    // ─── ACME / Let's Encrypt ─────────────────────────────────────────────────

    /// Provision a certificate via Let's Encrypt HTTP-01 ACME.
    ///
    /// Progress events are emitted on `app_handle` under the event name
    /// `"acme-progress"` with a JSON payload `{ domain, step, message }`.
    ///
    /// Requires port 80 to be publicly reachable for the HTTP-01 challenge.
    pub async fn provision_acme_cert(
        self: &Arc<Self>,
        domain: String,
        email: String,
        app_handle: tauri::AppHandle,
    ) -> Result<CertInfo, String> {
        use instant_acme::{
            Account, ChallengeType, Identifier, NewAccount, NewOrder, OrderStatus,
        };

        let emit = |step: &str, msg: &str| {
            let _ = app_handle.emit(
                "acme-progress",
                serde_json::json!({ "domain": domain, "step": step, "message": msg }),
            );
        };

        emit("start", "Contacting Let's Encrypt…");

        // Create ACME account (or reuse if credentials file exists)
        let creds_path = self.cert_dir.join(format!("{}_acme_creds.json", sanitize_domain(&domain)));
        let account = if creds_path.exists() {
            let json = tokio::fs::read_to_string(&creds_path)
                .await
                .map_err(|e| format!("Cannot read ACME credentials: {}", e))?;
            let creds: instant_acme::AccountCredentials = serde_json::from_str(&json)
                .map_err(|e| format!("Cannot parse ACME credentials: {}", e))?;
            Account::from_credentials(creds)
                .await
                .map_err(|e| format!("Cannot restore ACME account: {}", e))?
        } else {
            tokio::fs::create_dir_all(&self.cert_dir)
                .await
                .map_err(|e| format!("Cannot create cert dir: {}", e))?;

            let (account, credentials) = Account::create(
                &NewAccount {
                    contact: &[&format!("mailto:{}", email)],
                    terms_of_service_agreed: true,
                    only_return_existing: false,
                },
                "https://acme-v02.api.letsencrypt.org/directory",
                None,
            )
            .await
            .map_err(|e| format!("Cannot create ACME account: {}", e))?;

            let creds_json = serde_json::to_string(&credentials)
                .map_err(|e| format!("Cannot serialize credentials: {}", e))?;
            tokio::fs::write(&creds_path, creds_json)
                .await
                .map_err(|e| format!("Cannot save credentials: {}", e))?;

            account
        };

        emit("order", "Creating certificate order…");

        let mut order = account
            .new_order(&NewOrder {
                identifiers: &[Identifier::Dns(domain.clone())],
            })
            .await
            .map_err(|e| format!("Cannot create ACME order: {}", e))?;

        emit("challenge", "Fetching HTTP-01 challenge…");

        let authorizations = order
            .authorizations()
            .await
            .map_err(|e| format!("Cannot fetch authorizations: {}", e))?;

        for auth in &authorizations {
            let challenge = auth
                .challenges
                .iter()
                .find(|c| matches!(c.r#type, ChallengeType::Http01))
                .ok_or_else(|| "No HTTP-01 challenge available. Ensure port 80 is reachable.".to_string())?;

            let key_auth = order
                .key_authorization(challenge)
                .as_str()
                .to_string();

            emit(
                "challenge",
                &format!("Serving challenge token {}…", &challenge.token),
            );

            // Store challenge — the HTTP proxy handler will serve it
            {
                let mut tokens = self.acme_challenges.write().await;
                tokens.insert(challenge.token.clone(), key_auth);
            }

            // Tell ACME server to validate
            order
                .set_challenge_ready(&challenge.url)
                .await
                .map_err(|e| format!("Cannot mark challenge ready: {}", e))?;
        }

        emit("validate", "Waiting for ACME validation…");

        // Poll until order is ready (up to 60 seconds)
        for attempt in 0..30 {
            tokio::time::sleep(Duration::from_secs(2)).await;
            order
                .refresh()
                .await
                .map_err(|e| format!("Cannot refresh order: {}", e))?;

            match order.state().status {
                OrderStatus::Ready => break,
                OrderStatus::Invalid => {
                    // Clear challenges
                    self.acme_challenges.write().await.clear();
                    return Err(
                        "ACME validation failed. Check that port 80 is publicly reachable.".into(),
                    );
                }
                _ => {
                    if attempt == 29 {
                        self.acme_challenges.write().await.clear();
                        return Err("ACME validation timed out after 60 seconds.".into());
                    }
                }
            }
        }

        // Clear challenge tokens — no longer needed
        self.acme_challenges.write().await.clear();

        emit("finalize", "Generating key and finalizing order…");

        // Generate private key + CSR
        let mut params = CertificateParams::new(vec![domain.clone()])
            .map_err(|e| format!("Cannot create cert params: {}", e))?;
        params.distinguished_name = rcgen::DistinguishedName::new();
        let key_pair = KeyPair::generate()
            .map_err(|e| format!("Cannot generate key pair: {}", e))?;
        let csr = params
            .serialize_request(&key_pair)
            .map_err(|e| format!("Cannot build CSR: {}", e))?;

        order
            .finalize(csr.der())
            .await
            .map_err(|e| format!("Cannot finalize order: {}", e))?;

        // Wait for certificate to be issued (up to 30 seconds)
        let cert_chain_pem = loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            order
                .refresh()
                .await
                .map_err(|e| format!("Cannot refresh order: {}", e))?;

            if matches!(order.state().status, OrderStatus::Valid) {
                break order
                    .certificate()
                    .await
                    .map_err(|e| format!("Cannot download certificate: {}", e))?
                    .ok_or_else(|| "Certificate not available after validation".to_string())?;
            }
        };

        let key_pem = key_pair.serialize_pem();

        emit("save", "Saving certificate…");

        let (cert_path, key_path) = self
            .write_and_load_cert(&domain, &cert_chain_pem, &key_pem)
            .await?;

        eprintln!(
            "[ProxyGate TLS] ACME cert for {} saved to {}",
            domain,
            cert_path.display()
        );

        let info = self
            .get_cert_info(&domain)
            .unwrap_or_else(|| CertInfo {
                domain: domain.clone(),
                issuer: "Let's Encrypt".to_string(),
                expires_at: chrono::Utc::now()
                    .checked_add_signed(chrono::Duration::days(90))
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default(),
                days_remaining: 90,
                status: "valid".to_string(),
            });

        emit("done", "Certificate issued successfully!");

        // Also save key path reference for renewal use (stored alongside creds)
        let _ = tokio::fs::write(
            self.cert_dir.join(format!("{}_key.pem", sanitize_domain(&domain))),
            &key_pem,
        )
        .await;

        Ok(info)
    }

    /// Background renewal task — checks all ACME certs daily and renews
    /// those expiring within 30 days.
    pub fn spawn_renewal_task(self: &Arc<Self>, email: String, app_handle: tauri::AppHandle) {
        let mgr = self.clone();
        tokio::spawn(async move {
            loop {
                // Check once per day
                tokio::time::sleep(Duration::from_secs(86_400)).await;

                let domains: Vec<String> = {
                    let Ok(map) = mgr.cert_map.read() else { continue };
                    map.keys().cloned().collect()
                };

                for domain in domains {
                    if let Some(info) = mgr.get_cert_info(&domain) {
                        if info.days_remaining < 30 {
                            eprintln!("[ProxyGate TLS] Renewing cert for {} ({} days left)", domain, info.days_remaining);
                            let _ = mgr
                                .provision_acme_cert(domain.clone(), email.clone(), app_handle.clone())
                                .await;
                        }
                    }
                }
            }
        });
    }
}

// Replace '*' and other characters that can't be in filenames
fn sanitize_domain(domain: &str) -> String {
    domain.replace('*', "wildcard").replace('/', "_").replace('\\', "_")
}
