export type DriverId = 'postgres' | 'mysql' | 'sqlite' | 'mongodb';

export type QueryLanguage = 'sql' | 'mongoshell' | 'cypher';

export interface DriverCapabilities {
  engine_id: DriverId;
  display_name: string;
  default_port: number;
  primary_language: QueryLanguage;
  features: number; // Bitflags corresponding to Rust FeatureFlags
  identifier_quote_char: string;
}

export const FeatureFlags = {
  NONE: 0,
  SCHEMAS: 1 << 0,
  STORED_PROCEDURES: 1 << 1,
  VIEWS: 1 << 2,
  MATERIALIZED_VIEWS: 1 << 3,
  TRIGGERS: 1 << 4,
  INDEXES: 1 << 5,
  TRANSACTIONS: 1 << 6,
  SAVEPOINTS: 1 << 7,
  EXPLAIN_ANALYZE: 1 << 8,
  DOCUMENT_STORAGE: 1 << 9,
  INLINE_CELL_EDITING: 1 << 10,
  DDL_ALTER_TABLE: 1 << 11,
  SSL_CONNECTION: 1 << 12,
  SSH_TUNNELING: 1 << 13,
  MULTI_STATEMENT_EXEC: 1 << 14,
} as const;

export function hasFeature(capabilities: DriverCapabilities, feature: number): boolean {
  return (capabilities.features & feature) === feature;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  driver: DriverId;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  password_encrypted?: string | null;
  is_read_only: boolean;
  use_tls: boolean;
  ssh_tunnel?: {
    host: string;
    port: number;
    user: string;
  };
}

export interface ServerDiagnostics {
  server_version: string;
  driver_version: string;
  latency_ms: number;
}

export type ColumnValue =
  | { type: 'Null'; value?: null }
  | { type: 'Bool'; value: boolean }
  | { type: 'Int'; value: number }
  | { type: 'Float'; value: number }
  | { type: 'Text'; value: string }
  | { type: 'Bytes'; value: number[] }
  | { type: 'DateTime'; value: string }
  | { type: 'Json'; value: unknown }
  | { type: 'Document'; value: Record<string, ColumnValue> }
  | { type: 'Array'; value: ColumnValue[] };

export interface ColumnMeta {
  name: string;
  original_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  is_auto_increment: boolean;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: ColumnValue[][];
  rows_affected: number;
  execution_time_ms: number;
  query_id: string;
}

export interface TableSummary {
  name: string;
  schema?: string;
  is_view: boolean;
  estimated_row_count?: number;
}

export interface SchemaNode {
  name: string;
  tables: TableSummary[];
}

export interface SchemaHierarchy {
  database: string;
  schemas: SchemaNode[];
}

export interface TableDetail {
  name: string;
  schema?: string;
  columns: ColumnMeta[];
  primary_keys: string[];
  row_count: number;
}

export type DiffKind = 'Identical' | 'Added' | 'Removed' | 'Modified';

export interface ColumnDiff {
  name: string;
  kind: DiffKind;
  source?: ColumnMeta;
  target?: ColumnMeta;
}

export interface TableDiff {
  table_name: string;
  kind: DiffKind;
  column_diffs: ColumnDiff[];
  migration_sql: string[];
}

export interface QueryTabResult {
  queryText: string;
  result: QueryResult | null;
  error: string | null;
  executionTimeMs: number;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: {
      core?: {
        invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
    };
  }
}
