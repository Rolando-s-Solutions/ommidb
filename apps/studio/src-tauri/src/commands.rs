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
    _state: State<'_, AppState>,
) -> Result<ServerDiagnostics, String> {
    match config.driver.to_lowercase().as_str() {
        "sqlite" => {
            let db_path = if config.database.is_empty() {
                ":memory:".to_string()
            } else {
                config.database.clone()
            };
            let driver = omnidb_core::drivers::sqlite::SqliteDriver::connect(&format!("sqlite://{}", db_path))
                .await
                .map_err(|e| e.to_string())?;
            use omnidb_core::DatabaseDriver;
            driver.ping().await.map_err(|e| e.to_string())
        }
        "postgres" | "postgresql" => {
            let pw = config.password_encrypted.as_deref().unwrap_or_default();
            let driver = omnidb_core::drivers::postgres::PostgresDriver::connect_with_options(
                &config.host,
                config.port,
                &config.user,
                pw,
                &config.database,
                config.use_tls,
            )
            .await
            .map_err(|e| e.to_string())?;
            use omnidb_core::DatabaseDriver;
            driver.ping().await.map_err(|e| e.to_string())
        }
        _ => Err(format!("Unsupported driver: {}", config.driver)),
    }
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
pub async fn fetch_schema_tree(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<SchemaHierarchy, String> {
    state
        .manager
        .fetch_schema_tree(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn introspect_table(
    connection_id: String,
    schema: Option<String>,
    table: Option<String>,
    state: State<'_, AppState>,
) -> Result<TableDetail, String> {
    let t = table.unwrap_or_default();
    state
        .manager
        .introspect_table(&connection_id, schema.as_deref(), &t)
        .await
        .map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn update_cell(
    connection_id: String,
    _schema: Option<String>,
    table: String,
    pk_column: String,
    _pk_value: ColumnValue,
    target_column: String,
    _new_value: ColumnValue,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Basic update dispatch
    let q = format!(
        "UPDATE {} SET {} = ... WHERE {} = ...",
        table, target_column, pk_column
    );
    state
        .manager
        .execute_query(&connection_id, &q, Some(1), None)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct MoveTableSchemaResult {
    pub success: bool,
    pub executed_sql: String,
}

#[tauri::command]
pub async fn move_table_schema(
    connection_id: String,
    current_schema: String,
    table: String,
    target_schema: String,
    state: State<'_, AppState>,
) -> Result<MoveTableSchemaResult, String> {
    let sql = state
        .manager
        .move_table_schema(&connection_id, &current_schema, &table, &target_schema)
        .await
        .map_err(|e| e.to_string())?;

    Ok(MoveTableSchemaResult {
        success: true,
        executed_sql: sql,
    })
}

#[tauri::command]
pub async fn export_backup(
    connection_id: String,
    tables: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state
        .manager
        .export_backup(&connection_id, tables)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_backup(
    connection_id: String,
    sql_script: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .manager
        .restore_backup(&connection_id, &sql_script)
        .await
        .map_err(|e| e.to_string())
}
