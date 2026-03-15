use crate::proxy::ProxyManager;
use std::sync::Arc;
use std::time::Instant;
use tauri::State;

#[tauri::command]
pub async fn check_upstream_health(
    address: String,
    state: State<'_, Arc<ProxyManager>>,
) -> Result<u64, String> {
    let url = format!("http://{}/", address);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let start = Instant::now();
    client
        .head(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let latency = start.elapsed().as_millis() as u64;

    // Sync the successful probe back into the proxy's in-memory config so a
    // passively-marked "down" upstream is immediately revived in the engine.
    state.mark_upstream_up(&address).await;

    Ok(latency)
}
