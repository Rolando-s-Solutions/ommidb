import {
  ConnectionConfig,
  DriverCapabilities,
  QueryResult,
  SchemaHierarchy,
  ServerDiagnostics,
  TableDetail,
  ColumnValue,
} from '../types/omnidb';

export interface OmniDBTransport {
  // Connection Lifecycle
  listSavedConnections?(): Promise<ConnectionConfig[]>;
  saveConnection?(config: ConnectionConfig): Promise<void>;
  deleteSavedConnection?(id: string): Promise<void>;
  testConnection(config: ConnectionConfig): Promise<ServerDiagnostics>;
  connect(config: ConnectionConfig): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  getSessionStatus?(connectionId: string): Promise<{
    active: boolean;
    config?: ConnectionConfig;
    diagnostics?: ServerDiagnostics;
  }>;

  // Driver Metadata & Features
  getCapabilities(driver: string): Promise<DriverCapabilities>;

  // Schema & Introspection
  fetchSchemaTree(connectionId: string): Promise<SchemaHierarchy>;
  introspectTable(connectionId: string, schema?: string, table?: string): Promise<TableDetail>;
  moveTableSchema?(
    connectionId: string,
    currentSchema: string,
    table: string,
    targetSchema: string
  ): Promise<{ success: boolean; executed_sql: string }>;

  // Query Execution
  executeQuery(
    connectionId: string,
    query: string,
    limit?: number,
    offset?: number
  ): Promise<QueryResult>;

  // Backup & Restore
  exportBackup?(connectionId: string, tables?: string[]): Promise<string>;
  restoreBackup?(connectionId: string, sqlScript: string): Promise<void>;

  // Surgical Cell Editing
  updateCell(
    connectionId: string,
    schema: string | undefined,
    table: string,
    pkColumn: string,
    pkValue: ColumnValue,
    targetColumn: string,
    newValue: ColumnValue
  ): Promise<void>;
}
