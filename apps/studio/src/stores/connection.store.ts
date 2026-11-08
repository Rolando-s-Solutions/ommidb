import { create } from 'zustand';
import {
  ConnectionConfig,
  DriverCapabilities,
  SchemaHierarchy,
  TableDetail,
  ServerDiagnostics,
} from '../types/omnidb';
import { OmniDBTransport } from '../adapters/transport';

interface ConnectionState {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  activeCapabilities: DriverCapabilities | null;
  activeSchemaTree: SchemaHierarchy | null;
  activeDiagnostics: ServerDiagnostics | null;
  selectedTableDetail: TableDetail | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setConnections: (conns: ConnectionConfig[]) => void;
  loadSavedConnections: (transport: OmniDBTransport) => Promise<void>;
  restoreActiveSession: (transport: OmniDBTransport) => Promise<boolean>;
  deleteSavedConnection: (transport: OmniDBTransport, id: string) => Promise<void>;
  addConnection: (conn: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string | null) => void;
  connect: (transport: OmniDBTransport, config: ConnectionConfig) => Promise<void>;
  disconnect: (transport: OmniDBTransport, connectionId: string) => Promise<void>;
  selectIntrospectTable: (
    transport: OmniDBTransport,
    schema: string | undefined,
    table: string
  ) => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  activeCapabilities: null,
  activeSchemaTree: null,
  activeDiagnostics: null,
  selectedTableDetail: null,
  isLoading: false,
  error: null,

  setConnections: (conns) => set({ connections: conns }),

  loadSavedConnections: async (transport: OmniDBTransport) => {
    if (transport.listSavedConnections) {
      try {
        const saved = await transport.listSavedConnections();
        set({ connections: saved });
      } catch (err) {
        console.error('Failed to load saved connections:', err);
      }
    }
  },

  restoreActiveSession: async (transport: OmniDBTransport): Promise<boolean> => {
    try {
      const stored = localStorage.getItem('omnidb_active_session');
      if (!stored) return false;

      const sessionData: { config: ConnectionConfig; password?: string } = JSON.parse(stored);
      if (!sessionData || !sessionData.config?.id) return false;

      const { config, password } = sessionData;
      set({ isLoading: true });

      // Check if backend already has an active session alive
      if (transport.getSessionStatus) {
        const status = await transport.getSessionStatus(config.id);
        if (status.active) {
          const capabilities = await transport.getCapabilities(config.driver);
          const schemaTree = await transport.fetchSchemaTree(config.id);

          set({
            activeConnectionId: config.id,
            activeDiagnostics: status.diagnostics || null,
            activeCapabilities: capabilities,
            activeSchemaTree: schemaTree,
            isLoading: false,
          });
          return true;
        }
      }

      // If session not alive on backend but we have config (and password if required)
      if (config.driver.toLowerCase() === 'sqlite' || password || config.password) {
        const fullConfig = {
          ...config,
          password: password || config.password,
        };
        await get().connect(transport, fullConfig);
        return true;
      }

      set({ isLoading: false });
      return false;
    } catch (err) {
      console.warn('Failed to restore active session:', err);
      set({ isLoading: false });
      return false;
    }
  },

  deleteSavedConnection: async (transport: OmniDBTransport, id: string) => {
    if (transport.deleteSavedConnection) {
      try {
        await transport.deleteSavedConnection(id);
      } catch (err) {
        console.error('Failed to delete saved connection:', err);
      }
    }
    get().removeConnection(id);
  },

  addConnection: (conn) =>
    set((state) => ({ connections: [...state.connections, conn] })),

  removeConnection: (id) =>
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
    })),

  setActiveConnection: (id) => set({ activeConnectionId: id }),

  connect: async (transport: OmniDBTransport, config: ConnectionConfig) => {
    set({ isLoading: true, error: null });
    try {
      const diagnostics = await transport.testConnection(config);
      await transport.connect(config);
      const capabilities = await transport.getCapabilities(config.driver);
      const schemaTree = await transport.fetchSchemaTree(config.id);

      // Persist active session in localStorage so refreshing maintains the connection
      try {
        localStorage.setItem(
          'omnidb_active_session',
          JSON.stringify({ config, password: config.password })
        );
      } catch (e) {
        console.warn('Could not store active session in localStorage', e);
      }

      set({
        activeConnectionId: config.id,
        activeDiagnostics: diagnostics,
        activeCapabilities: capabilities,
        activeSchemaTree: schemaTree,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
      throw err;
    }
  },

  disconnect: async (transport: OmniDBTransport, connectionId: string) => {
    try {
      await transport.disconnect(connectionId);
    } finally {
      try {
        localStorage.removeItem('omnidb_active_session');
      } catch (e) {}

      if (get().activeConnectionId === connectionId) {
        set({
          activeConnectionId: null,
          activeCapabilities: null,
          activeSchemaTree: null,
          activeDiagnostics: null,
          selectedTableDetail: null,
        });
      }
    }
  },

  selectIntrospectTable: async (
    transport: OmniDBTransport,
    schema: string | undefined,
    table: string
  ) => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return;

    set({ isLoading: true, error: null });
    try {
      const detail = await transport.introspectTable(activeConnectionId, schema, table);
      set({ selectedTableDetail: detail, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
    }
  },
}));
