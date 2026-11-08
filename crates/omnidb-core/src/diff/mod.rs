use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::driver::{ColumnMeta, TableDetail};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DiffKind {
    Identical,
    Added,
    Removed,
    Modified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDiff {
    pub name: String,
    pub kind: DiffKind,
    pub source: Option<ColumnMeta>,
    pub target: Option<ColumnMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDiff {
    pub table_name: String,
    pub kind: DiffKind,
    pub column_diffs: Vec<ColumnDiff>,
    pub migration_sql: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaDiffReport {
    pub source_name: String,
    pub target_name: String,
    pub table_diffs: Vec<TableDiff>,
    pub generated_migration_script: String,
}

pub struct SchemaDiffEngine;

impl SchemaDiffEngine {
    /// Compares two table sets (source = desired state / Dev, target = existing state / Prod)
    /// and generates ALTER migration statements to bring Target up to date with Source.
    pub fn diff_tables(
        source_tables: &[TableDetail],
        target_tables: &[TableDetail],
        dialect_quote: char,
    ) -> Vec<TableDiff> {
        let mut diffs = Vec::new();
        let target_map: HashMap<&str, &TableDetail> =
            target_tables.iter().map(|t| (t.name.as_str(), t)).collect();

        for source in source_tables {
            let q = dialect_quote;
            if let Some(target) = target_map.get(source.name.as_str()) {
                // Table exists in both -> check columns
                let mut col_diffs = Vec::new();
                let mut migration_sql = Vec::new();
                let target_cols: HashMap<&str, &ColumnMeta> =
                    target.columns.iter().map(|c| (c.name.as_str(), c)).collect();

                for s_col in &source.columns {
                    if let Some(t_col) = target_cols.get(s_col.name.as_str()) {
                        if s_col.original_type.to_lowercase() != t_col.original_type.to_lowercase()
                            || s_col.is_nullable != t_col.is_nullable
                        {
                            col_diffs.push(ColumnDiff {
                                name: s_col.name.clone(),
                                kind: DiffKind::Modified,
                                source: Some((*s_col).clone()),
                                target: Some((*t_col).clone()),
                            });
                            migration_sql.push(format!(
                                "ALTER TABLE {q}{}{q} ALTER COLUMN {q}{}{q} TYPE {};",
                                source.name, s_col.name, s_col.original_type
                            ));
                        } else {
                            col_diffs.push(ColumnDiff {
                                name: s_col.name.clone(),
                                kind: DiffKind::Identical,
                                source: Some((*s_col).clone()),
                                target: Some((*t_col).clone()),
                            });
                        }
                    } else {
                        // Column added in source
                        col_diffs.push(ColumnDiff {
                            name: s_col.name.clone(),
                            kind: DiffKind::Added,
                            source: Some((*s_col).clone()),
                            target: None,
                        });
                        let null_clause = if s_col.is_nullable { "" } else { " NOT NULL" };
                        migration_sql.push(format!(
                            "ALTER TABLE {q}{}{q} ADD COLUMN {q}{}{q} {}{null_clause};",
                            source.name, s_col.name, s_col.original_type
                        ));
                    }
                }

                // Columns in target but not in source (dropped)
                let source_cols: HashMap<&str, &ColumnMeta> =
                    source.columns.iter().map(|c| (c.name.as_str(), c)).collect();
                for t_col in &target.columns {
                    if !source_cols.contains_key(t_col.name.as_str()) {
                        col_diffs.push(ColumnDiff {
                            name: t_col.name.clone(),
                            kind: DiffKind::Removed,
                            source: None,
                            target: Some((*t_col).clone()),
                        });
                        migration_sql.push(format!(
                            "ALTER TABLE {q}{}{q} DROP COLUMN {q}{}{q};",
                            source.name, t_col.name
                        ));
                    }
                }

                let has_changes = col_diffs.iter().any(|c| c.kind != DiffKind::Identical);
                diffs.push(TableDiff {
                    table_name: source.name.clone(),
                    kind: if has_changes { DiffKind::Modified } else { DiffKind::Identical },
                    column_diffs: col_diffs,
                    migration_sql,
                });
            } else {
                // Table added in source (new table)
                let mut create_cols = Vec::new();
                for c in &source.columns {
                    let null_clause = if c.is_nullable { "" } else { " NOT NULL" };
                    let pk_clause = if c.is_primary_key { " PRIMARY KEY" } else { "" };
                    create_cols.push(format!(
                        "  {q}{}{q} {}{null_clause}{pk_clause}",
                        c.name, c.original_type
                    ));
                }
                let sql = format!(
                    "CREATE TABLE {q}{}{q} (\n{}\n);",
                    source.name,
                    create_cols.join(",\n")
                );

                diffs.push(TableDiff {
                    table_name: source.name.clone(),
                    kind: DiffKind::Added,
                    column_diffs: source
                        .columns
                        .iter()
                        .map(|c| ColumnDiff {
                            name: c.name.clone(),
                            kind: DiffKind::Added,
                            source: Some(c.clone()),
                            target: None,
                        })
                        .collect(),
                    migration_sql: vec![sql],
                });
            }
        }

        diffs
    }
}
