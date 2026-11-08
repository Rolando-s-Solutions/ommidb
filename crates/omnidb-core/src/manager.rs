use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::driver::{DatabaseDriver, DatabaseError};
use crate::drivers::postgres::PostgresDriver;
use crate::drivers::sqlite::SqliteDriver;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password_encrypted: Option<String>,
    pub is_read_only: bool,
    pub use_tls: bool,
}

pub struct ActiveSession {
    pub config: ConnectionConfig,
    pub driver: Box<dyn DatabaseDriver>,
}

pub struct ConnectionManager {
    sessions: Arc<RwLock<HashMap<String, ActiveSession>>>,
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn connect(
        &self,
        config: ConnectionConfig,
        plaintext_password: Option<&str>,
    ) -> Result<(), DatabaseError> {
        let driver: Box<dyn DatabaseDriver> = match config.driver.to_lowercase().as_str() {
            "sqlite" => {
                let db_path = if config.database.is_empty() {
                    ":memory:".to_string()
                } else {
                    config.database.clone()
                };
                let driver = SqliteDriver::connect(&format!("sqlite://{}", db_path)).await?;
                Box::new(driver)
            }
            "postgres" | "postgresql" => {
                let pw = plaintext_password.unwrap_or_default();
                let driver = PostgresDriver::connect_with_options(
                    &config.host,
                    config.port,
                    &config.user,
                    pw,
                    &config.database,
                    config.use_tls,
                )
                .await?;
                Box::new(driver)
            }
            other => {
                return Err(DatabaseError::UnsupportedFeature(format!(
                    "Driver '{}' not implemented or enabled",
                    other
                )))
            }
        };

        let mut lock = self.sessions.write().await;
        lock.insert(config.id.clone(), ActiveSession { config, driver });
        Ok(())
    }

    pub async fn get_session_info(&self, connection_id: &str) -> Option<ConnectionConfig> {
        let lock = self.sessions.read().await;
        lock.get(connection_id).map(|s| s.config.clone())
    }

    pub async fn ping_session(&self, connection_id: &str) -> Result<crate::driver::ServerDiagnostics, DatabaseError> {
        let lock = self.sessions.read().await;
        let session = lock
            .get(connection_id)
            .ok_or_else(|| DatabaseError::ConnectionFailed("Session not found".into()))?;
        session.driver.ping().await
    }

    pub async fn disconnect(&self, connection_id: &str) -> Result<(), DatabaseError> {
        let mut lock = self.sessions.write().await;
        if let Some(mut session) = lock.remove(connection_id) {
            session.driver.close().await?;
        }
        Ok(())
    }

    pub async fn fetch_schema_tree(
        &self,
        connection_id: &str,
    ) -> Result<crate::driver::SchemaHierarchy, DatabaseError> {
        let lock = self.sessions.read().await;
        let session = lock
            .get(connection_id)
            .ok_or_else(|| DatabaseError::ConnectionFailed("Session not found".into()))?;
        session.driver.fetch_schema_tree().await
    }

    pub async fn introspect_table(
        &self,
        connection_id: &str,
        schema: Option<&str>,
        table: &str,
    ) -> Result<crate::driver::TableDetail, DatabaseError> {
        let lock = self.sessions.read().await;
        let session = lock
            .get(connection_id)
            .ok_or_else(|| DatabaseError::ConnectionFailed("Session not found".into()))?;
        session.driver.introspect_table(schema, table).await
    }

    pub async fn export_backup(
        &self,
        connection_id: &str,
        tables: Option<Vec<String>>,
    ) -> Result<String, DatabaseError> {
        let lock = self.sessions.read().await;
        let session = lock
            .get(connection_id)
            .ok_or_else(|| DatabaseError::ConnectionFailed("Session not found".into()))?;
        session.driver.export_backup(tables).await
    }

    pub async fn restore_backup(
        &self,
        connection_id: &str,
        sql_script: &str,
    ) -> Result<(), DatabaseError> {
        let lock = self.sessions.read().await;
        let session = lock
            .get(connection_id)
            .ok_or_else(|| DatabaseError::ConnectionFailed("Session not found".into()))?;

        if session.config.is_read_only {
            return Err(DatabaseError::ReadOnlyViolation(
                "Cannot restore backup into a read-only connection".into(),
            ));
        }

        session.driver.restore_backup(sql_script).await
    }

    pub async fn move_table_schema(
        &self,
        connection_id: &str,
        current_schema: &str,
        table: &str,
        target_schema: &str,
    ) -> Result<String, DatabaseError> {
        let lock = self.sessions.read().await;
        let session = lock
            .get(connection_id)
            .ok_or_else(|| DatabaseError::ConnectionFailed("Session not found".into()))?;

        if session.config.is_read_only {
            return Err(DatabaseError::ReadOnlyViolation(
                "Cannot move table schema on a read-only connection".into(),
            ));
        }

        session
            .driver
            .move_table_schema(current_schema, table, target_schema)
            .await
    }

    pub async fn execute_query(
        &self,
        connection_id: &str,
        query: &str,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<crate::driver::QueryResult, DatabaseError> {
        let lock = self.sessions.read().await;
        let session = lock
            .get(connection_id)
            .ok_or_else(|| DatabaseError::ConnectionFailed("Session not found".into()))?;

        if session.config.is_read_only {
            crate::parser::QueryGuard::assert_read_only(query)
                .map_err(|e| DatabaseError::ReadOnlyViolation(e.to_string()))?;
        }

        session.driver.execute_query(query, limit, offset).await
    }
}
