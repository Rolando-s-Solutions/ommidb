import React, { useState } from 'react';
import { ColumnMeta } from '../types/omnidb';

interface TableDesignModalProps {
  isOpen: boolean;
  onClose: () => void;
  schema?: string;
  table: string;
  columns: ColumnMeta[];
  onApplySql: (sql: string) => void;
}

export const TableDesignModal: React.FC<TableDesignModalProps> = ({
  isOpen,
  onClose,
  schema,
  table,
  columns,
  onApplySql,
}) => {
  const [activeTab, setActiveTab] = useState<'columns' | 'add_column' | 'add_key'>('columns');
  
  // New column state
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('VARCHAR(255)');
  const [newColNullable, setNewColNullable] = useState(true);
  const [newColDefault, setNewColDefault] = useState('');

  // New key / constraint state
  const [keyType, setKeyType] = useState<'PRIMARY KEY' | 'UNIQUE' | 'FOREIGN KEY'>('UNIQUE');
  const [keyCol, setKeyCol] = useState('');
  const [fkRefTable, setFkRefTable] = useState('');
  const [fkRefCol, setFkRefCol] = useState('id');

  if (!isOpen) return null;

  const qualifiedTable = schema ? `"${schema}"."${table}"` : `"${table}"`;

  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName.trim()) return;

    let sql = `ALTER TABLE ${qualifiedTable} ADD COLUMN "${newColName.trim()}" ${newColType}`;
    if (!newColNullable) {
      sql += ' NOT NULL';
    }
    if (newColDefault.trim()) {
      sql += ` DEFAULT ${newColDefault.trim()}`;
    }
    sql += ';';

    onApplySql(sql);
    onClose();
  };

  const handleAddConstraint = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyCol.trim()) return;

    let sql = '';
    const constraintName = `${table}_${keyCol.replace(/\s+/g, '_')}_${keyType.toLowerCase().replace(/\s+/g, '_')}`;

    if (keyType === 'PRIMARY KEY') {
      sql = `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT "${constraintName}" PRIMARY KEY ("${keyCol}");`;
    } else if (keyType === 'UNIQUE') {
      sql = `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT "${constraintName}" UNIQUE ("${keyCol}");`;
    } else if (keyType === 'FOREIGN KEY') {
      sql = `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT "${constraintName}" FOREIGN KEY ("${keyCol}") REFERENCES "${fkRefTable}" ("${fkRefCol}");`;
    }

    onApplySql(sql);
    onClose();
  };

  const handleDropColumn = (colName: string) => {
    const sql = `ALTER TABLE ${qualifiedTable} DROP COLUMN "${colName}";`;
    onApplySql(sql);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-lg border border-neutral-800 bg-neutral-900 p-6 shadow-2xl text-neutral-100 font-sans">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center space-x-2">
            <span className="text-blue-400">🛠</span>
            <h3 className="text-sm font-semibold">Table Designer: {schema ? `${schema}.${table}` : table}</h3>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200">✕</button>
        </div>

        {/* Tab Controls */}
        <div className="flex space-x-2 border-b border-neutral-800 pt-3 pb-2 text-xs">
          <button
            onClick={() => setActiveTab('columns')}
            className={`px-3 py-1 rounded transition-colors ${activeTab === 'columns' ? 'bg-neutral-800 text-blue-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            Columns ({columns.length})
          </button>
          <button
            onClick={() => setActiveTab('add_column')}
            className={`px-3 py-1 rounded transition-colors ${activeTab === 'add_column' ? 'bg-neutral-800 text-blue-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            + Add Column
          </button>
          <button
            onClick={() => setActiveTab('add_key')}
            className={`px-3 py-1 rounded transition-colors ${activeTab === 'add_key' ? 'bg-neutral-800 text-blue-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            + Add Constraints / Keys
          </button>
        </div>

        {/* Tab 1: Current Columns List */}
        {activeTab === 'columns' && (
          <div className="mt-4 max-h-72 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 font-mono text-xs">
            <table className="w-full border-collapse text-left">
              <thead className="bg-neutral-900 border-b border-neutral-800 text-neutral-400 text-[11px]">
                <tr>
                  <th className="p-2">Column</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Nullable</th>
                  <th className="p-2">Primary</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.name} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                    <td className="p-2 font-semibold text-neutral-200">{c.name}</td>
                    <td className="p-2 text-neutral-400">{c.original_type}</td>
                    <td className="p-2 text-neutral-400">{c.is_nullable ? 'YES' : 'NO'}</td>
                    <td className="p-2">{c.is_primary_key ? <span className="text-amber-400 font-bold">PK</span> : '-'}</td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => handleDropColumn(c.name)}
                        className="text-red-400 hover:underline text-[11px]"
                      >
                        Drop
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Add Column Form */}
        {activeTab === 'add_column' && (
          <form onSubmit={handleAddColumn} className="mt-4 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-neutral-400 mb-1">Column Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. status, bio, created_at"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 font-mono text-neutral-100 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-neutral-400 mb-1">Data Type</label>
                <select
                  value={newColType}
                  onChange={(e) => setNewColType(e.target.value)}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 font-mono text-neutral-100 outline-none focus:border-blue-500"
                >
                  <option value="VARCHAR(255)">VARCHAR(255)</option>
                  <option value="TEXT">TEXT</option>
                  <option value="INTEGER">INTEGER</option>
                  <option value="BIGINT">BIGINT</option>
                  <option value="BOOLEAN">BOOLEAN</option>
                  <option value="NUMERIC(12,2)">NUMERIC(12,2)</option>
                  <option value="TIMESTAMP WITH TIME ZONE">TIMESTAMPTZ</option>
                  <option value="JSONB">JSONB</option>
                  <option value="UUID">UUID</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-neutral-400 mb-1">Default Value (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. NOW(), 'pending', 0"
                  value={newColDefault}
                  onChange={(e) => setNewColDefault(e.target.value)}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 font-mono text-neutral-100 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center space-x-2 text-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newColNullable}
                    onChange={(e) => setNewColNullable(e.target.checked)}
                    className="rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0"
                  />
                  <span>Allow NULL</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-neutral-800">
              <button
                type="submit"
                className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-1.5 font-semibold text-white shadow transition-colors"
              >
                Generate ADD COLUMN SQL
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: Add Key / Constraint Form */}
        {activeTab === 'add_key' && (
          <form onSubmit={handleAddConstraint} className="mt-4 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-neutral-400 mb-1">Constraint Type</label>
                <select
                  value={keyType}
                  onChange={(e: any) => setKeyType(e.target.value)}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 font-mono text-neutral-100 outline-none focus:border-blue-500"
                >
                  <option value="PRIMARY KEY">PRIMARY KEY</option>
                  <option value="UNIQUE">UNIQUE</option>
                  <option value="FOREIGN KEY">FOREIGN KEY</option>
                </select>
              </div>

              <div>
                <label className="block text-neutral-400 mb-1">Target Column</label>
                <select
                  value={keyCol}
                  onChange={(e) => setKeyCol(e.target.value)}
                  required
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 font-mono text-neutral-100 outline-none focus:border-blue-500"
                >
                  <option value="">Select column...</option>
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name} ({c.original_type})</option>
                  ))}
                </select>
              </div>
            </div>

            {keyType === 'FOREIGN KEY' && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded border border-neutral-800 bg-neutral-950">
                <div>
                  <label className="block text-neutral-400 mb-1">Referenced Table</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. users"
                    value={fkRefTable}
                    onChange={(e) => setFkRefTable(e.target.value)}
                    className="w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-neutral-100 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-neutral-400 mb-1">Referenced Column</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. id"
                    value={fkRefCol}
                    onChange={(e) => setFkRefCol(e.target.value)}
                    className="w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-neutral-100 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-neutral-800">
              <button
                type="submit"
                className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-1.5 font-semibold text-white shadow transition-colors"
              >
                Generate Constraint SQL
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
