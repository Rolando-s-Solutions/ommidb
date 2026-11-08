use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

use crate::capabilities::DriverCapabilities;

#[derive(Error, Debug, Serialize, Deserialize)]
pub enum DatabaseError {
    #[error("Authentication failed: {0}")]
    AuthFailed(String),
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
    #[error("Query timeout: {0}")]
    Timeout(String),
    #[error("Read-only mode violation: {0}")]
    ReadOnlyViolation(String),
    #[error("Query execution error: {0}")]
    ExecutionError(String),
    #[error("Unsupported feature: {0}")]
    UnsupportedFeature(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum ColumnValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Bytes(Vec<u8>),
    DateTime(DateTime<Utc>),
    Json(serde_json::Value),
    Document(HashMap<String, ColumnValue>),
    Array(Vec<ColumnValue>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub original_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub is_auto_increment: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<ColumnValue>>,
    pub rows_affected: u64,
    pub execution_time_ms: u64,
    pub query_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableSummary {
    pub name: String,
    pub schema: Option<String>,
    pub is_view: bool,
    pub estimated_row_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaNode {
    pub name: String,
    pub tables: Vec<TableSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaHierarchy {
    pub database: String,
    pub schemas: Vec<SchemaNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerDiagnostics {
    pub server_version: String,
    pub driver_version: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDetail {
    pub name: String,
    pub schema: Option<String>,
    pub columns: Vec<ColumnMeta>,
    pub primary_keys: Vec<String>,
    pub indexes: Vec<IndexMeta>,
    pub row_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexMeta {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    fn capabilities(&self) -> &DriverCapabilities;

    async fn ping(&self) -> Result<ServerDiagnostics, DatabaseError>;

    async fn fetch_schema_tree(&self) -> Result<SchemaHierarchy, DatabaseError>;

    async fn introspect_table(
        &self,
        schema: Option<&str>,
        table: &str,
    ) -> Result<TableDetail, DatabaseError>;

    async fn execute_query(
        &self,
        query: &str,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<QueryResult, DatabaseError>;

    async fn update_cell(
        &self,
        schema: Option<&str>,
        table: &str,
        pk_column: &str,
        pk_value: &ColumnValue,
        target_column: &str,
        new_value: &ColumnValue,
    ) -> Result<(), DatabaseError>;

    async fn export_backup(&self, tables: Option<Vec<String>>) -> Result<String, DatabaseError>;

    async fn restore_backup(&self, sql_script: &str) -> Result<(), DatabaseError>;

    async fn move_table_schema(
        &self,
        current_schema: &str,
        table: &str,
        target_schema: &str,
    ) -> Result<String, DatabaseError>;

    async fn close(&mut self) -> Result<(), DatabaseError>;
}
