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

const API_BASE = 'http://127.0.0.1:4000/api';

export class WebTransport implements OmniDBTransport {
  async listSavedConnections(): Promise<ConnectionConfig[]> {
    const res = await fetch(`${API_BASE}/connections`);
    if (!res.ok) return [];
    return res.json();
  }

  async saveConnection(config: ConnectionConfig): Promise<void> {
    const res = await fetch(`${API_BASE}/connections/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to save connection');
    }
  }

  async deleteSavedConnection(id: string): Promise<void> {
    await fetch(`${API_BASE}/connections/${id}`, { method: 'DELETE' });
  }

  async testConnection(config: ConnectionConfig): Promise<ServerDiagnostics> {
    const res = await fetch(`${API_BASE}/connections/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, password: config.password }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to test connection');
    }

    return res.json();
  }

  async connect(config: ConnectionConfig): Promise<void> {
    const res = await fetch(`${API_BASE}/connections/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, password: config.password }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to connect to database');
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    await fetch(`${API_BASE}/connections/${connectionId}/disconnect`, {
      method: 'POST',
    });
  }

  async getSessionStatus(connectionId: string): Promise<{
    active: boolean;
    config?: ConnectionConfig;
    diagnostics?: ServerDiagnostics;
  }> {
    const res = await fetch(`${API_BASE}/connections/${connectionId}/session`);
    if (!res.ok) {
      return { active: false };
    }
    return res.json();
  }

  async getCapabilities(driver: string): Promise<DriverCapabilities> {
    const res = await fetch(`${API_BASE}/capabilities/${driver}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch capabilities for ${driver}`);
    }
    return res.json();
  }

  async fetchSchemaTree(connectionId: string): Promise<SchemaHierarchy> {
    const res = await fetch(`${API_BASE}/connections/${connectionId}/schema`);
    if (!res.ok) {
      throw new Error('Failed to fetch schema hierarchy');
    }
    return res.json();
  }

  async introspectTable(
    connectionId: string,
    schema?: string,
    table?: string
  ): Promise<TableDetail> {
    const res = await fetch(
      `${API_BASE}/connections/${connectionId}/tables/${table || ''}?schema=${schema || ''}`
    );
    if (!res.ok) {
      throw new Error('Failed to introspect table');
    }
    return res.json();
  }

  async moveTableSchema(
    connectionId: string,
    currentSchema: string,
    table: string,
    targetSchema: string
  ): Promise<{ success: boolean; executed_sql: string }> {
    const res = await fetch(`${API_BASE}/connections/${connectionId}/move-schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_schema: currentSchema,
        table,
        target_schema: targetSchema,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to move table schema');
    }

    return res.json();
  }

  async executeQuery(
    connectionId: string,
    query: string,
    limit?: number,
    offset?: number
  ): Promise<QueryResult> {
    const res = await fetch(`${API_BASE}/connections/${connectionId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, offset }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to execute query');
    }

    return res.json();
  }

  async exportBackup(connectionId: string, tables?: string[]): Promise<string> {
    const res = await fetch(`${API_BASE}/connections/${connectionId}/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tables }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to generate database backup');
    }
    return res.text();
  }

  async restoreBackup(connectionId: string, sqlScript: string): Promise<void> {
    const res = await fetch(`${API_BASE}/connections/${connectionId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql_script: sqlScript }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to restore database');
    }
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
    const res = await fetch(`${API_BASE}/connections/${connectionId}/cell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema,
        table,
        pk_column: pkColumn,
        pk_value: pkValue,
        target_column: targetColumn,
        new_value: newValue,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to update cell');
    }
  }
}
