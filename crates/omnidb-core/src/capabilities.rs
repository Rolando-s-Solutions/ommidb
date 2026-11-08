use bitflags::bitflags;
use serde::{Deserialize, Serialize};

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(transparent)]
    pub struct FeatureFlags: u64 {
        const NONE                  = 0;
        const SCHEMAS               = 1 << 0;  // Multiple schemas per database (Postgres)
        const STORED_PROCEDURES     = 1 << 1;
        const VIEWS                 = 1 << 2;
        const MATERIALIZED_VIEWS    = 1 << 3;
        const TRIGGERS              = 1 << 4;
        const INDEXES               = 1 << 5;
        const TRANSACTIONS          = 1 << 6;
        const SAVEPOINTS            = 1 << 7;
        const EXPLAIN_ANALYZE       = 1 << 8;
        const DOCUMENT_STORAGE      = 1 << 9;  // MongoDB / Document model
        const INLINE_CELL_EDITING   = 1 << 10; // Supports targeted row updates
        const DDL_ALTER_TABLE       = 1 << 11;
        const SSL_CONNECTION        = 1 << 12;
        const SSH_TUNNELING         = 1 << 13;
        const MULTI_STATEMENT_EXEC  = 1 << 14;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QueryLanguage {
    Sql,
    MongoShell,
    Cypher,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriverCapabilities {
    pub engine_id: String,
    pub display_name: String,
    pub default_port: u16,
    pub primary_language: QueryLanguage,
    pub features: FeatureFlags,
    pub identifier_quote_char: char,
}

impl DriverCapabilities {
    pub fn sqlite() -> Self {
        Self {
            engine_id: "sqlite".into(),
            display_name: "SQLite".into(),
            default_port: 0,
            primary_language: QueryLanguage::Sql,
            features: FeatureFlags::INDEXES
                | FeatureFlags::VIEWS
                | FeatureFlags::TRIGGERS
                | FeatureFlags::TRANSACTIONS
                | FeatureFlags::SAVEPOINTS
                | FeatureFlags::EXPLAIN_ANALYZE
                | FeatureFlags::INLINE_CELL_EDITING
                | FeatureFlags::MULTI_STATEMENT_EXEC,
            identifier_quote_char: '"',
        }
    }

    pub fn postgres() -> Self {
        Self {
            engine_id: "postgres".into(),
            display_name: "PostgreSQL".into(),
            default_port: 5432,
            primary_language: QueryLanguage::Sql,
            features: FeatureFlags::SCHEMAS
                | FeatureFlags::STORED_PROCEDURES
                | FeatureFlags::VIEWS
                | FeatureFlags::MATERIALIZED_VIEWS
                | FeatureFlags::TRIGGERS
                | FeatureFlags::INDEXES
                | FeatureFlags::TRANSACTIONS
                | FeatureFlags::SAVEPOINTS
                | FeatureFlags::EXPLAIN_ANALYZE
                | FeatureFlags::INLINE_CELL_EDITING
                | FeatureFlags::DDL_ALTER_TABLE
                | FeatureFlags::SSL_CONNECTION
                | FeatureFlags::SSH_TUNNELING
                | FeatureFlags::MULTI_STATEMENT_EXEC,
            identifier_quote_char: '"',
        }
    }

    pub fn mysql() -> Self {
        Self {
            engine_id: "mysql".into(),
            display_name: "MySQL".into(),
            default_port: 3306,
            primary_language: QueryLanguage::Sql,
            features: FeatureFlags::STORED_PROCEDURES
                | FeatureFlags::VIEWS
                | FeatureFlags::TRIGGERS
                | FeatureFlags::INDEXES
                | FeatureFlags::TRANSACTIONS
                | FeatureFlags::SAVEPOINTS
                | FeatureFlags::EXPLAIN_ANALYZE
                | FeatureFlags::INLINE_CELL_EDITING
                | FeatureFlags::DDL_ALTER_TABLE
                | FeatureFlags::SSL_CONNECTION
                | FeatureFlags::SSH_TUNNELING
                | FeatureFlags::MULTI_STATEMENT_EXEC,
            identifier_quote_char: '`',
        }
    }

    pub fn mongodb() -> Self {
        Self {
            engine_id: "mongodb".into(),
            display_name: "MongoDB".into(),
            default_port: 27017,
            primary_language: QueryLanguage::MongoShell,
            features: FeatureFlags::DOCUMENT_STORAGE
                | FeatureFlags::INDEXES
                | FeatureFlags::SSL_CONNECTION
                | FeatureFlags::SSH_TUNNELING,
            identifier_quote_char: '"',
        }
    }
}
