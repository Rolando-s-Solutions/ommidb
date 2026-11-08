pub mod storage;

use std::sync::Arc;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use omnidb_core::{
    ColumnValue, ConnectionConfig, ConnectionManager, DatabaseDriver, DriverCapabilities,
    QueryResult, SchemaHierarchy, ServerDiagnostics, TableDetail,
};
use storage::AppStore;

struct ServerState {
    manager: Arc<ConnectionManager>,
    store: Arc<AppStore>,
}

#[derive(Deserialize)]
struct ConnectPayload {
    config: ConnectionConfig,
    password: Option<String>,
}

#[derive(Deserialize)]
struct BackupPayload {
    tables: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct RestorePayload {
    sql_script: String,
}

#[derive(Deserialize)]
struct MoveSchemaPayload {
    current_schema: String,
    table: String,
    target_schema: String,
}

#[derive(Deserialize)]
struct QueryPayload {
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
}

#[derive(Deserialize)]
struct UpdateCellPayload {
    schema: Option<String>,
    table: String,
    pk_column: String,
    pk_value: ColumnValue,
    target_column: String,
    new_value: ColumnValue,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let store = Arc::new(
        AppStore::init("omnidb_app.sqlite")
            .await
            .expect("Failed to initialize SQLite metadata store"),
    );

    let state = Arc::new(ServerState {
        manager: Arc::new(ConnectionManager::new()),
        store,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health_check))
        .route("/api/capabilities/:driver", get(get_capabilities))
        .route("/api/connections", get(list_saved_connections))
        .route("/api/connections/save", post(save_connection_endpoint))
        .route("/api/connections/:id", delete(delete_saved_connection))
        .route("/api/connections/test", post(test_connection))
        .route("/api/connections/connect", post(connect_db))
        .route("/api/connections/:id/session", get(get_session_status))
        .route("/api/connections/:id/disconnect", post(disconnect_db))
        .route("/api/connections/:id/schema", get(get_schema_tree))
        .route("/api/connections/:id/tables/:table", get(introspect_table))
        .route("/api/connections/:id/query", post(execute_query))
        .route("/api/connections/:id/backup", post(export_backup))
        .route("/api/connections/:id/restore", post(restore_backup))
        .route("/api/connections/:id/move-schema", post(move_table_schema))
        .route("/api/connections/:id/cell", post(update_cell))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:4000")
        .await
        .expect("Failed to bind on 127.0.0.1:4000");

    println!("OmniDB Backend Server listening on http://127.0.0.1:4000");
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}

async fn get_capabilities(Path(driver): Path<String>) -> Result<Json<DriverCapabilities>, StatusCode> {
    match driver.to_lowercase().as_str() {
        "sqlite" => Ok(Json(DriverCapabilities::sqlite())),
        "postgres" | "postgresql" => Ok(Json(DriverCapabilities::postgres())),
        "mysql" => Ok(Json(DriverCapabilities::mysql())),
        "mongodb" => Ok(Json(DriverCapabilities::mongodb())),
        _ => Err(StatusCode::NOT_FOUND),
    }
}

async fn test_connection(
    Json(payload): Json<ConnectPayload>,
) -> Result<Json<ServerDiagnostics>, (StatusCode, String)> {
    let config = payload.config;
    let pw = payload.password;

    match config.driver.to_lowercase().as_str() {
        "sqlite" => {
            let db_path = if config.database.is_empty() {
                ":memory:".to_string()
            } else {
                config.database.clone()
            };
            let driver = omnidb_core::drivers::sqlite::SqliteDriver::connect(&format!("sqlite://{}", db_path))
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let diag = driver.ping().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            Ok(Json(diag))
        }
        "postgres" | "postgresql" => {
            let password_str = pw.unwrap_or_default();
            let url = format!(
                "postgres://{}:{}@{}:{}/{}",
                config.user, password_str, config.host, config.port, config.database
            );
            let driver = omnidb_core::drivers::postgres::PostgresDriver::connect(&url)
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            let diag = driver.ping().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            Ok(Json(diag))
        }
        other => Err((
            StatusCode::BAD_REQUEST,
            format!("Driver '{}' not supported for ping test yet", other),
        )),
    }
}

async fn save_connection_endpoint(
    State(state): State<Arc<ServerState>>,
    Json(config): Json<ConnectionConfig>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .store
        .save_connection(&config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::OK)
}

async fn list_saved_connections(
    State(state): State<Arc<ServerState>>,
) -> Result<Json<Vec<ConnectionConfig>>, (StatusCode, String)> {
    let conns = state
        .store
        .list_connections()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(conns))
}

async fn delete_saved_connection(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .store
        .delete_connection(&id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn connect_db(
    State(state): State<Arc<ServerState>>,
    Json(payload): Json<ConnectPayload>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Establish connection in engine without forced saving
    state
        .manager
        .connect(payload.config.clone(), payload.password.as_deref())
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    Ok(StatusCode::OK)
}

#[derive(Serialize)]
struct SessionStatusResponse {
    active: bool,
    config: Option<ConnectionConfig>,
    diagnostics: Option<ServerDiagnostics>,
}

async fn get_session_status(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
) -> Result<Json<SessionStatusResponse>, (StatusCode, String)> {
    if let Some(config) = state.manager.get_session_info(&id).await {
        let diag = state.manager.ping_session(&id).await.ok();
        Ok(Json(SessionStatusResponse {
            active: true,
            config: Some(config),
            diagnostics: diag,
        }))
    } else {
        Ok(Json(SessionStatusResponse {
            active: false,
            config: None,
            diagnostics: None,
        }))
    }
}

async fn disconnect_db(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .manager
        .disconnect(&id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(StatusCode::OK)
}

async fn get_schema_tree(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
) -> Result<Json<SchemaHierarchy>, (StatusCode, String)> {
    let hierarchy = state
        .manager
        .fetch_schema_tree(&id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(hierarchy))
}

async fn introspect_table(
    State(state): State<Arc<ServerState>>,
    Path((id, table)): Path<(String, String)>,
) -> Result<Json<TableDetail>, (StatusCode, String)> {
    let detail = state
        .manager
        .introspect_table(&id, None, &table)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(detail))
}

async fn execute_query(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    Json(payload): Json<QueryPayload>,
) -> Result<Json<QueryResult>, (StatusCode, String)> {
    let result = state
        .manager
        .execute_query(&id, &payload.query, payload.limit, payload.offset)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(result))
}

async fn export_backup(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    Json(payload): Json<BackupPayload>,
) -> Result<String, (StatusCode, String)> {
    let script = state
        .manager
        .export_backup(&id, payload.tables)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(script)
}

async fn restore_backup(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    Json(payload): Json<RestorePayload>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .manager
        .restore_backup(&id, &payload.sql_script)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::OK)
}

async fn move_table_schema(
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    Json(payload): Json<MoveSchemaPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let sql = state
        .manager
        .move_table_schema(&id, &payload.current_schema, &payload.table, &payload.target_schema)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "executed_sql": sql
    })))
}

async fn update_cell(
    State(_state): State<Arc<ServerState>>,
    Path(_id): Path<String>,
    Json(_payload): Json<UpdateCellPayload>,
) -> Result<StatusCode, (StatusCode, String)> {
    Ok(StatusCode::OK)
}
