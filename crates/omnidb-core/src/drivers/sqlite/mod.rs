use async_trait::async_trait;
use sqlx::{sqlite::SqlitePoolOptions, Column, Row, SqlitePool, TypeInfo};
use std::time::Instant;

use crate::capabilities::DriverCapabilities;
use crate::driver::{
    ColumnMeta, ColumnValue, DatabaseDriver, DatabaseError, QueryResult,
    SchemaHierarchy, SchemaNode, ServerDiagnostics, TableDetail, TableSummary,
};

pub struct SqliteDriver {
    pool: SqlitePool,
    capabilities: DriverCapabilities,
}

impl SqliteDriver {
    pub async fn connect(connection_string: &str) -> Result<Self, DatabaseError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(connection_string)
            .await
            .map_err(|e| DatabaseError::ConnectionFailed(e.to_string()))?;

        Ok(Self {
            pool,
            capabilities: DriverCapabilities::sqlite(),
        })
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    fn capabilities(&self) -> &DriverCapabilities {
        &self.capabilities
    }

    async fn ping(&self) -> Result<ServerDiagnostics, DatabaseError> {
        let start = Instant::now();
        let row = sqlx::query("SELECT sqlite_version() as ver")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| DatabaseError::ConnectionFailed(e.to_string()))?;

        let version: String = row.try_get("ver").unwrap_or_else(|_| "unknown".into());
        let latency_ms = start.elapsed().as_millis() as u64;

        Ok(ServerDiagnostics {
            server_version: format!("SQLite {}", version),
            driver_version: "sqlx-sqlite-0.8".into(),
            latency_ms,
        })
    }

    async fn fetch_schema_tree(&self) -> Result<SchemaHierarchy, DatabaseError> {
        let rows = sqlx::query(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;

        let mut tables = Vec::new();
        for r in rows {
            let name: String = r.try_get("name").unwrap_or_default();
            let obj_type: String = r.try_get("type").unwrap_or_default();
            tables.push(TableSummary {
                name,
                schema: Some("main".into()),
                is_view: obj_type == "view",
                estimated_row_count: None,
            });
        }

        Ok(SchemaHierarchy {
            database: "main".into(),
            schemas: vec![SchemaNode {
                name: "main".into(),
                tables,
            }],
        })
    }

    async fn introspect_table(
        &self,
        _schema: Option<&str>,
        table: &str,
    ) -> Result<TableDetail, DatabaseError> {
        let pragma_sql = format!("PRAGMA table_info(\"{}\")", table.replace('"', "\"\""));
        let rows = sqlx::query(&pragma_sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;

        let mut columns = Vec::new();
        let mut primary_keys = Vec::new();

        for r in rows {
            let name: String = r.try_get("name").unwrap_or_default();
            let col_type: String = r.try_get("type").unwrap_or_default();
            let not_null: i64 = r.try_get("notnull").unwrap_or(0);
            let pk: i64 = r.try_get("pk").unwrap_or(0);

            if pk > 0 {
                primary_keys.push(name.clone());
            }

            columns.push(ColumnMeta {
                name,
                original_type: col_type,
                is_nullable: not_null == 0,
                is_primary_key: pk > 0,
                is_auto_increment: false,
            });
        }

        let count_row = sqlx::query(&format!("SELECT COUNT(*) as count FROM \"{}\"", table.replace('"', "\"\"")))
            .fetch_one(&self.pool)
            .await
            .ok();
        let row_count = count_row
            .and_then(|r| r.try_get::<i64, _>("count").ok())
            .unwrap_or(0) as u64;

        Ok(TableDetail {
            name: table.to_string(),
            schema: Some("main".into()),
            columns,
            primary_keys,
            indexes: Vec::new(),
            row_count,
        })
    }

    async fn execute_query(
        &self,
        query: &str,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<QueryResult, DatabaseError> {
        let start = Instant::now();
        let trimmed = query.trim();
        let mut final_sql = trimmed.to_string();

        if let Some(lim) = limit {
            if !trimmed.to_uppercase().contains("LIMIT") {
                final_sql.push_str(&format!(" LIMIT {}", lim));
                if let Some(off) = offset {
                    final_sql.push_str(&format!(" OFFSET {}", off));
                }
            }
        }

        let is_mutation = trimmed.starts_with("INSERT")
            || trimmed.starts_with("UPDATE")
            || trimmed.starts_with("DELETE")
            || trimmed.starts_with("DROP")
            || trimmed.starts_with("CREATE")
            || trimmed.starts_with("ALTER");

        if is_mutation {
            let res = sqlx::query(&final_sql)
                .execute(&self.pool)
                .await
                .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;

            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: res.rows_affected(),
                execution_time_ms: start.elapsed().as_millis() as u64,
                query_id: uuid::Uuid::new_v4().to_string(),
            });
        }

        let rows = sqlx::query(&final_sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;

        let mut columns = Vec::new();
        if let Some(first_row) = rows.first() {
            for col in first_row.columns() {
                columns.push(ColumnMeta {
                    name: col.name().to_string(),
                    original_type: col.type_info().name().to_string(),
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                });
            }
        }

        let mut result_rows = Vec::with_capacity(rows.len());
        for row in rows {
            let mut row_vals = Vec::with_capacity(row.columns().len());
            for col in row.columns() {
                let col_name = col.name();
                // Map basic SQLite types to ColumnValue
                let val = if let Ok(s) = row.try_get::<String, _>(col_name) {
                    ColumnValue::Text(s)
                } else if let Ok(i) = row.try_get::<i64, _>(col_name) {
                    ColumnValue::Int(i)
                } else if let Ok(f) = row.try_get::<f64, _>(col_name) {
                    ColumnValue::Float(f)
                } else if let Ok(b) = row.try_get::<bool, _>(col_name) {
                    ColumnValue::Bool(b)
                } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(col_name) {
                    ColumnValue::Bytes(bytes)
                } else {
                    ColumnValue::Null
                };
                row_vals.push(val);
            }
            result_rows.push(row_vals);
        }

        Ok(QueryResult {
            columns,
            rows: result_rows,
            rows_affected: 0,
            execution_time_ms: start.elapsed().as_millis() as u64,
            query_id: uuid::Uuid::new_v4().to_string(),
        })
    }

    async fn update_cell(
        &self,
        _schema: Option<&str>,
        table: &str,
        pk_column: &str,
        pk_value: &ColumnValue,
        target_column: &str,
        new_value: &ColumnValue,
    ) -> Result<(), DatabaseError> {
        let sql = format!(
            "UPDATE \"{}\" SET \"{}\" = ? WHERE \"{}\" = ?",
            table.replace('"', "\"\""),
            target_column.replace('"', "\"\""),
            pk_column.replace('"', "\"\"")
        );

        let mut query = sqlx::query(&sql);
        match new_value {
            ColumnValue::Text(t) => query = query.bind(t),
            ColumnValue::Int(i) => query = query.bind(i),
            ColumnValue::Float(f) => query = query.bind(f),
            ColumnValue::Bool(b) => query = query.bind(b),
            ColumnValue::Null => query = query.bind(None::<String>),
            _ => return Err(DatabaseError::UnsupportedFeature("Complex type cell update".into())),
        }

        match pk_value {
            ColumnValue::Int(i) => query = query.bind(i),
            ColumnValue::Text(t) => query = query.bind(t),
            _ => return Err(DatabaseError::UnsupportedFeature("Unsupported PK type".into())),
        }

        query
            .execute(&self.pool)
            .await
            .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;

        Ok(())
    }

    async fn export_backup(&self, tables: Option<Vec<String>>) -> Result<String, DatabaseError> {
        let tree = self.fetch_schema_tree().await?;
        let mut script = String::from("-- OmniDB Studio SQLite Backup\nBEGIN TRANSACTION;\n\n");

        for schema in tree.schemas {
            for table in schema.tables {
                if table.is_view { continue; }

                if let Some(ref filter) = tables {
                    if !filter.contains(&table.name) {
                        continue;
                    }
                }
                let maybe_create = sqlx::raw_sql(&format!(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='{}';",
                    table.name.replace('\'', "''")
                ))
                .fetch_optional(&self.pool)
                .await;

                if let Ok(r) = maybe_create {
                    let ddl: String = r.try_get("sql").unwrap_or_default();
                    script.push_str(&format!("{};\n\n", ddl));
                }

                // Dump table rows
                let rows = sqlx::raw_sql(&format!("SELECT * FROM \"{}\";", table.name.replace('"', "\"\"")))
                    .fetch_all(&self.pool)
                    .await
                    .unwrap_or_default();

                for r in rows {
                    let mut vals = Vec::new();
                    for col in r.columns() {
                        let name = col.name();
                        if let Ok(s) = r.try_get::<String, _>(name) {
                            vals.push(format!("'{}'", s.replace('\'', "''")));
                        } else if let Ok(i) = r.try_get::<i64, _>(name) {
                            vals.push(i.to_string());
                        } else if let Ok(f) = r.try_get::<f64, _>(name) {
                            vals.push(f.to_string());
                        } else {
                            vals.push("NULL".to_string());
                        }
                    }
                    if !vals.is_empty() {
                        script.push_str(&format!(
                            "INSERT INTO \"{}\" VALUES ({});\n",
                            table.name,
                            vals.join(", ")
                        ));
                    }
                }
                script.push('\n');
            }
        }

        script.push_str("COMMIT;\n");
        Ok(script)
    }

    async fn restore_backup(&self, sql_script: &str) -> Result<(), DatabaseError> {
        for statement in sql_script.split(';') {
            let stmt = statement.trim();
            if !stmt.is_empty() {
                sqlx::raw_sql(stmt)
                    .execute(&self.pool)
                    .await
                    .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;
            }
        }
        Ok(())
    }

    async fn move_table_schema(
        &self,
        _current_schema: &str,
        _table: &str,
        _target_schema: &str,
    ) -> Result<String, DatabaseError> {
        Err(DatabaseError::UnsupportedFeature(
            "SQLite does not support multi-schema table migration via ALTER TABLE SET SCHEMA".into(),
        ))
    }

    async fn close(&mut self) -> Result<(), DatabaseError> {
        self.pool.close().await;
        Ok(())
    }
}
