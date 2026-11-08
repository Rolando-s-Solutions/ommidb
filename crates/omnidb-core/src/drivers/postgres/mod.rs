use async_trait::async_trait;
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    Column, PgPool, Row, TypeInfo,
};
use std::str::FromStr;
use std::time::Instant;

use crate::capabilities::DriverCapabilities;
use crate::driver::{
    ColumnMeta, ColumnValue, DatabaseDriver, DatabaseError, QueryResult,
    SchemaHierarchy, SchemaNode, ServerDiagnostics, TableDetail, TableSummary,
};

pub struct PostgresDriver {
    pool: PgPool,
    capabilities: DriverCapabilities,
}

impl PostgresDriver {
    pub async fn connect(connection_string: &str) -> Result<Self, DatabaseError> {
        let mut connect_options = PgConnectOptions::from_str(connection_string)
            .map_err(|e| DatabaseError::ConnectionFailed(e.to_string()))?;

        // Disable prepared statement caching:
        // Supabase / PgBouncer in transaction mode does not support session-level prepared statements.
        connect_options = connect_options.statement_cache_capacity(0);

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(connect_options)
            .await
            .map_err(|e| DatabaseError::ConnectionFailed(e.to_string()))?;

        Ok(Self {
            pool,
            capabilities: DriverCapabilities::postgres(),
        })
    }

    pub async fn connect_with_options(
        host: &str,
        port: u16,
        user: &str,
        password: &str,
        database: &str,
        _use_tls: bool,
    ) -> Result<Self, DatabaseError> {
        let connect_options = PgConnectOptions::new()
            .host(host)
            .port(port)
            .username(user)
            .password(password)
            .database(database)
            .statement_cache_capacity(0);

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(connect_options)
            .await
            .map_err(|e| DatabaseError::ConnectionFailed(e.to_string()))?;

        Ok(Self {
            pool,
            capabilities: DriverCapabilities::postgres(),
        })
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    fn capabilities(&self) -> &DriverCapabilities {
        &self.capabilities
    }

    async fn ping(&self) -> Result<ServerDiagnostics, DatabaseError> {
        let start = Instant::now();
        // Use raw unchecked query unadorned by prepared statement registration
        let row = sqlx::raw_sql("SELECT version() as ver")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| DatabaseError::ConnectionFailed(e.to_string()))?;

        let version: String = row.try_get("ver").unwrap_or_else(|_| "PostgreSQL".into());
        let latency_ms = start.elapsed().as_millis() as u64;

        Ok(ServerDiagnostics {
            server_version: version.split_whitespace().take(2).collect::<Vec<_>>().join(" "),
            driver_version: "sqlx-postgres-0.8".into(),
            latency_ms,
        })
    }

    async fn fetch_schema_tree(&self) -> Result<SchemaHierarchy, DatabaseError> {
        let sql = r#"
            SELECT table_schema, table_name, table_type
            FROM information_schema.tables
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
            ORDER BY table_schema, table_name;
        "#;
        let rows = sqlx::raw_sql(sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;

        let mut schema_map: std::collections::BTreeMap<String, Vec<TableSummary>> =
            std::collections::BTreeMap::new();

        for r in rows {
            let schema: String = r.try_get("table_schema").unwrap_or_default();
            let name: String = r.try_get("table_name").unwrap_or_default();
            let t_type: String = r.try_get("table_type").unwrap_or_default();

            schema_map.entry(schema.clone()).or_default().push(TableSummary {
                name,
                schema: Some(schema),
                is_view: t_type.contains("VIEW"),
                estimated_row_count: None,
            });
        }

        let schemas = schema_map
            .into_iter()
            .map(|(name, tables)| SchemaNode { name, tables })
            .collect();

        Ok(SchemaHierarchy {
            database: "postgres".into(),
            schemas,
        })
    }

    async fn introspect_table(
        &self,
        schema: Option<&str>,
        table: &str,
    ) -> Result<TableDetail, DatabaseError> {
        let schema_name = schema.unwrap_or("public");

        let cols_query = format!(
            r#"
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = '{}' AND table_name = '{}'
            ORDER BY ordinal_position;
            "#,
            schema_name.replace('\'', "''"),
            table.replace('\'', "''")
        );

        let rows = sqlx::raw_sql(&cols_query)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;

        let mut columns = Vec::new();
        for r in rows {
            let col_name: String = r.try_get("column_name").unwrap_or_default();
            let data_type: String = r.try_get("data_type").unwrap_or_default();
            let is_nullable: String = r.try_get("is_nullable").unwrap_or_default();

            columns.push(ColumnMeta {
                name: col_name,
                original_type: data_type,
                is_nullable: is_nullable.eq_ignore_ascii_case("YES"),
                is_primary_key: false, // Introspected below if needed
                is_auto_increment: false,
            });
        }

        Ok(TableDetail {
            name: table.to_string(),
            schema: Some(schema_name.to_string()),
            columns,
            primary_keys: Vec::new(),
            indexes: Vec::new(),
            row_count: 0,
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
            let res = sqlx::raw_sql(&final_sql)
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

        let rows = sqlx::raw_sql(&final_sql)
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
                let val = if let Ok(s) = row.try_get::<String, _>(col_name) {
                    ColumnValue::Text(s)
                } else if let Ok(i) = row.try_get::<i64, _>(col_name) {
                    ColumnValue::Int(i)
                } else if let Ok(i) = row.try_get::<i32, _>(col_name) {
                    ColumnValue::Int(i as i64)
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
        schema: Option<&str>,
        table: &str,
        pk_column: &str,
        pk_value: &ColumnValue,
        target_column: &str,
        new_value: &ColumnValue,
    ) -> Result<(), DatabaseError> {
        let schema_name = schema.unwrap_or("public");
        let sql = format!(
            r#"UPDATE "{}"."{}" SET "{}" = $1 WHERE "{}" = $2"#,
            schema_name.replace('"', "\"\""),
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
        let mut script = String::from("-- OmniDB Studio PostgreSQL Logical Backup\nBEGIN;\n\n");

        for schema_node in tree.schemas {
            let schema_name = &schema_node.name;

            for table in schema_node.tables {
                if table.is_view { continue; }

                // If specific tables were requested, skip those not matching
                if let Some(ref filter) = tables {
                    let full_name = format!("{}.{}", schema_name, table.name);
                    if !filter.contains(&table.name) && !filter.contains(&full_name) {
                        continue;
                    }
                }

                script.push_str(&format!("CREATE SCHEMA IF NOT EXISTS \"{}\";\n\n", schema_name));

                // Fetch columns
                let detail = self.introspect_table(Some(schema_name), &table.name).await?;
                let mut col_defs = Vec::new();
                for col in &detail.columns {
                    let null_str = if col.is_nullable { "" } else { " NOT NULL" };
                    col_defs.push(format!("  \"{}\" {}{}", col.name, col.original_type, null_str));
                }

                script.push_str(&format!(
                    "CREATE TABLE IF NOT EXISTS \"{}\".\"{}\" (\n{}\n);\n\n",
                    schema_name,
                    table.name,
                    col_defs.join(",\n")
                ));

                // Dump table rows as INSERTs
                let select_sql = format!(
                    "SELECT * FROM \"{}\".\"{}\";",
                    schema_name.replace('"', "\"\""),
                    table.name.replace('"', "\"\"")
                );

                let rows = sqlx::raw_sql(&select_sql)
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
                        } else if let Ok(i) = r.try_get::<i32, _>(name) {
                            vals.push(i.to_string());
                        } else if let Ok(f) = r.try_get::<f64, _>(name) {
                            vals.push(f.to_string());
                        } else if let Ok(b) = r.try_get::<bool, _>(name) {
                            vals.push(if b { "TRUE".into() } else { "FALSE".into() });
                        } else {
                            vals.push("NULL".to_string());
                        }
                    }

                    if !vals.is_empty() {
                        script.push_str(&format!(
                            "INSERT INTO \"{}\".\"{}\" VALUES ({});\n",
                            schema_name,
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
        // Execute the batch script directly
        sqlx::raw_sql(sql_script)
            .execute(&self.pool)
            .await
            .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;
        Ok(())
    }

    async fn move_table_schema(
        &self,
        current_schema: &str,
        table: &str,
        target_schema: &str,
    ) -> Result<String, DatabaseError> {
        let sql = format!(
            r#"ALTER TABLE "{}"."{}" SET SCHEMA "{}";"#,
            current_schema.replace('"', "\"\""),
            table.replace('"', "\"\""),
            target_schema.replace('"', "\"\"")
        );

        sqlx::raw_sql(&sql)
            .execute(&self.pool)
            .await
            .map_err(|e| DatabaseError::ExecutionError(e.to_string()))?;

        Ok(sql)
    }

    async fn close(&mut self) -> Result<(), DatabaseError> {
        self.pool.close().await;
        Ok(())
    }
}
