use std::path::Path;
use tauri::Manager;

#[tauri::command]
pub async fn write_config(yaml: String, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, yaml.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_config_path(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(data_dir
        .join("traefik.yml")
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn validate_config(yaml: String) -> Result<bool, String> {
    // Basic YAML structure check — full traefik --configFile validation
    // requires traefik binary; here we do a minimal parse check
    if yaml.is_empty() {
        return Err("Config is empty".to_string());
    }
    if yaml.contains("entryPoints:") {
        Ok(true)
    } else {
        Err("Missing entryPoints in config".to_string())
    }
}
