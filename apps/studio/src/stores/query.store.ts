import { create } from 'zustand';
import { QueryResult, ColumnValue } from '../types/omnidb';
import { OmniDBTransport } from '../adapters/transport';

export interface QueryTabResult {
  queryText: string;
  result: QueryResult | null;
  error: string | null;
  executionTimeMs: number;
}

export interface EditorTab {
  id: string;
  title: string;
  kind?: 'query' | 'visual_builder';
  content: string;
  language: 'sql' | 'mongoshell' | 'cypher';
  isDirty: boolean;
  results: QueryTabResult[];
  activeResultIndex: number;
  isExecuting: boolean;
  error: string | null;
}

interface QueryWorkspaceState {
  tabs: EditorTab[];
  activeTabId: string | null;

  // Tab management
  createTab: (
    language?: 'sql' | 'mongoshell' | 'cypher',
    initialContent?: string,
    kind?: 'query' | 'visual_builder',
    title?: string
  ) => string;
  openVisualBuilderTab: () => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  executeQueriesParallel: (
    transport: OmniDBTransport,
    connectionId: string,
    queries: string[]
  ) => Promise<void>;
  appendAndExecute: (
    transport: OmniDBTransport,
    connectionId: string,
    queryToAppend: string
  ) => Promise<void>;
  setActiveResultIndex: (tabId: string, index: number) => void;
  closeResultTab: (tabId: string, resultIndex: number) => void;
  clearResults: (tabId: string) => void;

  // Query Execution
  runActiveQuery: (
    transport: OmniDBTransport,
    connectionId: string,
    limit?: number
  ) => Promise<void>;

  // Inline Cell Editing
  editCell: (
    transport: OmniDBTransport,
    connectionId: string,
    schema: string | undefined,
    table: string,
    pkColumn: string,
    pkValue: ColumnValue,
    targetColumn: string,
    newValue: ColumnValue,
    rowIndex: number,
    colIndex: number
  ) => Promise<void>;
}

export const useQueryWorkspaceStore = create<QueryWorkspaceState>((set, get) => ({
  tabs: [
    {
      id: 'tab-1',
      title: 'Query 1',
      content: 'SELECT 1 as id, \'OmniDB Studio\' as title;',
      language: 'sql',
      isDirty: false,
      results: [],
      activeResultIndex: 0,
      isExecuting: false,
      error: null,
    },
  ],
  activeTabId: 'tab-1',

  createTab: (language = 'sql', initialContent = '', kind = 'query', title) => {
    const id = `tab-${Date.now()}`;
    const defaultTitle = kind === 'visual_builder' ? 'Visual Builder' : `Query ${get().tabs.filter(t => t.kind !== 'visual_builder').length + 1}`;
    const newTab: EditorTab = {
      id,
      title: title || defaultTitle,
      kind,
      content: initialContent,
      language,
      isDirty: false,
      results: [],
      activeResultIndex: 0,
      isExecuting: false,
      error: null,
    };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id,
    }));
    return id;
  },

  openVisualBuilderTab: () => {
    const existing = get().tabs.find((t) => t.kind === 'visual_builder');
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    return get().createTab('sql', '', 'visual_builder', 'Visual Builder');
  },

  closeTab: (tabId) => {
    set((state) => {
      const remaining = state.tabs.filter((t) => t.id !== tabId);
      const nextActive =
        state.activeTabId === tabId
          ? remaining.length > 0
            ? remaining[remaining.length - 1].id
            : null
          : state.activeTabId;
      return { tabs: remaining, activeTabId: nextActive };
    });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setActiveResultIndex: (tabId, index) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, activeResultIndex: index } : t
      ),
    }));
  },

  closeResultTab: (tabId, resultIndex) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;

        const updatedResults = t.results.filter((_, idx) => idx !== resultIndex);
        let nextIndex = t.activeResultIndex;

        if (nextIndex >= updatedResults.length) {
          nextIndex = Math.max(0, updatedResults.length - 1);
        }

        return {
          ...t,
          results: updatedResults,
          activeResultIndex: nextIndex,
        };
      }),
    }));
  },

  clearResults: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, results: [], activeResultIndex: 0 }
          : t
      ),
    }));
  },

  updateTabContent: (tabId, content) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: true } : t
      ),
    }));
  },

  executeQueriesParallel: async (transport, connectionId, queries) => {
    const { activeTabId } = get();
    if (!activeTabId || queries.length === 0) return;

    // Set loading
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === activeTabId ? { ...t, isExecuting: true, error: null } : t
      ),
    }));

    try {
      // Execute each query in parallel via Promise.all
      const parallelPromises = queries.map(async (queryText) => {
        const start = Date.now();
        try {
          const res = await transport.executeQuery(connectionId, queryText, 100);
          return {
            queryText,
            result: res,
            error: null,
            executionTimeMs: Date.now() - start,
          };
        } catch (err: any) {
          return {
            queryText,
            result: null,
            error: err.message || String(err),
            executionTimeMs: Date.now() - start,
          };
        }
      });

      const results = await Promise.all(parallelPromises);

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                isExecuting: false,
                results,
                activeResultIndex: 0,
                error: null,
              }
            : t
        ),
      }));
    } catch (err: any) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                isExecuting: false,
                error: err.message || String(err),
              }
            : t
        ),
      }));
    }
  },

  appendAndExecute: async (transport, connectionId, queryToAppend) => {
    const { tabs, activeTabId, createTab } = get();
    let currentTabId = activeTabId;

    if (!currentTabId || tabs.length === 0) {
      currentTabId = createTab('sql', '');
    }

    const currentTab = get().tabs.find((t) => t.id === currentTabId);
    const existingContent = currentTab?.content.trim() || '';
    const newContent = existingContent
      ? `${existingContent}\n\n${queryToAppend}`
      : queryToAppend;

    // Update active tab with appended query and set executing
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === currentTabId
          ? { ...t, content: newContent, isDirty: true, isExecuting: true, error: null }
          : t
      ),
    }));

    try {
      const start = Date.now();
      const res = await transport.executeQuery(connectionId, queryToAppend, 50);
      const singleResult: QueryTabResult = {
        queryText: queryToAppend,
        result: res,
        error: null,
        executionTimeMs: Date.now() - start,
      };

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === currentTabId
            ? {
                ...t,
                isExecuting: false,
                results: [singleResult],
                activeResultIndex: 0,
                error: null,
              }
            : t
        ),
      }));
    } catch (err: any) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === currentTabId
            ? {
                ...t,
                isExecuting: false,
                error: err.message || String(err),
              }
            : t
        ),
      }));
    }
  },

  runActiveQuery: async (transport, connectionId, limit = 100) => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    // Set tab to executing state
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === activeTabId ? { ...t, isExecuting: true, error: null } : t
      ),
    }));

    try {
      const result = await transport.executeQuery(connectionId, tab.content, limit);
      const singleResult: QueryTabResult = {
        queryText: tab.content,
        result,
        error: null,
        executionTimeMs: result.execution_time_ms,
      };
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                isExecuting: false,
                results: [singleResult],
                activeResultIndex: 0,
                error: null,
              }
            : t
        ),
      }));
    } catch (err: any) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                isExecuting: false,
                error: err.message || String(err),
              }
            : t
        ),
      }));
    }
  },

  editCell: async (
    transport,
    connectionId,
    schema,
    table,
    pkColumn,
    pkValue,
    targetColumn,
    newValue,
    rowIndex,
    colIndex
  ) => {
    await transport.updateCell(
      connectionId,
      schema,
      table,
      pkColumn,
      pkValue,
      targetColumn,
      newValue
    );

    // Optimistically update the grid in active tab
    const { activeTabId } = get();
    if (!activeTabId) return;

    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== activeTabId || t.results.length === 0) return t;
        const currentRes = t.results[t.activeResultIndex];
        if (!currentRes || !currentRes.result) return t;

        const newRows = [...currentRes.result.rows];
        if (newRows[rowIndex]) {
          const rowCopy = [...newRows[rowIndex]];
          rowCopy[colIndex] = newValue;
          newRows[rowIndex] = rowCopy;
        }

        const updatedResults = [...t.results];
        updatedResults[t.activeResultIndex] = {
          ...currentRes,
          result: { ...currentRes.result, rows: newRows },
        };

        return {
          ...t,
          results: updatedResults,
        };
      }),
    }));
  },
}));
