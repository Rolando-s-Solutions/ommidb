import { invoke } from '@tauri-apps/api/core';
import { OmniDBTransport } from './transport';
import {
  ConnectionConfig,
  DriverCapabilities,
  QueryResult,
  SchemaHierarchy,
  ServerDiagnostics,
  TableDetail,
  ColumnValue,
} from '../types/omnidb';

async function invokeTauri<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  // If @tauri-apps/api/core invoke is available
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    // If invoke threw because of a Rust-side error or missing environment
    const tauri = (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__;
    if (!tauri) {
      throw new Error('Tauri native IPC environment not detected');
    }
    if ((window as any).__TAURI__?.core?.invoke) {
      return (window as any).__TAURI__.core.invoke(cmd, args);
    }
    throw err;
  }
}

export class DesktopTransport implements OmniDBTransport {
  async testConnection(config: ConnectionConfig): Promise<ServerDiagnostics> {
    const configPayload = {
      ...config,
      password_encrypted: config.password || config.password_encrypted,
    };
    return invokeTauri<ServerDiagnostics>('test_connection', { config: configPayload });
  }

  async connect(config: ConnectionConfig): Promise<void> {
    return invokeTauri<void>('connect', {
      config,
      password: config.password || config.password_encrypted,
    });
  }

  async disconnect(connectionId: string): Promise<void> {
    return invokeTauri<void>('disconnect', { connectionId });
  }

  async getCapabilities(driver: string): Promise<DriverCapabilities> {
    return invokeTauri<DriverCapabilities>('get_capabilities', { driver });
  }

  async fetchSchemaTree(connectionId: string): Promise<SchemaHierarchy> {
    return invokeTauri<SchemaHierarchy>('fetch_schema_tree', { connectionId });
  }

  async introspectTable(
    connectionId: string,
    schema?: string,
    table?: string
  ): Promise<TableDetail> {
    return invokeTauri<TableDetail>('introspect_table', { connectionId, schema, table });
  }

  async executeQuery(
    connectionId: string,
    query: string,
    limit?: number,
    offset?: number
  ): Promise<QueryResult> {
    return invokeTauri<QueryResult>('execute_query', {
      connectionId,
      query,
      limit,
      offset,
    });
  }

  async updateCell(
    connectionId: string,
    schema: string | undefined,
    table: string,
    pkColumn: string,
    pkValue: ColumnValue,
    targetColumn: string,
    newValue: ColumnValue
  ): Promise<void> {
    return invokeTauri<void>('update_cell', {
      connectionId,
      schema,
      table,
      pkColumn,
      pkValue,
      targetColumn,
      newValue,
    });
  }

  async moveTableSchema(
    connectionId: string,
    currentSchema: string,
    table: string,
    targetSchema: string
  ): Promise<{ success: boolean; executed_sql: string }> {
    return invokeTauri<{ success: boolean; executed_sql: string }>('move_table_schema', {
      connectionId,
      currentSchema,
      table,
      targetSchema,
    });
  }

  async exportBackup(connectionId: string, tables?: string[]): Promise<string> {
    return invokeTauri<string>('export_backup', { connectionId, tables });
  }

  async restoreBackup(connectionId: string, sqlScript: string): Promise<void> {
    return invokeTauri<void>('restore_backup', { connectionId, sqlScript });
  }
}
