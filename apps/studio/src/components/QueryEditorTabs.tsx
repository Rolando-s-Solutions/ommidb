import React, { useState, useRef, useMemo } from 'react';
import { useQueryWorkspaceStore } from '../stores/query.store';
import { OmniDBTransport } from '../adapters/transport';
import { SchemaHierarchy } from '../types/omnidb';
import { VisualQueryBuilder } from './VisualQueryBuilder';

interface QueryEditorTabsProps {
  transport: OmniDBTransport;
  connectionId: string | null;
  schemaTree?: SchemaHierarchy | null;
}

interface StatementRange {
  index: number;
  startChar: number;
  endChar: number;
  startLine: number;
  endLine: number;
  text: string;
}

export const QueryEditorTabs: React.FC<QueryEditorTabsProps> = ({
  transport,
  connectionId,
  schemaTree = null,
}) => {
  const {
    tabs,
    activeTabId,
    createTab,
    closeTab,
    setActiveTab,
    updateTabContent,
  } = useQueryWorkspaceStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [selectedStatementIndices, setSelectedStatementIndices] = useState<number[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorGutterRef = useRef<HTMLDivElement>(null);

  // Sync vertical scrolling between gutter and textarea
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (editorGutterRef.current) {
      editorGutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Compute statement ranges with exact character offsets and 0-based line indices
  const statementRanges = useMemo<StatementRange[]>(() => {
    const content = activeTab?.content || '';
    if (!content.trim()) return [];

    const getLineNumber = (charIndex: number) => {
      let line = 0;
      for (let i = 0; i < charIndex && i < content.length; i++) {
        if (content[i] === '\n') line++;
      }
      return line;
    };

    const ranges: StatementRange[] = [];
    let start = 0;
    let idx = 0;

    for (let i = 0; i < content.length; i++) {
      if (content[i] === ';') {
        const text = content.slice(start, i).trim();
        if (text.length > 0) {
          // Find first non-whitespace char for startLine
          let firstNonWs = start;
          while (firstNonWs < i && /\s/.test(content[firstNonWs])) {
            firstNonWs++;
          }
          ranges.push({
            index: idx++,
            startChar: start,
            endChar: i + 1,
            startLine: getLineNumber(firstNonWs),
            endLine: getLineNumber(i),
            text,
          });
        }
        start = i + 1;
      }
    }

    // Remaining trailing statement without semicolon
    if (start < content.length) {
      const text = content.slice(start).trim();
      if (text.length > 0) {
        let firstNonWs = start;
        while (firstNonWs < content.length && /\s/.test(content[firstNonWs])) {
          firstNonWs++;
        }
        ranges.push({
          index: idx++,
          startChar: start,
          endChar: content.length,
          startLine: getLineNumber(firstNonWs),
          endLine: getLineNumber(content.length - 1),
          text,
        });
      }
    }

    return ranges;
  }, [activeTab?.content]);

  const statements = useMemo(() => statementRanges.map((r) => r.text), [statementRanges]);

  const lines = useMemo(() => {
    return (activeTab?.content || '').split('\n');
  }, [activeTab?.content]);

  // Map each line number (0-indexed) to any statement starting on that line
  const statementByStartLine = useMemo(() => {
    const map = new Map<number, StatementRange>();
    for (const r of statementRanges) {
      if (!map.has(r.startLine)) {
        map.set(r.startLine, r);
      }
    }
    return map;
  }, [statementRanges]);

  // When clicking, moving cursor, or dragging text selection in the editor,
  // detect which queries are touched by the selection/cursor
  const handleEditorCursorOrClick = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const selStart = target.selectionStart;
    const selEnd = target.selectionEnd;

    if (statementRanges.length === 0) return;

    // Check if the user has highlighted a span of text
    if (selEnd > selStart) {
      // Find all statements that intersect [selStart, selEnd]
      const intersecting = statementRanges.filter((r) => {
        // Range r spans [r.startChar, r.endChar]
        return Math.max(selStart, r.startChar) < Math.min(selEnd, r.endChar);
      });

      if (intersecting.length > 0) {
        setSelectedStatementIndices(intersecting.map((r) => r.index));
        return;
      }
    }

    // Single cursor click without highlight span
    const cursorPos = selStart;
    const matchedRange = statementRanges.find(
      (r) => cursorPos >= r.startChar && cursorPos <= r.endChar
    );

    if (matchedRange) {
      setSelectedStatementIndices([matchedRange.index]);
    } else {
      // If cursor is at the very end or between statements, find closest preceding
      let closest = statementRanges[0];
      for (const r of statementRanges) {
        if (cursorPos >= r.startChar) {
          closest = r;
        }
      }
      if (closest) {
        setSelectedStatementIndices([closest.index]);
      }
    }
  };

  const toggleStatementSelect = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStatementIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const handleRun = async () => {
    if (!connectionId || !activeTab) return;

    // If multiple specific statements are selected, execute them in parallel
    if (selectedStatementIndices.length > 0) {
      const queriesToRun = selectedStatementIndices.map((i) => {
        const s = statements[i];
        return s.endsWith(';') ? s : `${s};`;
      });
      await useQueryWorkspaceStore
        .getState()
        .executeQueriesParallel(transport, connectionId, queriesToRun);
    } else if (statements.length > 1) {
      // If user hasn't toggled specific ones but there are multiple statements, run all in parallel
      const queriesToRun = statements.map((s) => (s.endsWith(';') ? s : `${s};`));
      await useQueryWorkspaceStore
        .getState()
        .executeQueriesParallel(transport, connectionId, queriesToRun);
    } else {
      // Single query execution
      await useQueryWorkspaceStore.getState().runActiveQuery(transport, connectionId);
    }
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      {/* Tab Bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2 pt-1 text-xs">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isVisual = tab.kind === 'visual_builder';

            return (
              <div
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSelectedStatementIndices([]);
                }}
                className={`group flex cursor-pointer items-center space-x-2 rounded-t px-3 py-1.5 transition-colors ${
                  isActive
                    ? 'bg-neutral-950 font-medium text-neutral-100 border-t-2 border-blue-500'
                    : 'text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200'
                }`}
              >
                <span className="flex items-center space-x-1">
                  {isVisual && <span className="text-amber-400 font-bold">◫</span>}
                  <span>{tab.title}</span>
                </span>
                {tab.isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-neutral-200"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={() => createTab('sql')}
            className="px-2 py-1 text-neutral-400 hover:text-neutral-100 text-sm font-semibold"
            title="New Query Tab"
          >
            +
          </button>
          <button
            onClick={() => useQueryWorkspaceStore.getState().openVisualBuilderTab()}
            className="flex items-center space-x-1 px-2 py-1 text-neutral-400 hover:text-amber-300 text-xs font-medium border-l border-neutral-800 ml-1"
            title="Open Visual Builder Canvas Tab"
          >
            <span>◫</span>
            <span>+ Visual Canvas</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2 pb-1">
          {activeTab?.kind !== 'visual_builder' && statements.length > 1 && (
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-neutral-400 font-mono">
                {selectedStatementIndices.length > 0 ? (
                  <span>
                    Selected: <span className="text-amber-400 font-bold">{selectedStatementIndices.length}</span> queries
                  </span>
                ) : (
                  <span>
                    Parallel: <span className="text-emerald-400 font-bold">All {statements.length}</span> queries
                  </span>
                )}
              </span>
              {selectedStatementIndices.length > 0 && (
                <button
                  onClick={() => setSelectedStatementIndices([])}
                  className="text-[10px] text-neutral-400 hover:text-white underline"
                >
                  Clear Selection
                </button>
              )}
            </div>
          )}

          {activeTab?.kind !== 'visual_builder' && (
            <button
              disabled={!connectionId || activeTab?.isExecuting}
              onClick={() => handleRun()}
              className="flex items-center space-x-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              <span>
                {activeTab?.isExecuting
                  ? 'Executing...'
                  : selectedStatementIndices.length > 0
                  ? `Execute ${selectedStatementIndices.length} in Parallel`
                  : statements.length > 1
                  ? `Execute All ${statements.length} in Parallel`
                  : 'Execute'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Main Tab Content: Either Visual Builder Canvas or SQL Text Area with Gutter */}
      {activeTab?.kind === 'visual_builder' ? (
        <div className="flex-1 overflow-hidden">
          <VisualQueryBuilder
            schemaTree={schemaTree}
            connectionId={connectionId}
            transport={transport}
            onGeneratedSqlChange={(sql) => {
              if (activeTab && activeTab.content !== sql) {
                updateTabContent(activeTab.id, sql);
              }
            }}
            onApplyQuery={(sql) => {
              createTab('sql', sql);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Synchronized Gutter: Line Numbers + Query Indicators aligned to query start lines */}
          <div
            ref={editorGutterRef}
            className="w-20 shrink-0 border-r border-neutral-800 bg-neutral-900/40 py-3 select-none overflow-hidden font-mono text-xs"
            style={{ lineHeight: '1.5rem' }}
          >
            {lines.map((_, lineIdx) => {
              const stmt = statementByStartLine.get(lineIdx);
              const isSelected = stmt ? selectedStatementIndices.includes(stmt.index) : false;

              return (
                <div
                  key={lineIdx}
                  className="h-6 flex items-center justify-between px-2 text-[11px]"
                  style={{ height: '1.5rem' }}
                >
                  {/* Line number */}
                  <span className="text-neutral-600 text-[10px] w-6 text-right">
                    {lineIdx + 1}
                  </span>

                  {/* Statement Indicator aligned exactly with query's first line */}
                  {stmt ? (
                    <button
                      onClick={(e) => toggleStatementSelect(stmt.index, e)}
                      className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center space-x-0.5 transition-all ${
                        isSelected
                          ? 'bg-amber-500/30 text-amber-300 border border-amber-500/80 shadow-sm'
                          : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white border border-neutral-700/60'
                      }`}
                      title={`Query #${stmt.index + 1}: Click to select for execution`}
                    >
                      <span>{isSelected ? '✓' : '▶'}</span>
                      <span>#{stmt.index + 1}</span>
                    </button>
                  ) : (
                    <span className="w-8" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Text Area */}
          {activeTab && (
            <div className="flex-1 p-0 overflow-hidden relative">
              <textarea
                ref={textareaRef}
                value={activeTab.content}
                onChange={(e) => updateTabContent(activeTab.id, e.target.value)}
                onClick={handleEditorCursorOrClick}
                onKeyUp={handleEditorCursorOrClick}
                onSelect={handleEditorCursorOrClick}
                onMouseUp={handleEditorCursorOrClick}
                onScroll={handleScroll}
                placeholder="Write SQL queries here... (e.g. SELECT * FROM users; SELECT * FROM orders;)"
                className="h-full w-full resize-none border-none bg-neutral-900/90 py-3 px-3 font-mono text-xs text-neutral-100 outline-none focus:ring-0 leading-6"
                style={{ lineHeight: '1.5rem' }}
                spellCheck={false}
              />
            </div>
          )}
        </div>
      )}

      {/* Query Status / Error Banner */}
      {activeTab?.error && (
        <div className="border-t border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs text-red-400">
          ⚠️ {activeTab.error}
        </div>
      )}
      {activeTab?.results && activeTab.results.length > 0 && activeTab.results[activeTab.activeResultIndex]?.result && (
        <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-900 px-3 py-1 text-[11px] text-neutral-400">
          <span>Rows: {activeTab.results[activeTab.activeResultIndex].result?.rows.length ?? 0}</span>
          <span>Time: {activeTab.results[activeTab.activeResultIndex].result?.execution_time_ms ?? 0}ms</span>
        </div>
      )}
    </div>
  );
};
