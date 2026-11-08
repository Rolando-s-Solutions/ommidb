import React, { useState } from 'react';
import { ColumnMeta, ColumnValue } from '../types/omnidb';
import { OmniDBTransport } from '../adapters/transport';

interface DataGridProps {
  columns: ColumnMeta[];
  rows: ColumnValue[][];
  connectionId: string;
  schema?: string;
  table?: string;
  transport: OmniDBTransport;
  onCellEdited?: (
    pkCol: string,
    pkVal: ColumnValue,
    colName: string,
    newVal: ColumnValue,
    rIdx: number,
    cIdx: number
  ) => void;
}

export const DataGrid: React.FC<DataGridProps> = ({
  columns,
  rows,
  onCellEdited,
}) => {
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const renderCellText = (val: ColumnValue): string => {
    switch (val.type) {
      case 'Null':
        return 'NULL';
      case 'Bool':
        return val.value ? 'TRUE' : 'FALSE';
      case 'Int':
      case 'Float':
        return String(val.value);
      case 'Text':
        return val.value;
      case 'DateTime':
        return val.value;
      case 'Json':
        return JSON.stringify(val.value);
      default:
        return String(val);
    }
  };

  const handleDoubleClick = (rIdx: number, cIdx: number, val: ColumnValue) => {
    setEditingCell({ r: rIdx, c: cIdx });
    setEditValue(val.type === 'Null' ? '' : renderCellText(val));
  };

  const commitEdit = (rIdx: number, cIdx: number) => {
    if (!editingCell) return;
    const col = columns[cIdx];
    const pkColIndex = columns.findIndex((c) => c.is_primary_key);
    const pkCol = pkColIndex >= 0 ? columns[pkColIndex].name : columns[0]?.name;
    const pkVal = pkColIndex >= 0 ? rows[rIdx][pkColIndex] : rows[rIdx][0];

    const newVal: ColumnValue = { type: 'Text', value: editValue };
    if (onCellEdited && pkCol && pkVal) {
      onCellEdited(pkCol, pkVal, col.name, newVal, rIdx, cIdx);
    }
    setEditingCell(null);
  };

  if (columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        No results to display. Execute a query to see tabular data.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto border border-neutral-800 bg-neutral-950 font-mono text-xs">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800">
          <tr>
            <th className="w-12 border-r border-neutral-800 px-2 py-1.5 text-center text-neutral-500 select-none">
              #
            </th>
            {columns.map((col, idx) => (
              <th
                key={idx}
                className="border-r border-neutral-800 px-3 py-1.5 font-semibold text-neutral-200"
              >
                <div className="flex items-center justify-between space-x-2">
                  <span>{col.name}</span>
                  <span className="text-[10px] text-neutral-500 font-normal">
                    {col.original_type}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => (
            <tr
              key={rIdx}
              className="border-b border-neutral-900 hover:bg-neutral-900/60 transition-colors"
            >
              <td className="border-r border-neutral-800 px-2 py-1 text-center text-neutral-600 select-none">
                {rIdx + 1}
              </td>
              {row.map((cell, cIdx) => {
                const isEditing = editingCell?.r === rIdx && editingCell?.c === cIdx;
                const isNull = cell.type === 'Null';

                return (
                  <td
                    key={cIdx}
                    onDoubleClick={() => handleDoubleClick(rIdx, cIdx, cell)}
                    className="border-r border-neutral-800 px-3 py-1 text-neutral-300 max-w-xs truncate"
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(rIdx, cIdx)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(rIdx, cIdx);
                          if (e.key === 'Escape') setEditingCell(null);
                        }}
                        className="w-full rounded bg-neutral-800 px-1 py-0.5 text-neutral-100 outline-none ring-1 ring-blue-500"
                      />
                    ) : (
                      <span className={isNull ? 'italic text-neutral-600' : ''}>
                        {renderCellText(cell)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
