import React from 'react';
import { DataGrid } from './DataGrid';
import { QueryTabResult, ColumnValue } from '../types/omnidb';
import { OmniDBTransport } from '../adapters/transport';

interface ResultWorkspaceProps {
  results: QueryTabResult[];
  activeResultIndex: number;
  onSelectResultTab: (index: number) => void;
  onCloseResultTab?: (index: number) => void;
  onClearAllResults?: () => void;
  connectionId: string;
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

export const ResultWorkspace: React.FC<ResultWorkspaceProps> = ({
  results,
  activeResultIndex,
  onSelectResultTab,
  onCloseResultTab,
  onClearAllResults,
  connectionId,
  transport,
  onCellEdited,
}) => {
  if (results.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-500 font-mono">
        No active query results. Execute a query to view tabular data.
      </div>
    );
  }

  const currentResult = results[activeResultIndex] || results[0];

  return (
    <div className="flex h-full flex-col bg-neutral-950 font-sans">
      {/* Result Tabs Bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3 py-1 text-xs">
        <div className="flex items-center space-x-1.5 overflow-x-auto">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mr-2">
            Results ({results.length}):
          </span>

          {results.map((res, idx) => {
            const isActive = idx === activeResultIndex;
            const snippet = res.queryText
              .replace(/\s+/g, ' ')
              .trim()
              .substring(0, 32);

            return (
              <div
                key={idx}
                onClick={() => onSelectResultTab(idx)}
                className={`group flex items-center space-x-1.5 rounded-t px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer select-none ${
                  isActive
                    ? 'bg-neutral-950 font-semibold text-neutral-100 border-t-2 border-emerald-500'
                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                }`}
                title={res.queryText}
              >
                <span>Result #{idx + 1}</span>
                <span className="text-[10px] opacity-60">[{snippet}...]</span>
                {res.error ? (
                  <span className="text-red-400 font-bold text-[10px]">⚠️</span>
                ) : (
                  <span className="text-emerald-400 text-[10px]">
                    ({res.result?.rows.length || 0})
                  </span>
                )}

                {onCloseResultTab && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseResultTab(idx);
                    }}
                    className="ml-1 rounded px-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400 transition-colors"
                    title="Close this result tab"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Latency, Status Info & Clear All Action */}
        <div className="flex items-center space-x-3 text-[11px] font-mono text-neutral-400">
          {onClearAllResults && (
            <button
              onClick={onClearAllResults}
              className="text-[10px] text-neutral-500 hover:text-neutral-300 hover:underline px-1"
              title="Clear all result tabs"
            >
              Clear All
            </button>
          )}

          {currentResult.error ? (
            <span className="text-red-400">Failed</span>
          ) : (
            <>
              <span>Rows: {currentResult.result?.rows.length || 0}</span>
              <span className="text-neutral-700">|</span>
              <span className="text-emerald-400">{currentResult.executionTimeMs}ms</span>
            </>
          )}
        </div>
      </div>

      {/* Grid or Error View for Selected Result */}
      <div className="flex-1 overflow-hidden">
        {currentResult.error ? (
          <div className="p-4 text-xs font-mono text-red-400 bg-red-950/20 m-2 rounded border border-red-900/50">
            <span className="font-bold">Execution Error:</span> {currentResult.error}
          </div>
        ) : (
          <DataGrid
            columns={currentResult.result?.columns || []}
            rows={currentResult.result?.rows || []}
            connectionId={connectionId}
            transport={transport}
            onCellEdited={onCellEdited}
          />
        )}
      </div>
    </div>
  );
};
