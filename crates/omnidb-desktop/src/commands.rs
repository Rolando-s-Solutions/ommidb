use std::sync::Arc;
use tauri::State;

use omnidb_core::{
    ColumnValue, ConnectionConfig, ConnectionManager, DriverCapabilities, QueryResult,
    SchemaHierarchy, ServerDiagnostics, TableDetail,
};

pub struct AppState {
    pub manager: Arc<ConnectionManager>,
}

#[tauri::command]
pub async fn test_connection(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<ServerDiagnostics, String> {
    // Attempt ping with config
    let driver_result = match config.driver.to_lowercase().as_str() {
        "sqlite" => {
            let db_path = if config.database.is_empty() {
                ":memory:".to_string()
            } else {
                config.database.clone()
            };
            omnidb_core::drivers::sqlite::SqliteDriver::connect(&format!("sqlite://{}", db_path))
                .await
                .map_err(|e| e.to_string())?
        }
        _ => return Err(format!("Unsupported or unimplemented driver in test: {}", config.driver)),
    };

    use omnidb_core::DatabaseDriver;
    driver_result.ping().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn connect(
    config: ConnectionConfig,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .manager
        .connect(config, password.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn disconnect(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .manager
        .disconnect(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_capabilities(driver: String) -> Result<DriverCapabilities, String> {
    match driver.to_lowercase().as_str() {
        "sqlite" => Ok(DriverCapabilities::sqlite()),
        "postgres" | "postgresql" => Ok(DriverCapabilities::postgres()),
        "mysql" => Ok(DriverCapabilities::mysql()),
        "mongodb" => Ok(DriverCapabilities::mongodb()),
        other => Err(format!("Unknown driver: {}", other)),
    }
}

#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    state
        .manager
        .execute_query(&connection_id, &query, limit, offset)
        .await
        .map_err(|e| e.to_string())
}
