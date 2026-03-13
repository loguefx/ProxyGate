use crate::proxy::ProxyManager;
use std::sync::Arc;

fn debug_log(location: &str, message: &str, extra: &str) {
    use std::io::Write;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("C:\\Users\\Logan\\Documents\\ProxyGate\\debug-f9f24b.log")
    {
        let _ = writeln!(
            f,
            r#"{{"sessionId":"f9f24b","location":"{location}","message":"{message}","data":{{{extra}}},"timestamp":{ts}}}"#,
        );
    }
}

/// Subscribe to the proxy's live log broadcast and forward entries to the
/// frontend as `log-line` Tauri events.  Called once on app startup.
#[tauri::command]
pub async fn start_log_tail(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ProxyManager>>,
) -> Result<(), String> {
    use tauri::Emitter;
    // #region agent log - H-A: command reached Rust
    debug_log("logs.rs:start_log_tail", "command invoked, subscribing", "\"hypothesisId\":\"H-A\"");
    // #endregion

    let mut rx = state.log_tx.subscribe();

    // #region agent log - H-B: subscription created
    debug_log("logs.rs:start_log_tail", "subscribed to broadcast channel", "\"hypothesisId\":\"H-B\"");
    // #endregion

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(entry) => {
                    // #region agent log - H-B: message received from proxy
                    debug_log(
                        "logs.rs:recv",
                        "received log entry, calling app.emit",
                        "\"hypothesisId\":\"H-B\"",
                    );
                    // #endregion
                    let emit_result = app.emit("log-line", entry);
                    // #region agent log - H-B: emit result
                    debug_log(
                        "logs.rs:emit",
                        "app.emit result",
                        &format!("\"ok\":{}", emit_result.is_ok()),
                    );
                    // #endregion
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("[ProxyGate] Log channel lagged, skipped {} entries", n);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    Ok(())
}

