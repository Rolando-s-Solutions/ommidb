pub mod capabilities;
pub mod crypto;
pub mod diff;
pub mod driver;
pub mod drivers;
pub mod manager;
pub mod parser;

pub use capabilities::{DriverCapabilities, FeatureFlags, QueryLanguage};
pub use crypto::{CryptoError, EncryptionEngine, KeyDerivation};
pub use diff::{ColumnDiff, DiffKind, SchemaDiffEngine, TableDiff};
pub use driver::{
    ColumnMeta, ColumnValue, DatabaseDriver, DatabaseError, QueryResult, SchemaHierarchy,
    SchemaNode, ServerDiagnostics, TableDetail, TableSummary,
};
pub use manager::{ConnectionConfig, ConnectionManager};
pub use parser::QueryGuard;
