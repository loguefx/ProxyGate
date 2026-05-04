mod commands;
mod proxy;
mod tls_manager;

use commands::{
    config::{get_config_path, validate_config, write_config},
    health::check_upstream_health,
    logs::start_log_tail,
    proxy::{get_proxy_status, reload_proxy},
    tls::{get_cert_dir, get_cert_info, provision_acme_cert, reload_tls, remove_cert, write_manual_cert},
};
use proxy::ProxyManager;
use tls_manager::TlsManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:proxygate.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "initial schema",
                            sql: include_str!("db/migrations/001_initial.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "add preset to service_groups",
                            sql: include_str!("db/migrations/002_add_preset.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .setup(|app| {
            // Resolve the app data directory for cert storage
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let cert_dir = data_dir.join("certs");

            let tls = TlsManager::new(cert_dir);
            let proxy_manager = ProxyManager::new(tls.clone());

            // Load any existing certs from disk so they're ready on startup
            let mgr = proxy_manager.clone();
            tauri::async_runtime::spawn(async move {
                mgr.tls.reload_all_from_disk().await;
            });

            app.manage(proxy_manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_config,
            get_config_path,
            validate_config,
            check_upstream_health,
            start_log_tail,
            reload_proxy,
            get_proxy_status,
            write_manual_cert,
            provision_acme_cert,
            get_cert_info,
            remove_cert,
            reload_tls,
            get_cert_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ProxyGate");
}
