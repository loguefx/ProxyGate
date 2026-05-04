use crate::proxy::ProxyManager;
use crate::tls_manager::CertInfo;
use std::sync::Arc;

/// Write PEM bytes to disk, load into the SNI resolver, and return the
/// file paths so the frontend can persist them in the DB.
#[tauri::command]
pub async fn write_manual_cert(
    state: tauri::State<'_, Arc<ProxyManager>>,
    domain: String,
    cert_pem: String,
    key_pem: String,
) -> Result<(String, String), String> {
    let (cert_path, key_path) = state
        .tls
        .write_and_load_cert(&domain, &cert_pem, &key_pem)
        .await?;

    Ok((
        cert_path.to_string_lossy().to_string(),
        key_path.to_string_lossy().to_string(),
    ))
}

/// Provision a certificate from Let's Encrypt via HTTP-01 ACME.
/// Progress is emitted as `"acme-progress"` Tauri events during the process.
/// Returns the resulting CertInfo on success.
#[tauri::command]
pub async fn provision_acme_cert(
    state: tauri::State<'_, Arc<ProxyManager>>,
    app_handle: tauri::AppHandle,
    domain: String,
    email: String,
) -> Result<CertInfo, String> {
    state
        .tls
        .provision_acme_cert(domain, email, app_handle)
        .await
}

/// Return cert info (issuer, expiry, status) for a domain that has a loaded cert.
#[tauri::command]
pub async fn get_cert_info(
    state: tauri::State<'_, Arc<ProxyManager>>,
    domain: String,
) -> Result<Option<CertInfo>, String> {
    Ok(state.tls.get_cert_info(&domain))
}

/// Remove a cert from the SNI resolver and delete its files from disk.
#[tauri::command]
pub async fn remove_cert(
    state: tauri::State<'_, Arc<ProxyManager>>,
    domain: String,
) -> Result<(), String> {
    state.tls.remove_cert(&domain).await
}

/// Force-reload all certs from the cert directory on disk into the SNI resolver.
/// Useful after manually copying cert files.
#[tauri::command]
pub async fn reload_tls(
    state: tauri::State<'_, Arc<ProxyManager>>,
) -> Result<(), String> {
    state.tls.reload_all_from_disk().await;
    Ok(())
}

/// Return the cert directory path so the frontend can display it.
#[tauri::command]
pub async fn get_cert_dir(
    state: tauri::State<'_, Arc<ProxyManager>>,
) -> Result<String, String> {
    Ok(state.tls.cert_dir.to_string_lossy().to_string())
}
