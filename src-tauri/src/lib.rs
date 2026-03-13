mod commands;
mod proxy;

use commands::{
    config::{get_config_path, validate_config, write_config},
    health::check_upstream_health,
    logs::start_log_tail,
    proxy::{get_proxy_status, reload_proxy},
};
use proxy::ProxyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let proxy_manager = ProxyManager::new();

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
        .manage(proxy_manager)
        .invoke_handler(tauri::generate_handler![
            write_config,
            get_config_path,
            validate_config,
            check_upstream_health,
            start_log_tail,
            reload_proxy,
            get_proxy_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ProxyGate");
}
