import React, { useState } from 'react';
import { SchemaHierarchy } from '../types/omnidb';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  schemaTree: SchemaHierarchy | null;
  onExport: (selectedTables?: string[]) => Promise<void>;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  schemaTree,
  onExport,
}) => {
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  // Flatten tables from all schemas
  const allTables: { schema: string; table: string }[] = [];
  if (schemaTree?.schemas) {
    for (const s of schemaTree.schemas) {
      for (const t of s.tables) {
        if (!t.is_view) {
          allTables.push({ schema: s.name, table: t.name });
        }
      }
    }
  }

  const toggleTable = (tableName: string) => {
    setSelectedTables((prev) =>
      prev.includes(tableName)
        ? prev.filter((t) => t !== tableName)
        : [...prev, tableName]
    );
  };

  const selectAll = () => {
    setSelectedTables(allTables.map((t) => t.table));
  };

  const deselectAll = () => {
    setSelectedTables([]);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // If none selected, default to all tables
      const filter = selectedTables.length > 0 ? selectedTables : undefined;
      await onExport(filter);
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-6 shadow-2xl text-neutral-100 font-sans">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center space-x-2">
            <span className="text-base">📥</span>
            <h2 className="text-base font-semibold">Database Backup (SQL Dump)</h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200">✕</button>
        </div>

        <div className="mt-4 text-xs space-y-3">
          <div className="flex items-center justify-between text-neutral-400">
            <span>Select Tables to Include in Backup:</span>
            <div className="flex space-x-2 text-[11px]">
              <button
                type="button"
                onClick={selectAll}
                className="text-blue-400 hover:underline"
              >
                Select All
              </button>
              <span>|</span>
              <button
                type="button"
                onClick={deselectAll}
                className="text-neutral-400 hover:underline"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-2 space-y-1">
            {allTables.length === 0 ? (
              <div className="text-neutral-500 py-4 text-center">No tables available to backup</div>
            ) : (
              allTables.map(({ schema, table }) => {
                const isChecked = selectedTables.includes(table);
                return (
                  <label
                    key={`${schema}.${table}`}
                    className="flex items-center space-x-2 rounded px-2 py-1.5 hover:bg-neutral-800/60 cursor-pointer font-mono"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleTable(table)}
                      className="rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0"
                    />
                    <span className="text-neutral-500 text-[11px]">{schema}.</span>
                    <span className="text-neutral-200">{table}</span>
                  </label>
                );
              })
            )}
          </div>

          <p className="text-[11px] text-neutral-500">
            {selectedTables.length === 0
              ? 'All tables will be included in the backup.'
              : `${selectedTables.length} table(s) selected.`}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end space-x-2 border-t border-neutral-800 pt-3 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 font-medium text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isExporting}
            onClick={handleExport}
            className="rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-1.5 font-semibold text-white shadow-sm transition-colors"
          >
            {isExporting ? 'Generating Dump...' : 'Export SQL Backup'}
          </button>
        </div>
      </div>
    </div>
  );
};
