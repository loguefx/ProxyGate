use std::time::Instant;

#[tauri::command]
pub async fn check_upstream_health(address: String) -> Result<u64, String> {
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

    Ok(start.elapsed().as_millis() as u64)
}
