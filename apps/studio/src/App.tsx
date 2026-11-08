import React, { useState } from 'react';
import { SchemaTree } from './components/SchemaTree';
import { QueryEditorTabs } from './components/QueryEditorTabs';
import { DataGrid } from './components/DataGrid';
import { ResultWorkspace } from './components/ResultWorkspace';
import { ConnectionModal } from './components/ConnectionModal';
import { PasswordPromptModal } from './components/PasswordPromptModal';
import { BackupModal } from './components/BackupModal';
import { TableDesignModal } from './components/TableDesignModal';
import { QueryCopilot } from './components/QueryCopilot';
import { VisualQueryBuilderModal } from './components/VisualQueryBuilderModal';
import { ToastContainer } from './components/ToastContainer';
import { useToastStore } from './stores/toast.store';
import { useConnectionStore } from './stores/connection.store';
import { useQueryWorkspaceStore } from './stores/query.store';
import { getTransport } from './adapters';
import { ConnectionConfig } from './types/omnidb';

export const App: React.FC = () => {
  const transport = getTransport();
  const {
    connections,
    activeConnectionId,
    activeSchemaTree,
    activeDiagnostics,
    activeCapabilities,
    addConnection,
    connect,
    disconnect,
    selectIntrospectTable,
  } = useConnectionStore();

  const { tabs, activeTabId, editCell, runActiveQuery, createTab } = useQueryWorkspaceStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [pendingPasswordConnection, setPendingPasswordConnection] = useState<ConnectionConfig | null>(null);
  const [tableDesignTarget, setTableDesignTarget] = useState<{
    schema?: string;
    table: string;
    columns: any[];
  } | null>(null);
  const [showCopilot, setShowCopilot] = useState(false);
  const [showVisualBuilder, setShowVisualBuilder] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);

  const handleExportBackup = async (selectedTables?: string[]) => {
    if (!activeConnectionId || !transport.exportBackup) return;
    setIsBackingUp(true);
    try {
      const sql = await transport.exportBackup(activeConnectionId, selectedTables);
      const blob = new Blob([sql], { type: 'text/sql' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `omnidb_backup_${Date.now()}.sql`;
      a.click();
      URL.revokeObjectURL(url);
      useToastStore.getState().showSuccess('Backup Generated', `Exported SQL dump (${sql.length} bytes)`);
    } catch (err: any) {
      useToastStore.getState().showError('Backup Failed', err.message || String(err));
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConnectionId || !transport.restoreBackup) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const sql = reader.result as string;

      useToastStore.getState().addToast({
        title: `Restore Database: "${file.name}"`,
        message: `File size: ${sql.length} bytes.\nChoose an action:`,
        type: 'confirm',
        actions: [
          {
            label: 'Load into Editor Tab',
            style: 'primary',
            onClick: () => {
              createTab('sql', sql);
              useToastStore.getState().showInfo('Loaded in Editor', `Opened "${file.name}" in a new query tab.`);
            },
          },
          {
            label: 'Execute Directly on DB',
            style: 'danger',
            onClick: async () => {
              try {
                await transport.restoreBackup!(activeConnectionId, sql);
                useToastStore.getState().showSuccess('Database Restored', `Successfully executed "${file.name}" dump.`);
                const refreshed = await transport.fetchSchemaTree(activeConnectionId);
                useConnectionStore.setState({ activeSchemaTree: refreshed });
              } catch (err: any) {
                useToastStore.getState().showError('Restore Failed', err.message || String(err));
              }
            },
          },
        ],
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Load saved connections from SQLite on initial startup and restore active session if present
  React.useEffect(() => {
    (async () => {
      await useConnectionStore.getState().loadSavedConnections(transport);
      const restored = await useConnectionStore.getState().restoreActiveSession(transport);
      if (restored) {
        const activeConnId = useConnectionStore.getState().activeConnectionId;
        const activeConn = useConnectionStore.getState().connections.find(c => c.id === activeConnId);
        useToastStore.getState().showInfo(
          'Session Restored',
          `Reconnected to ${activeConn?.name || 'previous active session'}`
        );
      }
    })();
  }, []);

  const handleSelectSavedConnection = async (sc: ConnectionConfig) => {
    // If SQLite driver, password is not required -> connect immediately
    if (sc.driver.toLowerCase() === 'sqlite') {
      try {
        await connect(transport, sc);
        useToastStore.getState().showSuccess('Connected', `Active database: ${sc.name}`);
      } catch (err: any) {
        useToastStore.getState().showError('Connection Failed', err.message || String(err));
      }
      return;
    }

    // If password is already embedded in config, connect directly
    if (sc.password) {
      try {
        await connect(transport, sc);
        useToastStore.getState().showSuccess('Connected', `Active database: ${sc.name}`);
      } catch (err: any) {
        useToastStore.getState().showError('Connection Failed', err.message || String(err));
      }
      return;
    }

    // Prompt user for password
    setPendingPasswordConnection(sc);
  };

  const handlePasswordSubmit = async (password: string) => {
    if (!pendingPasswordConnection) return;
    const configWithPw: ConnectionConfig = {
      ...pendingPasswordConnection,
      password,
    };

    await connect(transport, configWithPw);
    useToastStore.getState().showSuccess('Connected', `Active database: ${configWithPw.name}`);
  };

  const handleConnectNew = async (config: ConnectionConfig, shouldSave: boolean) => {
    if (shouldSave) {
      addConnection(config);
    }
    await connect(transport, config);
    useToastStore.getState().showSuccess('Connected', `Active database: ${config.name}`);
  };

  const handleOpenTableDesign = async (schema: string | undefined, table: string) => {
    if (!activeConnectionId) return;
    try {
      const detail = await transport.introspectTable(activeConnectionId, schema, table);
      setTableDesignTarget({
        schema,
        table,
        columns: detail.columns,
      });
    } catch (err: any) {
      useToastStore.getState().showError('Failed to inspect table', err.message || String(err));
    }
  };

  const handleApplyDesignSql = (sql: string) => {
    createTab('sql', sql);
    useToastStore.getState().showInfo('DDL Prepared', 'SQL query loaded into a new tab ready for execution.');
  };

  const handleTableSelected = (schema: string | undefined, table: string) => {
    selectIntrospectTable(transport, schema, table);
    const query = `SELECT * FROM ${schema ? `"${schema}".` : ''}"${table}" LIMIT 50;`;
    if (activeConnectionId) {
      useQueryWorkspaceStore.getState().appendAndExecute(transport, activeConnectionId, query);
    }
  };

  const handleApplyCopilotQuery = (sql: string) => {
    createTab('sql', sql);
  };

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100 antialiased overflow-hidden select-none">
      {/* Top Application Header */}
      <header className="flex h-11 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4">
        <div className="flex items-center space-x-3">
          <span className="font-bold tracking-tight text-white flex items-center space-x-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-blue-600 font-mono text-xs font-black text-white shadow-sm">
              Ω
            </span>
            <span className="text-sm font-semibold">OmniDB Studio</span>
          </span>

          <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
            {typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__) ? 'Desktop Native' : 'Web & Rust Server'}
          </span>
        </div>

        {/* Center Connection Controls & Copilot Toggle */}
        <div className="flex items-center space-x-3">
          {activeConnection ? (
            <div className="flex items-center space-x-2 rounded border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-medium text-neutral-200">{activeConnection.name}</span>
              <span className="text-neutral-600">({activeConnection.driver})</span>
              <button
                onClick={() => disconnect(transport, activeConnection.id)}
                className="ml-2 text-neutral-500 hover:text-red-400"
                title="Disconnect"
              >
                ✕
              </button>
            </div>
          ) : (
            <span className="text-xs text-neutral-500">No active connection</span>
          )}

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center space-x-1.5 rounded bg-blue-600 hover:bg-blue-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <span>+</span>
            <span>New Connection</span>
          </button>

          <button
            onClick={() => useQueryWorkspaceStore.getState().openVisualBuilderTab()}
            className="flex items-center space-x-1.5 rounded bg-indigo-600 hover:bg-indigo-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors"
            title="Open Interactive Visual Canvas tab to drag, connect and join tables"
          >
            <span>◫</span>
            <span>Visual Builder Canvas</span>
          </button>

          <button
            onClick={() => setShowCopilot((prev) => !prev)}
            className={`flex items-center space-x-1.5 rounded border px-3 py-1 text-xs font-semibold transition-all ${
              showCopilot
                ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-600'
            }`}
          >
            <span>⚡</span>
            <span>SQL Assistant</span>
          </button>

          {/* Backup & Restore Controls */}
          {activeConnection && (
            <div className="flex items-center space-x-1.5 border-l border-neutral-800 pl-3">
              <button
                onClick={() => setIsBackupModalOpen(true)}
                disabled={isBackingUp}
                className="flex items-center space-x-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-200 transition-colors disabled:opacity-50"
                title="Select tables and download logical SQL dump"
              >
                <span>📥</span>
                <span>{isBackingUp ? 'Dumping...' : 'Backup'}</span>
              </button>

              <label
                className="flex items-center space-x-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-200 transition-colors cursor-pointer"
                title="Restore SQL dump into the active database"
              >
                <span>📤</span>
                <span>Restore</span>
                <input
                  type="file"
                  accept=".sql"
                  onChange={handleRestore}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>

        {/* Right Diagnostics */}
        {activeDiagnostics ? (
          <div className="flex items-center space-x-3 text-xs text-neutral-400 font-mono">
            <span>{activeDiagnostics.server_version}</span>
            <span className="text-neutral-700">|</span>
            <span className="text-emerald-400 font-semibold">{activeDiagnostics.latency_ms}ms</span>
          </div>
        ) : (
          <div className="text-xs text-neutral-500 font-mono">Status: Idle</div>
        )}
      </header>

      {/* Main Studio Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Schema Explorer */}
        <aside className="w-64 shrink-0 border-r border-neutral-800">
          <SchemaTree
            hierarchy={activeSchemaTree}
            transport={transport}
            connectionId={activeConnectionId}
            savedConnections={connections}
            onSelectSavedConnection={handleSelectSavedConnection}
            onDeleteSavedConnection={async (id) => {
              await useConnectionStore.getState().deleteSavedConnection(transport, id);
            }}
            onTableSelected={handleTableSelected}
            onOpenTableDesign={handleOpenTableDesign}
            onExecuteSql={(sql) => {
              if (activeConnectionId) {
                useQueryWorkspaceStore.getState().appendAndExecute(transport, activeConnectionId, sql);
              }
            }}
            onTableMoved={async () => {
              if (activeConnectionId) {
                const refreshed = await transport.fetchSchemaTree(activeConnectionId);
                useConnectionStore.setState({ activeSchemaTree: refreshed });
              }
            }}
          />
        </aside>

        {/* Center Workspace: Split between Editor and Data Grid */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Top Half: Query Editor Tabs or Full Canvas */}
          <section className={`${activeTab?.kind === 'visual_builder' ? 'h-full' : 'h-1/2'} border-b border-neutral-800`}>
            <QueryEditorTabs
              transport={transport}
              connectionId={activeConnectionId}
              schemaTree={activeSchemaTree}
            />
          </section>

          {/* Bottom Half: Result Data Grid Workspace with Multi-Query Result Tabs (hidden when visual builder tab is open) */}
          {activeTab?.kind !== 'visual_builder' && (
            <section className="h-1/2">
              <ResultWorkspace
                results={activeTab?.results || []}
                activeResultIndex={activeTab?.activeResultIndex || 0}
                onSelectResultTab={(idx) => {
                  if (activeTabId) {
                    useQueryWorkspaceStore.getState().setActiveResultIndex(activeTabId, idx);
                  }
                }}
                onCloseResultTab={(idx) => {
                  if (activeTabId) {
                    useQueryWorkspaceStore.getState().closeResultTab(activeTabId, idx);
                  }
                }}
                onClearAllResults={() => {
                  if (activeTabId) {
                    useQueryWorkspaceStore.getState().clearResults(activeTabId);
                  }
                }}
                connectionId={activeConnectionId || ''}
                transport={transport}
                onCellEdited={(pkCol, pkVal, colName, newVal, rIdx, cIdx) => {
                  if (!activeConnectionId) return;
                  editCell(
                    transport,
                    activeConnectionId,
                    undefined,
                    'current_table',
                    pkCol,
                    pkVal,
                    colName,
                    newVal,
                    rIdx,
                    cIdx
                  );
                }}
              />
            </section>
          )}
        </main>

        {/* Right Side Pane: SQL Assistant & Query Optimizer */}
        {showCopilot && (
          <aside className="w-96 shrink-0 border-l border-neutral-800">
            <QueryCopilot
              schemaTree={activeSchemaTree}
              activeQueryText={activeTab?.content || ''}
              onApplyQuery={handleApplyCopilotQuery}
            />
          </aside>
        )}
      </div>

      {/* Connection Modal */}
      <ConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConnect={handleConnectNew}
        savedConnections={connections}
        transport={transport}
      />

      {/* Selective Table Backup Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        schemaTree={activeSchemaTree}
        onExport={handleExportBackup}
      />

      {/* Database Password Prompt Modal */}
      <PasswordPromptModal
        isOpen={pendingPasswordConnection !== null}
        connection={pendingPasswordConnection}
        onClose={() => setPendingPasswordConnection(null)}
        onSubmit={handlePasswordSubmit}
      />

      {/* Table Designer & Column / Key Manager Modal */}
      {tableDesignTarget && (
        <TableDesignModal
          isOpen={true}
          schema={tableDesignTarget.schema}
          table={tableDesignTarget.table}
          columns={tableDesignTarget.columns}
          onClose={() => setTableDesignTarget(null)}
          onApplySql={handleApplyDesignSql}
        />
      )}

      {/* Global Toast & Action Confirmation Notification Center */}
      <ToastContainer />
    </div>
  );
};

export default App;
