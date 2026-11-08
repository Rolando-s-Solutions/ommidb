pub mod commands;

use std::sync::Arc;
use omnidb_core::ConnectionManager;
use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app_state = AppState {
    manager: Arc::new(ConnectionManager::new()),
  };

  tauri::Builder::default()
    .manage(app_state)
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build(),
    )
    .invoke_handler(tauri::generate_handler![
      commands::test_connection,
      commands::connect,
      commands::disconnect,
      commands::get_capabilities,
      commands::fetch_schema_tree,
      commands::introspect_table,
      commands::execute_query,
      commands::update_cell,
      commands::move_table_schema,
      commands::export_backup,
      commands::restore_backup,
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
