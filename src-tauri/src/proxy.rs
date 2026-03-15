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
use tokio_tungstenite::{connect_async, tungstenite::Message as TungsteniteMessage};

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

// ─── Config types (camelCase to match frontend JSON) ──────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    #[serde(default = "default_port")]
    pub http_port: u16,
    #[serde(default)]
    pub routes: Vec<RouteEntry>,
    #[serde(default)]
    pub service_groups: Vec<ServiceGroupEntry>,
}

fn default_port() -> u16 {
    8080
}

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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceGroupEntry {
    pub id: String,
    pub load_balancer: String,
    /// Preset controls timeout and streaming behaviour:
    /// "jellyfin" | "plex" → 6-hour timeout + WebSocket
    /// "api"                → 30-second timeout
    /// "static" | "generic" → 5-minute timeout (default)
    #[serde(default = "default_preset")]
    pub preset: String,
    pub upstreams: Vec<UpstreamEntry>,
}

fn default_preset() -> String {
    "generic".to_string()
}

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
    /// Shared HTTP client — connection-pooled, no global timeout (set per-preset)
    client: reqwest::Client,
    /// Broadcast channel for live request logs (capacity 2048)
    pub log_tx: broadcast::Sender<LogLine>,
}

impl ProxyManager {
    pub fn new() -> Arc<Self> {
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
            client,
            log_tx,
        })
    }

    /// Update the live config; restart server if port changed or not yet running.
    pub async fn reload(self: &Arc<Self>, mut new_config: ProxyConfig) {
        let new_port = new_config.http_port;
        let old_port = self.port.load(Ordering::Relaxed) as u16;

        // Reset passive health marks — "down" is a runtime observation, not a
        // persistent state. Every config reload gives all upstreams a clean start.
        for group in new_config.service_groups.iter_mut() {
            for upstream in group.upstreams.iter_mut() {
                if upstream.status == "down" {
                    upstream.status = "unknown".to_string();
                }
            }
        }

        {
            let mut cfg = self.config.write().await;
            *cfg = new_config;
        }

        if new_port != old_port || !self.running.load(Ordering::Relaxed) {
            self.restart_server(new_port).await;
        }
    }

    /// Mark an upstream as "up" in the live in-memory config.
    /// Called by the health-check command when a probe succeeds.
    pub async fn mark_upstream_up(self: &Arc<Self>, address: &str) {
        let normalized = address
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .trim_end_matches('/');

        let mut cfg = self.config.write().await;
        for group in cfg.service_groups.iter_mut() {
            for upstream in group.upstreams.iter_mut() {
                let addr = upstream
                    .address
                    .trim_start_matches("http://")
                    .trim_start_matches("https://")
                    .trim_end_matches('/');
                if addr == normalized {
                    upstream.status = "up".to_string();
                    eprintln!("[ProxyGate] Health check: marked upstream {} as up", upstream.address);
                }
            }
        }
    }

    async fn restart_server(self: &Arc<Self>, port: u16) {
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

                    // ConnectInfo injects real client IPs into request extensions
                    if let Err(e) = axum::serve(
                        listener,
                        app.into_make_service_with_connect_info::<SocketAddr>(),
                    )
                    .await
                    {
                        eprintln!("[ProxyGate] Proxy serve error: {}", e);
                    }

                    mgr.running.store(false, Ordering::Relaxed);
                }
                Err(e) => {
                    let msg = format!("Cannot bind port {}: {}", port, e);
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

    // Real client IP from TCP layer (ConnectInfo injected by into_make_service_with_connect_info)
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

    let is_ws = req
        .headers()
        .get("upgrade")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);

    let (upstream_addr, strip_prefix, preset) = {
        let cfg = mgr.config.read().await;

        let route = cfg
            .routes
            .iter()
            .find(|r| r.enabled && route_matches(r, &host));

        let route = match route {
            None => {
                return emit_and_return(
                    &mgr,
                    err_response(
                        StatusCode::NOT_FOUND,
                        &format!("[ProxyGate] No route configured for host: {}", host),
                    ),
                    start,
                    404,
                    method,
                    host,
                    path,
                );
            }
            Some(r) => r,
        };

        let group = cfg
            .service_groups
            .iter()
            .find(|g| g.id == route.service_group_id);

        let group = match group {
            None => {
                return emit_and_return(
                    &mgr,
                    err_response(StatusCode::BAD_GATEWAY, "[ProxyGate] Service group not found"),
                    start,
                    502,
                    method,
                    host,
                    path,
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
                start,
                502,
                method,
                host,
                path,
            );
        }

        let upstream = select_upstream(&mgr, group, &healthy).await;

        let strip = if route.strip_path_prefix {
            route.path_prefix.clone()
        } else {
            None
        };

        (upstream.address.clone(), strip, group.preset.clone())
        // read lock drops here
    };

    if is_ws {
        // Log WebSocket upgrades with status 101
        let resp = forward_websocket(req, &upstream_addr, strip_prefix.as_deref()).await;
        emit_log(&mgr, start, 101, &method, &host, &path);
        return resp;
    }

    let resp = forward(
        req,
        &upstream_addr,
        strip_prefix.as_deref(),
        &mgr.client,
        &preset,
        &client_ip,
        &mgr,
    )
    .await;

    let status = resp.status().as_u16();
    emit_log(&mgr, start, status, &method, &host, &path);
    resp
}

/// Emit a log entry to the broadcast channel (non-fatal if no subscribers).
fn emit_log(mgr: &Arc<ProxyManager>, start: Instant, status: u16, method: &str, host: &str, path: &str) {
    // #region agent log - H-D: proxy handler reached emit_log
    {
        use std::io::Write;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true)
            .open("C:\\Users\\Logan\\Documents\\ProxyGate\\debug-f9f24b.log")
        {
            let _ = writeln!(f,
                r#"{{"sessionId":"f9f24b","location":"proxy.rs:emit_log","message":"emit_log called","data":{{"status":{status},"method":"{method}","host":"{host}","path":"{path}","hypothesisId":"H-D"}},"timestamp":{ts}}}"#);
        }
    }
    // #endregion

    let result = mgr.log_tx.send(LogLine {
        timestamp: Utc::now().to_rfc3339(),
        status,
        method: method.to_string(),
        host: host.to_string(),
        path: path.to_string(),
        latency_ms: start.elapsed().as_millis() as u64,
    });

    // #region agent log - H-E: broadcast send result
    {
        use std::io::Write;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true)
            .open("C:\\Users\\Logan\\Documents\\ProxyGate\\debug-f9f24b.log")
        {
            let ok = result.is_ok();
            let receivers = result.as_ref().map(|n| *n as i64).unwrap_or(-1);
            let _ = writeln!(f,
                r#"{{"sessionId":"f9f24b","location":"proxy.rs:emit_log","message":"broadcast send result","data":{{"ok":{ok},"receiverCount":{receivers},"hypothesisId":"H-E"}},"timestamp":{ts}}}"#);
        }
    }
    // #endregion
}

/// Shorthand for early-return responses that also emit a log entry.
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
                if n < cum {
                    return u;
                }
            }
            healthy[0]
        }
        "ip-hash" => {
            let idx = counter.fetch_add(1, Ordering::Relaxed) % healthy.len();
            healthy[idx]
        }
        _ => {
            let idx = counter.fetch_add(1, Ordering::Relaxed) % healthy.len();
            healthy[idx]
        }
    }
}

// ─── HTTP forwarding ──────────────────────────────────────────────────────────

const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "proxy-connection",
];

fn preset_timeout(preset: &str) -> Duration {
    match preset {
        "jellyfin" | "plex" => Duration::from_secs(6 * 3600),
        "api" => Duration::from_secs(30),
        _ => Duration::from_secs(300),
    }
}

async fn forward(
    req: Request,
    upstream: &str,
    strip_prefix: Option<&str>,
    client: &Client,
    preset: &str,
    client_ip: &str,
    mgr: &Arc<ProxyManager>,
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

    let req_method =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET);

    let body_stream = req.into_body().into_data_stream();
    let reqwest_body = reqwest::Body::wrap_stream(body_stream);

    let mut rb = client
        .request(req_method, &target)
        .body(reqwest_body)
        .timeout(preset_timeout(preset));

    // Forward non-hop-by-hop headers
    for (name, value) in &headers {
        let n = name.as_str();
        if !HOP_BY_HOP.contains(&n) && n != "host" {
            rb = rb.header(n, value.as_bytes());
        }
    }

    // Forwarded-for metadata — append to existing XFF or set fresh
    if let Some(host_val) = headers.get("host") {
        rb = rb.header("x-forwarded-host", host_val.as_bytes());
    }
    rb = rb.header("x-forwarded-proto", "http");

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
            // Passive health: mark upstream down in-memory immediately on connection failure
            if e.is_connect() || e.is_timeout() {
                mark_upstream_down(mgr, upstream).await;
            }
            err_response(
                StatusCode::BAD_GATEWAY,
                &format!("[ProxyGate] Upstream error: {}", e),
            )
        }
        Ok(resp) => {
            let status =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
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

            // Stream response body — no buffering, zero extra latency
            let stream = resp.bytes_stream();
            builder
                .body(axum::body::Body::from_stream(stream))
                .unwrap_or_else(|_| {
                    err_response(StatusCode::INTERNAL_SERVER_ERROR, "Body build failed")
                })
        }
    }
}

/// Mark an upstream as "down" in the live in-memory config.
/// The health-check command will restore it when the upstream recovers.
async fn mark_upstream_down(mgr: &Arc<ProxyManager>, failed_addr: &str) {
    let normalized = failed_addr
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_end_matches('/');

    let mut cfg = mgr.config.write().await;
    for group in cfg.service_groups.iter_mut() {
        for upstream in group.upstreams.iter_mut() {
            let addr = upstream
                .address
                .trim_start_matches("http://")
                .trim_start_matches("https://")
                .trim_end_matches('/');
            if addr == normalized {
                upstream.status = "down".to_string();
                eprintln!("[ProxyGate] Passively marked upstream {} as down", upstream.address);
            }
        }
    }
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
            if upstream_tx.send(tmsg).await.is_err() {
                break;
            }
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
            if client_tx.send(amsg).await.is_err() {
                break;
            }
        }
    });

    tokio::select! {
        _ = c2u => {}
        _ = u2c => {}
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn err_response(status: StatusCode, msg: &str) -> Response {
    (status, msg.to_string()).into_response()
}
