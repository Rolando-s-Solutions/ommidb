import React, { useState } from 'react';
import { ConnectionConfig, SchemaHierarchy } from '../types/omnidb';
import { OmniDBTransport } from '../adapters/transport';
import { useToastStore } from '../stores/toast.store';

interface SchemaTreeProps {
  hierarchy: SchemaHierarchy | null;
  transport: OmniDBTransport;
  connectionId: string | null;
  savedConnections?: ConnectionConfig[];
  onSelectSavedConnection?: (config: ConnectionConfig) => void;
  onDeleteSavedConnection?: (id: string) => void;
  onTableSelected: (schema: string | undefined, table: string) => void;
  onTableMoved?: (currentSchema: string, table: string, targetSchema: string) => void;
  onOpenTableDesign?: (schema: string | undefined, table: string) => void;
  onExecuteSql?: (sql: string) => void;
}

export const SchemaTree: React.FC<SchemaTreeProps> = ({
  hierarchy,
  transport,
  connectionId,
  savedConnections = [],
  onSelectSavedConnection,
  onDeleteSavedConnection,
  onTableSelected,
  onTableMoved,
  onOpenTableDesign,
  onExecuteSql,
}) => {
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({
    public: true,
    main: true,
  });
  const [expandedDrivers, setExpandedDrivers] = useState<Record<string, boolean>>({
    postgres: true,
    sqlite: true,
    mysql: true,
  });
  const [draggedTable, setDraggedTable] = useState<{ schema: string; table: string } | null>(null);
  const [dropTargetSchema, setDropTargetSchema] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);

  // Schema move confirmation modal
  const [pendingMove, setPendingMove] = useState<{
    currentSchema: string;
    table: string;
    targetSchema: string;
    sql: string;
  } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    schema?: string;
    table: string;
  } | null>(null);

  // Close context menu on any outside click
  React.useEffect(() => {
    const handleWindowClick = () => setContextMenu(null);
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  const handleTableContextMenu = (e: React.MouseEvent, schema: string | undefined, table: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      schema,
      table,
    });
  };

  // Group saved connections by driver
  const connectionsByDriver: Record<string, ConnectionConfig[]> = {};
  for (const c of savedConnections) {
    const d = c.driver.toLowerCase();
    if (!connectionsByDriver[d]) connectionsByDriver[d] = [];
    connectionsByDriver[d].push(c);
  }

  const toggleDriver = (d: string) => {
    setExpandedDrivers((prev) => ({ ...prev, [d]: !prev[d] }));
  };

  const toggleSchema = (schemaName: string) => {
    setExpandedSchemas((prev) => ({
      ...prev,
      [schemaName]: !prev[schemaName],
    }));
  };

  const handleDragStart = (e: React.DragEvent, schema: string, table: string) => {
    e.dataTransfer.effectAllowed = 'copyMove';
    const payload = JSON.stringify({ schema, table });
    try {
      e.dataTransfer.setData('application/json', payload);
      e.dataTransfer.setData('text/plain', payload);
    } catch (err) {
      // ignore
    }
    (window as any).__draggedTable = { schema, table };
    try {
      sessionStorage.setItem('omnidb_dragged_table', payload);
    } catch (err) {
      // ignore
    }
    setDraggedTable({ schema, table });
  };

  const handleDragEnd = () => {
    // Clear global drag state after drop or drag cancel
    setTimeout(() => {
      setDraggedTable(null);
      (window as any).__draggedTable = null;
      try {
        sessionStorage.removeItem('omnidb_dragged_table');
      } catch (err) {
        // ignore
      }
    }, 400);
  };

  const handleDragOver = (e: React.DragEvent, schema: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const active = draggedTable || (window as any).__draggedTable;
    if (active && active.schema !== schema) {
      if (dropTargetSchema !== schema) {
        setDropTargetSchema(schema);
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentTarget = e.currentTarget as HTMLElement;
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      if (!pendingMove) {
        setDropTargetSchema(null);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent, targetSchema: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Support state, global, and dataTransfer data
    const active = draggedTable || (window as any).__draggedTable;
    let currentSchema = active?.schema;
    let table = active?.table;

    if (!currentSchema || !table) {
      try {
        const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
        if (raw) {
          const parsed = JSON.parse(raw);
          currentSchema = parsed.schema;
          table = parsed.table;
        }
      } catch (err) {
        // ignore
      }
    }

    (window as any).__draggedTable = null;
    setDraggedTable(null);

    if (!table || !currentSchema || !connectionId || currentSchema === targetSchema) {
      setDropTargetSchema(null);
      return;
    }

    // Keep the target schema highlighted while asking confirmation!
    setDropTargetSchema(targetSchema);

    const generatedSql = `ALTER TABLE "${currentSchema}"."${table}" SET SCHEMA "${targetSchema}";`;
    setPendingMove({
      currentSchema,
      table,
      targetSchema,
      sql: generatedSql,
    });
  };

  const handleConfirmMove = async () => {
    if (!pendingMove || !connectionId) return;
    const { currentSchema, table, targetSchema } = pendingMove;

    setIsMoving(true);
    setMoveNotice(`Moving "${table}" to schema "${targetSchema}"...`);

    try {
      if (transport.moveTableSchema) {
        const res = await transport.moveTableSchema(connectionId, currentSchema, table, targetSchema);
        useToastStore.getState().showSuccess('Table Moved Successfully', res.executed_sql);
        if (onTableMoved) {
          onTableMoved(currentSchema, table, targetSchema);
        }
      }
    } catch (err: any) {
      useToastStore.getState().showError('Failed to move table schema', err.message || String(err));
      setMoveNotice(null);
    } finally {
      setIsMoving(false);
      setPendingMove(null);
      setDropTargetSchema(null);
      setTimeout(() => setMoveNotice(null), 4000);
    }
  };

  const handleCancelMove = () => {
    setPendingMove(null);
    setDropTargetSchema(null);
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-900 p-2 text-xs text-neutral-300 font-sans select-none border-r border-neutral-800">
      {/* Saved Database Connections grouped by driver */}
      <div className="mb-4 pb-3 border-b border-neutral-800">
        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400 flex items-center justify-between">
          <span>Stored Connections ({savedConnections.length})</span>
        </div>

        {savedConnections.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-neutral-500 italic">
            No stored connections in SQLite
          </div>
        ) : (
          <div className="space-y-1 mt-1">
            {Object.entries(connectionsByDriver).map(([driverName, conns]) => {
              const isExpanded = !!expandedDrivers[driverName];
              return (
                <div key={driverName} className="ml-1">
                  <button
                    onClick={() => toggleDriver(driverName)}
                    className="flex w-full items-center space-x-1.5 rounded px-2 py-1 text-left text-[11px] font-semibold text-neutral-300 hover:bg-neutral-800/80 transition-colors uppercase tracking-wider"
                  >
                    <span className="text-[9px] text-neutral-500">{isExpanded ? '▼' : '▶'}</span>
                    <span>{driverName}</span>
                    <span className="text-[10px] text-neutral-500 font-normal">({conns.length})</span>
                  </button>

                  {isExpanded && (
                    <div className="ml-3 mt-0.5 space-y-0.5 border-l border-neutral-800 pl-1">
                      {conns.map((c) => {
                        const isActive = c.id === connectionId;
                        return (
                          <div
                            key={c.id}
                            className={`group flex items-center justify-between rounded px-2 py-1 text-left transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                            }`}
                            onDoubleClick={() => onSelectSavedConnection && onSelectSavedConnection(c)}
                          >
                            <button
                              onClick={() => onSelectSavedConnection && onSelectSavedConnection(c)}
                              className="flex items-center space-x-1.5 truncate flex-1 text-left"
                              title={`Click or Double-click to connect to ${c.name} (${c.host}:${c.port})`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
                              <span className="truncate">{c.name}</span>
                            </button>

                            {onDeleteSavedConnection && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  useToastStore.getState().confirm(
                                    'Delete Stored Connection',
                                    `Are you sure you want to delete "${c.name}" from the local SQLite store?`,
                                    () => {
                                      onDeleteSavedConnection(c.id);
                                      useToastStore.getState().showInfo('Connection Deleted', `Removed "${c.name}"`);
                                    },
                                    'Delete'
                                  );
                                }}
                                className="text-neutral-500 hover:text-red-400 px-1 font-bold"
                                title="Delete saved connection"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-2 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
        Database Explorer
      </div>

      {!hierarchy ? (
        <div className="p-2 text-xs text-neutral-500 italic">
          No active database connected. Click a stored connection above or connect via "+ New Connection" to browse schemas.
        </div>
      ) : (
        <div className="space-y-1">
          {moveNotice && (
            <div className="mb-2 rounded bg-blue-950/60 border border-blue-800/80 p-2 text-[10px] font-mono text-blue-300">
              {moveNotice}
            </div>
          )}

          <div className="flex items-center space-x-1.5 px-2 py-1 font-semibold text-neutral-200">
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7M4 7c0-2 1.5-3 3.5-3h9c2 0 3.5 1 3.5 3M4 7h16" />
            </svg>
            <span>{hierarchy.database}</span>
          </div>

          {hierarchy.schemas.map((schema) => {
            const isExpanded = !!expandedSchemas[schema.name];
            const isDropTarget = dropTargetSchema === schema.name;

            return (
              <div
                key={schema.name}
                className={`ml-2 rounded transition-all duration-200 ${
                  isDropTarget
                    ? 'bg-blue-600/25 border-2 border-dashed border-blue-400 p-1.5 shadow-lg shadow-blue-500/10 ring-2 ring-blue-500/30'
                    : 'p-0.5'
                }`}
                onDragOver={(e) => handleDragOver(e, schema.name)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, schema.name)}
              >
                <button
                  onClick={() => toggleSchema(schema.name)}
                  className="flex w-full items-center space-x-1 rounded px-2 py-1 text-left hover:bg-neutral-800 transition-colors"
                >
                  <span className="text-[10px] text-neutral-500">{isExpanded ? '▼' : '▶'}</span>
                  <span className="font-medium text-neutral-300">{schema.name}</span>
                  <span className="text-[10px] text-neutral-500">({schema.tables.length})</span>
                  {isDropTarget && (
                    <span className="ml-auto text-[9px] font-bold text-blue-400 animate-pulse">
                      Drop to move here
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-neutral-800 pl-1">
                    {schema.tables.map((table) => (
                      <div
                        key={table.name}
                        draggable={!table.is_view && !isMoving}
                        onDragStart={(e) => handleDragStart(e, schema.name, table.name)}
                        onDragEnd={handleDragEnd}
                        onClick={() => onTableSelected(schema.name, table.name)}
                        onContextMenu={(e) => handleTableContextMenu(e, schema.name, table.name)}
                        className="group flex w-full items-center space-x-1.5 rounded px-2 py-1 text-left text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 transition-colors cursor-grab active:cursor-grabbing select-none"
                        title="Right click for Table Options / Drag to visual canvas or schema"
                      >
                        <svg className="w-3.5 h-3.5 text-blue-400 shrink-0 group-hover:text-blue-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="truncate pointer-events-none">{table.name}</span>
                        {table.is_view && (
                          <span className="rounded bg-neutral-800 px-1 py-0.2 text-[9px] text-amber-400 pointer-events-none">
                            VIEW
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Context Menu for Table Actions */}
      {contextMenu && (
        <div
          className="fixed z-50 w-52 rounded-md border border-neutral-800 bg-neutral-900/95 py-1 text-xs text-neutral-200 shadow-2xl backdrop-blur-md font-sans"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 border-b border-neutral-800 text-[10px] font-bold text-neutral-400 font-mono truncate">
            {contextMenu.schema ? `${contextMenu.schema}.${contextMenu.table}` : contextMenu.table}
          </div>

          <button
            onClick={() => {
              if (onOpenTableDesign) onOpenTableDesign(contextMenu.schema, contextMenu.table);
              setContextMenu(null);
            }}
            className="flex w-full items-center px-3 py-1.5 hover:bg-neutral-800 hover:text-white text-left transition-colors"
          >
            <span className="mr-2 text-blue-400">🛠</span>
            <span>Design Table / Add Columns</span>
          </button>

          <button
            onClick={() => {
              // Dispatch custom event to add table to Visual Builder Canvas
              const event = new CustomEvent('omnidb:add_table_to_canvas', {
                detail: { schema: contextMenu.schema || 'public', table: contextMenu.table },
              });
              window.dispatchEvent(event);
              setContextMenu(null);
            }}
            className="flex w-full items-center px-3 py-1.5 hover:bg-neutral-800 hover:text-amber-300 text-left transition-colors"
          >
            <span className="mr-2 text-amber-400">◫</span>
            <span>Add to Visual Canvas</span>
          </button>

          <button
            onClick={() => {
              const q = `SELECT * FROM ${contextMenu.schema ? `"${contextMenu.schema}".` : ''}"${contextMenu.table}" LIMIT 100;`;
              if (onExecuteSql) onExecuteSql(q);
              setContextMenu(null);
            }}
            className="flex w-full items-center px-3 py-1.5 hover:bg-neutral-800 hover:text-white text-left transition-colors"
          >
            <span className="mr-2 text-emerald-400">👁</span>
            <span>View First 100 Rows</span>
          </button>

          <button
            onClick={() => {
              const q = `SELECT COUNT(*) as total_rows FROM ${contextMenu.schema ? `"${contextMenu.schema}".` : ''}"${contextMenu.table}";`;
              if (onExecuteSql) onExecuteSql(q);
              setContextMenu(null);
            }}
            className="flex w-full items-center px-3 py-1.5 hover:bg-neutral-800 hover:text-white text-left transition-colors"
          >
            <span className="mr-2 text-cyan-400">🔢</span>
            <span>Count Rows</span>
          </button>

          <div className="my-1 border-t border-neutral-800" />

          {/* Move to another schema option */}
          {hierarchy && hierarchy.schemas.filter((s) => s.name !== contextMenu.schema).length > 0 && (
            <div className="px-1 py-1">
              <div className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
                Move Table To Schema
              </div>
              {hierarchy.schemas
                .filter((s) => s.name !== contextMenu.schema)
                .map((target) => (
                  <button
                    key={target.name}
                    onClick={() => {
                      const curSchema = contextMenu.schema || 'public';
                      const tbl = contextMenu.table;
                      const tgtSchema = target.name;
                      setDropTargetSchema(tgtSchema);
                      const generatedSql = `ALTER TABLE "${curSchema}"."${tbl}" SET SCHEMA "${tgtSchema}";`;
                      setPendingMove({
                        currentSchema: curSchema,
                        table: tbl,
                        targetSchema: tgtSchema,
                        sql: generatedSql,
                      });
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center px-2 py-1 hover:bg-neutral-800 text-blue-400 hover:text-blue-300 text-left transition-colors rounded text-[11px]"
                  >
                    <span className="mr-1.5">⇄</span>
                    <span>To <strong className="text-white">{target.name}</strong></span>
                  </button>
                ))}
            </div>
          )}

          <div className="my-1 border-t border-neutral-800" />

          <button
            onClick={() => {
              const qTable = contextMenu.schema ? `"${contextMenu.schema}"."${contextMenu.table}"` : `"${contextMenu.table}"`;
              useToastStore.getState().confirm(
                'Truncate Table',
                `TRUNCATE TABLE ${qTable};\n\nAll rows in this table will be deleted. This cannot be undone.`,
                async () => {
                  try {
                    await transport.executeQuery(connectionId || '', `TRUNCATE TABLE ${qTable};`);
                    useToastStore.getState().showSuccess('Table Truncated', `Emptied table ${contextMenu.table}`);
                    if (onTableMoved) onTableMoved('', '', '');
                  } catch (err: any) {
                    useToastStore.getState().showError('Truncate Failed', err.message || String(err));
                  }
                },
                'Truncate'
              );
              setContextMenu(null);
            }}
            className="flex w-full items-center px-3 py-1.5 hover:bg-neutral-800 text-amber-400 hover:text-amber-300 text-left transition-colors"
          >
            <span className="mr-2">⚡</span>
            <span>Truncate Table</span>
          </button>

          <button
            onClick={() => {
              const qTable = contextMenu.schema ? `"${contextMenu.schema}"."${contextMenu.table}"` : `"${contextMenu.table}"`;
              useToastStore.getState().confirm(
                'Drop Table',
                `DROP TABLE ${qTable} CASCADE;\n\nThe table and its constraints will be completely dropped.`,
                async () => {
                  try {
                    await transport.executeQuery(connectionId || '', `DROP TABLE ${qTable} CASCADE;`);
                    useToastStore.getState().showSuccess('Table Dropped', `Deleted table ${contextMenu.table}`);
                    if (onTableMoved) onTableMoved('', '', '');
                  } catch (err: any) {
                    useToastStore.getState().showError('Drop Failed', err.message || String(err));
                  }
                },
                'Drop Table'
              );
              setContextMenu(null);
            }}
            className="flex w-full items-center px-3 py-1.5 hover:bg-neutral-800 text-red-400 hover:text-red-300 text-left transition-colors"
          >
            <span className="mr-2">🗑</span>
            <span>Drop Table</span>
          </button>
        </div>
      )}

      {/* Schema Move Confirmation Dialog */}
      {pendingMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            <div className="flex items-center space-x-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 font-bold text-lg">
                ⇄
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">
                  Confirm Move Table Schema
                </h3>
                <p className="text-xs text-neutral-400">
                  Moving table <span className="font-semibold text-neutral-200">"{pendingMove.table}"</span> from schema <span className="font-semibold text-amber-300">"{pendingMove.currentSchema}"</span> to <span className="font-semibold text-blue-400">"{pendingMove.targetSchema}"</span>
                </p>
              </div>
            </div>

            <div className="my-3">
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                Generated SQL Query to Execute:
              </label>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-emerald-400 select-text overflow-x-auto shadow-inner">
                {pendingMove.sql}
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-neutral-800">
              <button
                type="button"
                disabled={isMoving}
                onClick={handleCancelMove}
                className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-4 py-1.5 text-xs font-medium text-neutral-300 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isMoving}
                onClick={handleConfirmMove}
                className="flex items-center space-x-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white shadow transition-colors disabled:opacity-50"
              >
                <span>{isMoving ? 'Executing...' : 'Execute Query & Move'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
