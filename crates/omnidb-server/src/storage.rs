use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::sync::Arc;
use thiserror::Error;

use omnidb_core::ConnectionConfig;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct AppStore {
    pool: SqlitePool,
}

impl AppStore {
    pub async fn init(db_path: &str) -> Result<Self, StorageError> {
        let conn_str = format!("sqlite://{}?mode=rwc", db_path);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&conn_str)
            .await?;

        // Initialize schema with UNIQUE(name) constraint
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS saved_connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                driver TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                database TEXT NOT NULL,
                user TEXT NOT NULL,
                password_encrypted TEXT,
                is_read_only INTEGER NOT NULL DEFAULT 0,
                use_tls INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )
        .execute(&pool)
        .await?;

        Ok(Self { pool })
    }

    pub async fn list_connections(&self) -> Result<Vec<ConnectionConfig>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, driver, host, port, database, user, password_encrypted, is_read_only, use_tls
            FROM saved_connections
            ORDER BY created_at DESC;
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut conns = Vec::new();
        for r in rows {
            let id: String = r.get("id");
            let name: String = r.get("name");
            let driver: String = r.get("driver");
            let host: String = r.get("host");
            let port: i64 = r.get("port");
            let database: String = r.get("database");
            let user: String = r.get("user");
            let password_encrypted: Option<String> = r.get("password_encrypted");
            let is_read_only: i64 = r.get("is_read_only");
            let use_tls: i64 = r.get("use_tls");

            conns.push(ConnectionConfig {
                id,
                name,
                driver,
                host,
                port: port as u16,
                database,
                user,
                password_encrypted,
                is_read_only: is_read_only > 0,
                use_tls: use_tls > 0,
            });
        }

        Ok(conns)
    }

    pub async fn save_connection(&self, config: &ConnectionConfig) -> Result<(), StorageError> {
        sqlx::query(
            r#"
            INSERT INTO saved_connections (
                id, name, driver, host, port, database, user, password_encrypted, is_read_only, use_tls, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP)
            ON CONFLICT(name) DO UPDATE SET
                driver = excluded.driver,
                host = excluded.host,
                port = excluded.port,
                database = excluded.database,
                user = excluded.user,
                password_encrypted = excluded.password_encrypted,
                is_read_only = excluded.is_read_only,
                use_tls = excluded.use_tls,
                updated_at = CURRENT_TIMESTAMP;
            "#,
        )
        .bind(&config.id)
        .bind(&config.name)
        .bind(&config.driver)
        .bind(&config.host)
        .bind(config.port as i64)
        .bind(&config.database)
        .bind(&config.user)
        .bind(&config.password_encrypted)
        .bind(if config.is_read_only { 1i64 } else { 0i64 })
        .bind(if config.use_tls { 1i64 } else { 0i64 })
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn delete_connection(&self, id: &str) -> Result<(), StorageError> {
        sqlx::query("DELETE FROM saved_connections WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
