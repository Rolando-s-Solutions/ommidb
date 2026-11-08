import { create } from 'zustand';
import { TableDiff } from '../types/omnidb';

interface DiffState {
  sourceConnectionId: string | null;
  targetConnectionId: string | null;
  tableDiffs: TableDiff[];
  isComparing: boolean;
  error: string | null;

  setSourceConnection: (id: string | null) => void;
  setTargetConnection: (id: string | null) => void;
  setTableDiffs: (diffs: TableDiff[]) => void;
  setIsComparing: (val: boolean) => void;
  setError: (err: string | null) => void;
  reset: () => void;
}

export const useDiffStore = create<DiffState>((set) => ({
  sourceConnectionId: null,
  targetConnectionId: null,
  tableDiffs: [],
  isComparing: false,
  error: null,

  setSourceConnection: (id) => set({ sourceConnectionId: id }),
  setTargetConnection: (id) => set({ targetConnectionId: id }),
  setTableDiffs: (diffs) => set({ tableDiffs: diffs }),
  setIsComparing: (val) => set({ isComparing: val }),
  setError: (err) => set({ error: err }),
  reset: () =>
    set({
      sourceConnectionId: null,
      targetConnectionId: null,
      tableDiffs: [],
      isComparing: false,
      error: null,
    }),
}));
