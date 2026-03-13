use crate::proxy::{ProxyConfig, ProxyManager};
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::Ordering;

#[derive(Serialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub port: u16,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn reload_proxy(
    state: tauri::State<'_, Arc<ProxyManager>>,
    config: ProxyConfig,
) -> Result<(), String> {
    state.reload(config).await;
    Ok(())
}

#[tauri::command]
pub async fn get_proxy_status(
    state: tauri::State<'_, Arc<ProxyManager>>,
) -> Result<ProxyStatus, String> {
    let running = state.running.load(Ordering::Relaxed);
    let port = state.port.load(Ordering::Relaxed) as u16;
    let error = state.last_error.read().await.clone();
    Ok(ProxyStatus { running, port, error })
}
