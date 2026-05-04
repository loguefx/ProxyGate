use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        ConnectInfo, FromRequestParts, Request, State,
    },
    response::{IntoResponse, Response},
    Router,
};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use http::{HeaderName, HeaderValue, StatusCode};
use hyper_util::rt::TokioIo;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::{connect_async, tungstenite::Message as TungsteniteMessage};
use tower::ServiceExt;

use crate::tls_manager::TlsManager;

// ─── Shared log event emitted after every proxied request ─────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogLine {
    pub timestamp: String,
    pub status: u16,
    pub method: String,
    pub host: String,
    pub path: String,
    #[serde(rename = "latencyMs")]
    pub latency_ms: u64,
}

// ─── Marker extension — set on requests that arrived via HTTPS ────────────────

#[derive(Clone, Copy)]
pub struct IsHttps;

// ─── Config types (camelCase to match frontend JSON) ──────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    #[serde(default = "default_http_port")]
    pub http_port: u16,
    #[serde(default = "default_https_port")]
    pub https_port: u16,
    #[serde(default)]
    pub tls_enabled: bool,
    #[serde(default)]
    pub routes: Vec<RouteEntry>,
    #[serde(default)]
    pub service_groups: Vec<ServiceGroupEntry>,
    /// Manual certs to pre-load into the SNI resolver on reload
    #[serde(default)]
    pub manual_certs: Vec<ManualCertEntry>,
}

fn default_http_port() -> u16 { 8080 }
fn default_https_port() -> u16 { 443 }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteEntry {
    pub id: String,
    pub hostname: String,
    pub service_group_id: String,
    pub enabled: bool,
    pub match_type: String,
    #[serde(default)]
    pub path_prefix: Option<String>,
    #[serde(default)]
    pub strip_path_prefix: bool,
    /// "acme" | "manual" | "redirect" | "none"
    #[serde(default = "default_tls_mode")]
    pub tls: String,
}

fn default_tls_mode() -> String { "none".to_string() }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualCertEntry {
    pub domain: String,
    pub cert_path: String,
    pub key_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceGroupEntry {
    pub id: String,
    pub load_balancer: String,
    /// "jellyfin" | "plex" → 6 h timeout + WebSocket
    /// "api"                → 30 s timeout
    /// "static" | "generic" → 5 min timeout (default)
    #[serde(default = "default_preset")]
    pub preset: String,
    pub upstreams: Vec<UpstreamEntry>,
}

fn default_preset() -> String { "generic".to_string() }

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamEntry {
    pub id: String,
    pub address: String,
    pub weight: u32,
    pub status: String,
}

// ─── ProxyManager ─────────────────────────────────────────────────────────────

pub struct ProxyManager {
    pub config: RwLock<ProxyConfig>,
    counters: RwLock<HashMap<String, Arc<AtomicUsize>>>,
    pub running: AtomicBool,
    pub port: AtomicUsize,
    pub last_error: RwLock<Option<String>>,
    server_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    https_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Shared HTTP client — connection-pooled, no global timeout (set per-preset)
    client: reqwest::Client,
    /// Broadcast channel for live request logs (capacity 2048)
    pub log_tx: broadcast::Sender<LogLine>,
    /// TLS engine — SNI resolver + ACME cert provisioner
    pub tls: Arc<TlsManager>,
}

impl ProxyManager {
    pub fn new(tls: Arc<TlsManager>) -> Arc<Self> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .tcp_keepalive(Duration::from_secs(60))
            .pool_max_idle_per_host(32)
            .build()
            .expect("Failed to build HTTP client");

        let (log_tx, _) = broadcast::channel(2048);

        Arc::new(Self {
            config: RwLock::new(ProxyConfig::default()),
            counters: RwLock::new(HashMap::new()),
            running: AtomicBool::new(false),
            port: AtomicUsize::new(0),
            last_error: RwLock::new(None),
            server_handle: Mutex::new(None),
            https_handle: Mutex::new(None),
            client,
            log_tx,
            tls,
        })
    }

    /// Update the live config; restart servers as needed.
    pub async fn reload(self: &Arc<Self>, mut new_config: ProxyConfig) {
        let new_http_port = new_config.http_port;
        let new_https_port = new_config.https_port;
        let tls_enabled = new_config.tls_enabled;
        let old_port = self.port.load(Ordering::Relaxed) as u16;

        // Reset passive health marks on every reload
        for group in new_config.service_groups.iter_mut() {
            for upstream in group.upstreams.iter_mut() {
                if upstream.status == "down" {
                    upstream.status = "unknown".to_string();
                }
            }
        }

        // Pre-load any manual certs declared in the config
        let manual_certs = new_config.manual_certs.clone();
        for mc in &manual_certs {
            let cert_path = std::path::PathBuf::from(&mc.cert_path);
            let key_path = std::path::PathBuf::from(&mc.key_path);
            if cert_path.exists() && key_path.exists() {
                if let Err(e) = self.tls.load_cert_from_files(&mc.domain, &cert_path, &key_path).await {
                    eprintln!("[ProxyGate TLS] Cannot load manual cert for {}: {}", mc.domain, e);
                }
            }
        }

        {
            let mut cfg = self.config.write().await;
            *cfg = new_config;
        }

        if new_http_port != old_port || !self.running.load(Ordering::Relaxed) {
            self.restart_http_server(new_http_port).await;
        }

        if tls_enabled && self.tls.has_certs() {
            self.restart_https_server(new_https_port).await;
        }
    }

    /// Mark an upstream as "up" in the live in-memory config.
    pub async fn mark_upstream_up(self: &Arc<Self>, address: &str) {
        let normalized = normalize_addr(address);
        let mut cfg = self.config.write().await;
        for group in cfg.service_groups.iter_mut() {
            for upstream in group.upstreams.iter_mut() {
                if normalize_addr(&upstream.address) == normalized {
                    upstream.status = "up".to_string();
                    eprintln!("[ProxyGate] Health check: marked upstream {} as up", upstream.address);
                }
            }
        }
    }

    async fn restart_http_server(self: &Arc<Self>, port: u16) {
        {
            let mut handle = self.server_handle.lock().await;
            if let Some(h) = handle.take() {
                h.abort();
                tokio::time::sleep(Duration::from_millis(80)).await;
            }
        }

        self.running.store(false, Ordering::Relaxed);
        self.port.store(port as usize, Ordering::Relaxed);

        let mgr = self.clone();
        let handle = tokio::spawn(async move {
            let addr = SocketAddr::from(([0, 0, 0, 0], port));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(listener) => {
                    mgr.running.store(true, Ordering::Relaxed);
                    {
                        let mut err = mgr.last_error.write().await;
                        *err = None;
                    }
                    println!("[ProxyGate] HTTP proxy listening on :{}", port);
                    let app = Router::new()
                        .fallback(proxy_handler)
                        .with_state(mgr.clone());
                    if let Err(e) = axum::serve(
                        listener,
                        app.into_make_service_with_connect_info::<SocketAddr>(),
                    )
                    .await
                    {
                        eprintln!("[ProxyGate] HTTP serve error: {}", e);
                    }
                    mgr.running.store(false, Ordering::Relaxed);
                }
                Err(e) => {
                    let msg = format!("Cannot bind HTTP port {}: {}", port, e);
                    eprintln!("[ProxyGate] {}", msg);
                    mgr.running.store(false, Ordering::Relaxed);
                    let mut err = mgr.last_error.write().await;
                    *err = Some(msg);
                }
            }
        });

        let mut h = self.server_handle.lock().await;
        *h = Some(handle);
    }

    async fn restart_https_server(self: &Arc<Self>, port: u16) {
        {
            let mut handle = self.https_handle.lock().await;
            if let Some(h) = handle.take() {
                h.abort();
                tokio::time::sleep(Duration::from_millis(80)).await;
            }
        }

        let server_config = match self.tls.build_server_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[ProxyGate TLS] Cannot build TLS config: {}", e);
                return;
            }
        };

        let acceptor = TlsAcceptor::from(Arc::new(server_config));
        let mgr = self.clone();

        let handle = tokio::spawn(async move {
            let addr = SocketAddr::from(([0, 0, 0, 0], port));
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => {
                    println!("[ProxyGate] HTTPS proxy listening on :{}", port);
                    l
                }
                Err(e) => {
                    eprintln!("[ProxyGate TLS] Cannot bind HTTPS port {}: {}", port, e);
                    return;
                }
            };

            let app = Router::new()
                .fallback(proxy_handler)
                .with_state(mgr.clone());

            loop {
                let (tcp_stream, peer_addr) = match listener.accept().await {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[ProxyGate TLS] Accept error: {}", e);
                        continue;
                    }
                };

                let acceptor = acceptor.clone();
                let app = app.clone();

                tokio::spawn(async move {
                    let tls_stream = match acceptor.accept(tcp_stream).await {
                        Ok(s) => s,
                        Err(_) => return, // normal for rejected/invalid TLS handshakes
                    };

                    let io = TokioIo::new(tls_stream);

                    let svc = hyper::service::service_fn(move |mut req: hyper::Request<hyper::body::Incoming>| {
                        req.extensions_mut().insert(ConnectInfo(peer_addr));
                        req.extensions_mut().insert(IsHttps);
                        let app = app.clone();
                        async move {
                            let req = req.map(axum::body::Body::new);
                            app.oneshot(req).await
                        }
                    });

                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(io, svc)
                        .with_upgrades()
                        .await;
                });
            }
        });

        let mut h = self.https_handle.lock().await;
        *h = Some(handle);
    }

    async fn get_counter(self: &Arc<Self>, group_id: &str) -> Arc<AtomicUsize> {
        {
            let counters = self.counters.read().await;
            if let Some(c) = counters.get(group_id) {
                return c.clone();
            }
        }
        let mut counters = self.counters.write().await;
        counters
            .entry(group_id.to_string())
            .or_insert_with(|| Arc::new(AtomicUsize::new(0)))
            .clone()
    }
}

// ─── Request handler ──────────────────────────────────────────────────────────

async fn proxy_handler(
    State(mgr): State<Arc<ProxyManager>>,
    req: Request,
) -> Response {
    let start = Instant::now();

    let is_https = req.extensions().get::<IsHttps>().is_some();

    // Real client IP — present for both HTTP (ConnectInfo) and HTTPS (injected)
    let client_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
        .unwrap_or_default();

    let method = req.method().to_string();
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .map(|h| h.split(':').next().unwrap_or(h).to_lowercase())
        .unwrap_or_default();

    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());

    // ── ACME HTTP-01 challenge — must be served on HTTP, before routing ────────
    if !is_https && path.starts_with("/.well-known/acme-challenge/") {
        let token = path.trim_start_matches("/.well-known/acme-challenge/");
        let challenges = mgr.tls.acme_challenges.read().await;
        if let Some(key_auth) = challenges.get(token) {
            return (StatusCode::OK, key_auth.clone()).into_response();
        }
        // No matching token — fall through to normal routing
    }

    let is_ws = req
        .headers()
        .get("upgrade")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);

    // ── Route lookup ──────────────────────────────────────────────────────────

    let (upstream_addr, strip_prefix, preset, route_tls) = {
        let cfg = mgr.config.read().await;

        let route = cfg
            .routes
            .iter()
            .find(|r| r.enabled && route_matches(r, &host));

        let route = match route {
            None => {
                // No route matched — serve the local discovery landing page
                let page = build_landing_page(&cfg, &host);
                return emit_and_return(
                    &mgr,
                    (StatusCode::OK, [("content-type", "text/html; charset=utf-8")], page)
                        .into_response(),
                    start, 200, method, host, path,
                );
            }
            Some(r) => r,
        };

        // ── HTTP → HTTPS redirect for non-"none" TLS routes ──────────────────
        if !is_https && route.tls != "none" {
            let location = format!("https://{}{}", host, path);
            return emit_and_return(
                &mgr,
                (
                    StatusCode::MOVED_PERMANENTLY,
                    [(http::header::LOCATION, location)],
                )
                    .into_response(),
                start, 301, method, host, path,
            );
        }

        let group = cfg
            .service_groups
            .iter()
            .find(|g| g.id == route.service_group_id);

        let group = match group {
            None => {
                return emit_and_return(
                    &mgr,
                    err_response(StatusCode::BAD_GATEWAY, "[ProxyGate] Service group not found"),
                    start, 502, method, host, path,
                );
            }
            Some(g) => g,
        };

        let healthy: Vec<&UpstreamEntry> =
            group.upstreams.iter().filter(|u| u.status != "down").collect();

        if healthy.is_empty() {
            return emit_and_return(
                &mgr,
                err_response(StatusCode::BAD_GATEWAY, "[ProxyGate] No healthy upstreams"),
                start, 502, method, host, path,
            );
        }

        let upstream = select_upstream(&mgr, group, &healthy).await;
        let strip = if route.strip_path_prefix { route.path_prefix.clone() } else { None };

        (upstream.address.clone(), strip, group.preset.clone(), route.tls.clone())
        // read lock drops here
    };

    if is_ws {
        let resp = forward_websocket(req, &upstream_addr, strip_prefix.as_deref()).await;
        emit_log(&mgr, start, 101, &method, &host, &path);
        return resp;
    }

    let proto = if is_https { "https" } else { "http" };
    let resp = forward(
        req,
        &upstream_addr,
        strip_prefix.as_deref(),
        &mgr.client,
        &preset,
        &client_ip,
        &mgr,
        proto,
    )
    .await;

    let status = resp.status().as_u16();
    let _ = route_tls; // used for redirect logic above; suppress unused warning
    emit_log(&mgr, start, status, &method, &host, &path);
    resp
}

// ─── Landing page — served when no route matches (e.g. IP:port direct access) ─

fn build_landing_page(cfg: &ProxyConfig, _host: &str) -> String {
    let rows: String = cfg
        .routes
        .iter()
        .filter(|r| r.enabled)
        .map(|route| {
            let scheme = if route.tls == "none" { "http" } else { "https" };
            let domain_link = format!("{}://{}", scheme, route.hostname);

            // Find upstream address for the direct "test" link
            let upstream = cfg
                .service_groups
                .iter()
                .find(|g| g.id == route.service_group_id)
                .and_then(|g| g.upstreams.first())
                .map(|u| u.address.clone())
                .unwrap_or_default();

            let direct_url = if upstream.starts_with("http") {
                upstream.clone()
            } else if !upstream.is_empty() {
                format!("http://{}", upstream)
            } else {
                String::new()
            };

            let tls_badge = match route.tls.as_str() {
                "acme" => r#"<span class="badge green">ACME</span>"#,
                "manual" => r#"<span class="badge blue">Manual TLS</span>"#,
                "redirect" => r#"<span class="badge amber">Redirect</span>"#,
                _ => r#"<span class="badge grey">HTTP</span>"#,
            };

            let direct_cell = if direct_url.is_empty() {
                "—".to_string()
            } else {
                format!(r#"<a href="{}" target="_blank">{}</a>"#, direct_url, direct_url)
            };

            format!(
                r#"<tr>
                  <td><a href="{}" target="_blank">{}</a></td>
                  <td>{}</td>
                  <td>{}</td>
                </tr>"#,
                domain_link, route.hostname, tls_badge, direct_cell
            )
        })
        .collect();

    let empty_msg = if cfg.routes.iter().all(|r| !r.enabled) {
        r#"<tr><td colspan="3" class="empty">No routes configured yet. Open ProxyGate to add routes.</td></tr>"#.to_string()
    } else {
        rows
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ProxyGate</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}}
  .card{{background:#1a1d27;border:1px solid #2d3148;border-radius:12px;width:100%;max-width:740px;overflow:hidden}}
  .header{{padding:20px 24px;border-bottom:1px solid #2d3148;display:flex;align-items:center;gap:12px}}
  .logo{{width:32px;height:32px;background:linear-gradient(135deg,#6c63ff,#3dd68c);border-radius:8px}}
  h1{{font-size:16px;font-weight:700;color:#f1f5f9}}
  .sub{{font-size:12px;color:#64748b;margin-top:2px}}
  table{{width:100%;border-collapse:collapse}}
  th{{padding:10px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#64748b;text-align:left;border-bottom:1px solid #2d3148}}
  td{{padding:11px 16px;font-size:12.5px;border-bottom:1px solid #1e2235}}
  tr:last-child td{{border-bottom:none}}
  tr:hover td{{background:#1e2235}}
  a{{color:#818cf8;text-decoration:none}}
  a:hover{{text-decoration:underline}}
  .badge{{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600}}
  .badge.green{{background:#0d2b1a;color:#3dd68c}}
  .badge.blue{{background:#0d1f35;color:#60a5fa}}
  .badge.amber{{background:#2d1f05;color:#f59e0b}}
  .badge.grey{{background:#1e2235;color:#94a3b8}}
  .empty{{text-align:center;color:#475569;padding:28px!important}}
  .footer{{padding:12px 24px;font-size:11px;color:#475569;border-top:1px solid #2d3148}}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="logo"></div>
    <div>
      <h1>ProxyGate</h1>
      <div class="sub">Active routes — direct access via private network</div>
    </div>
  </div>
  <table>
    <thead>
      <tr><th>Domain</th><th>TLS</th><th>Backend (direct)</th></tr>
    </thead>
    <tbody>{}</tbody>
  </table>
  <div class="footer">HTTP port {} &nbsp;·&nbsp; HTTPS port {} &nbsp;·&nbsp; ProxyGate reverse proxy</div>
</div>
</body>
</html>"#,
        empty_msg,
        cfg.http_port,
        cfg.https_port,
    )
}

// ─── Logging helpers ──────────────────────────────────────────────────────────

fn emit_log(mgr: &Arc<ProxyManager>, start: Instant, status: u16, method: &str, host: &str, path: &str) {
    let _ = mgr.log_tx.send(LogLine {
        timestamp: Utc::now().to_rfc3339(),
        status,
        method: method.to_string(),
        host: host.to_string(),
        path: path.to_string(),
        latency_ms: start.elapsed().as_millis() as u64,
    });
}

fn emit_and_return(
    mgr: &Arc<ProxyManager>,
    resp: Response,
    start: Instant,
    status: u16,
    method: String,
    host: String,
    path: String,
) -> Response {
    emit_log(mgr, start, status, &method, &host, &path);
    resp
}

fn route_matches(route: &RouteEntry, host: &str) -> bool {
    route.hostname.to_lowercase() == host
}

// ─── Load balancing ───────────────────────────────────────────────────────────

async fn select_upstream<'a>(
    mgr: &Arc<ProxyManager>,
    group: &ServiceGroupEntry,
    healthy: &[&'a UpstreamEntry],
) -> &'a UpstreamEntry {
    let counter = mgr.get_counter(&group.id).await;
    match group.load_balancer.as_str() {
        "weighted" => {
            let total: u32 = healthy.iter().map(|u| u.weight.max(1)).sum();
            let n = (counter.fetch_add(1, Ordering::Relaxed) % total as usize) as u32;
            let mut cum = 0u32;
            for u in healthy {
                cum += u.weight.max(1);
                if n < cum { return u; }
            }
            healthy[0]
        }
        _ => {
            let idx = counter.fetch_add(1, Ordering::Relaxed) % healthy.len();
            healthy[idx]
        }
    }
}

// ─── HTTP forwarding ──────────────────────────────────────────────────────────

const HOP_BY_HOP: &[&str] = &[
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "proxy-connection",
];

fn preset_timeout(preset: &str) -> Duration {
    match preset {
        "jellyfin" | "plex" => Duration::from_secs(6 * 3600),
        "api" => Duration::from_secs(30),
        _ => Duration::from_secs(300),
    }
}

#[allow(clippy::too_many_arguments)]
async fn forward(
    req: Request,
    upstream: &str,
    strip_prefix: Option<&str>,
    client: &Client,
    preset: &str,
    client_ip: &str,
    mgr: &Arc<ProxyManager>,
    forwarded_proto: &str,
) -> Response {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let uri = req.uri().clone();

    let path_query = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let path_query = match strip_prefix {
        Some(pfx) if path_query.starts_with(pfx) => {
            let rest = &path_query[pfx.len()..];
            if rest.is_empty() { "/" } else { rest }
        }
        _ => path_query,
    };

    let target = if upstream.starts_with("http://") || upstream.starts_with("https://") {
        format!("{}{}", upstream.trim_end_matches('/'), path_query)
    } else {
        format!("http://{}{}", upstream, path_query)
    };

    let req_method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);

    let body_stream = req.into_body().into_data_stream();
    let reqwest_body = reqwest::Body::wrap_stream(body_stream);

    let mut rb = client
        .request(req_method, &target)
        .body(reqwest_body)
        .timeout(preset_timeout(preset));

    for (name, value) in &headers {
        let n = name.as_str();
        if !HOP_BY_HOP.contains(&n) && n != "host" {
            rb = rb.header(n, value.as_bytes());
        }
    }

    if let Some(host_val) = headers.get("host") {
        rb = rb.header("x-forwarded-host", host_val.as_bytes());
    }
    rb = rb.header("x-forwarded-proto", forwarded_proto);

    if !client_ip.is_empty() {
        let xff = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .map(|existing| format!("{}, {}", existing, client_ip))
            .unwrap_or_else(|| client_ip.to_string());
        rb = rb.header("x-forwarded-for", &xff);
        rb = rb.header("x-real-ip", client_ip);
    }

    match rb.send().await {
        Err(e) => {
            if e.is_connect() || e.is_timeout() {
                mark_upstream_down(mgr, upstream).await;
            }
            err_response(
                StatusCode::BAD_GATEWAY,
                &format!("[ProxyGate] Upstream error: {}", e),
            )
        }
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let mut builder = axum::response::Response::builder().status(status);

            for (name, value) in resp.headers() {
                if !HOP_BY_HOP.contains(&name.as_str()) {
                    if let (Ok(n), Ok(v)) = (
                        HeaderName::from_bytes(name.as_str().as_bytes()),
                        HeaderValue::from_bytes(value.as_bytes()),
                    ) {
                        builder = builder.header(n, v);
                    }
                }
            }

            let stream = resp.bytes_stream();
            builder
                .body(axum::body::Body::from_stream(stream))
                .unwrap_or_else(|_| err_response(StatusCode::INTERNAL_SERVER_ERROR, "Body build failed"))
        }
    }
}

async fn mark_upstream_down(mgr: &Arc<ProxyManager>, failed_addr: &str) {
    let normalized = normalize_addr(failed_addr);
    let mut cfg = mgr.config.write().await;
    for group in cfg.service_groups.iter_mut() {
        for upstream in group.upstreams.iter_mut() {
            if normalize_addr(&upstream.address) == normalized {
                upstream.status = "down".to_string();
                eprintln!("[ProxyGate] Passively marked upstream {} as down", upstream.address);
            }
        }
    }
}

fn normalize_addr(addr: &str) -> String {
    addr.trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string()
}

// ─── WebSocket tunneling ───────────────────────────────────────────────────────

async fn forward_websocket(
    req: Request,
    upstream: &str,
    strip_prefix: Option<&str>,
) -> Response {
    let uri = req.uri().clone();
    let path_query = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let path_query = match strip_prefix {
        Some(pfx) if path_query.starts_with(pfx) => {
            let rest = &path_query[pfx.len()..];
            if rest.is_empty() { "/" } else { rest }
        }
        _ => path_query,
    };

    let ws_url = if upstream.starts_with("https://") {
        format!("wss://{}{}", &upstream[8..].trim_end_matches('/'), path_query)
    } else if upstream.starts_with("http://") {
        format!("ws://{}{}", &upstream[7..].trim_end_matches('/'), path_query)
    } else {
        format!("ws://{}{}", upstream.trim_end_matches('/'), path_query)
    };

    let (mut parts, _body) = req.into_parts();
    match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
        Err(e) => e.into_response(),
        Ok(wsu) => wsu
            .on_upgrade(move |client_ws| bridge_websocket(client_ws, ws_url))
            .into_response(),
    }
}

async fn bridge_websocket(client_ws: WebSocket, upstream_url: String) {
    let upstream_ws = match connect_async(&upstream_url).await {
        Ok((ws, _)) => ws,
        Err(e) => {
            eprintln!("[ProxyGate] WS upstream connect failed ({}): {}", upstream_url, e);
            return;
        }
    };

    let (mut client_tx, mut client_rx) = client_ws.split();
    let (mut upstream_tx, mut upstream_rx) = upstream_ws.split();

    let c2u = tokio::spawn(async move {
        while let Some(Ok(msg)) = client_rx.next().await {
            let tmsg = match msg {
                WsMessage::Text(s) => TungsteniteMessage::Text(s.into()),
                WsMessage::Binary(b) => TungsteniteMessage::Binary(b.into()),
                WsMessage::Ping(b) => TungsteniteMessage::Ping(b.into()),
                WsMessage::Pong(b) => TungsteniteMessage::Pong(b.into()),
                WsMessage::Close(_) => break,
            };
            if upstream_tx.send(tmsg).await.is_err() { break; }
        }
    });

    let u2c = tokio::spawn(async move {
        while let Some(Ok(msg)) = upstream_rx.next().await {
            let amsg = match msg {
                TungsteniteMessage::Text(s) => WsMessage::Text(s.to_string()),
                TungsteniteMessage::Binary(b) => WsMessage::Binary(b.into()),
                TungsteniteMessage::Ping(b) => WsMessage::Ping(b.to_vec()),
                TungsteniteMessage::Pong(b) => WsMessage::Pong(b.to_vec()),
                TungsteniteMessage::Close(_) | TungsteniteMessage::Frame(_) => break,
            };
            if client_tx.send(amsg).await.is_err() { break; }
        }
    });

    tokio::select! { _ = c2u => {} _ = u2c => {} }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn err_response(status: StatusCode, msg: &str) -> Response {
    (status, msg.to_string()).into_response()
}
