import React, { useState } from 'react';
import { ConnectionConfig, DriverId } from '../types/omnidb';
import { OmniDBTransport } from '../adapters/transport';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig, shouldSave: boolean) => Promise<void>;
  savedConnections?: ConnectionConfig[];
  onSelectSaved?: (config: ConnectionConfig) => void;
  transport: OmniDBTransport;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  savedConnections = [],
  onSelectSaved,
  transport,
}) => {
  const [driver, setDriver] = useState<DriverId>('sqlite');
  const [name, setName] = useState('Local SQLite DB');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(5432);
  const [database, setDatabase] = useState('omnidb.sqlite');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('');
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [useTls, setUseTls] = useState(false);
  const [saveToStore, setSaveToStore] = useState(true);

  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDriverChange = (newDriver: DriverId) => {
    setDriver(newDriver);
    if (newDriver === 'sqlite') {
      setName('Local SQLite DB');
      setDatabase('omnidb.sqlite');
    } else if (newDriver === 'postgres') {
      setName('PostgreSQL Database');
      setPort(5432);
      setDatabase('postgres');
      setUser('postgres');
    } else if (newDriver === 'mysql') {
      setName('MySQL Database');
      setPort(3306);
      setDatabase('mysql');
      setUser('root');
    }
  };

  const getConfig = (): ConnectionConfig => ({
    id: `conn-${Date.now()}`,
    name,
    driver,
    host,
    port: Number(port),
    database,
    user,
    password,
    is_read_only: isReadOnly,
    use_tls: useTls,
  });

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const diag = await transport.testConnection(getConfig());
      setTestResult(`Success! ${diag.server_version} (${diag.latency_ms}ms latency)`);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnecting(true);
    setError(null);
    try {
      const config = getConfig();

      // If user checked saveToStore, persist to SQLite
      if (saveToStore && transport.saveConnection) {
        await transport.saveConnection(config);
      }

      await onConnect(config, saveToStore);
      onClose();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-900 p-6 shadow-2xl text-neutral-100 font-sans">
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <h2 className="text-base font-semibold">New Database Connection</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200">✕</button>
        </div>

        {/* Saved Connections Quick-Select */}
        {savedConnections.length > 0 && (
          <div className="mt-3 rounded border border-neutral-800 bg-neutral-950 p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
              Saved Databases in SQLite Store
            </span>
            <div className="flex flex-wrap gap-1.5">
              {savedConnections.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => {
                    setDriver(sc.driver);
                    setName(sc.name);
                    setHost(sc.host);
                    setPort(sc.port);
                    setDatabase(sc.database);
                    setUser(sc.user);
                    setIsReadOnly(sc.is_read_only);
                    setUseTls(sc.use_tls);
                  }}
                  className="rounded bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1 text-[11px] font-medium text-neutral-200 flex items-center space-x-1"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  <span>{sc.name}</span>
                  <span className="text-neutral-500">({sc.driver})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          <div>
            <label className="block font-medium text-neutral-400 mb-1">Driver Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(['sqlite', 'postgres', 'mysql'] as DriverId[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDriverChange(d)}
                  className={`rounded border py-2 text-center uppercase tracking-wider font-semibold transition-all ${
                    driver === d
                      ? 'border-blue-500 bg-blue-600/20 text-blue-400'
                      : 'border-neutral-800 bg-neutral-800/40 text-neutral-400 hover:border-neutral-700'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-medium text-neutral-400 mb-1">Connection Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>

          {driver === 'sqlite' ? (
            <div>
              <label className="block font-medium text-neutral-400 mb-1">Database File / Path</label>
              <input
                type="text"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder=":memory: or /path/to/database.db"
                required
                className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block font-medium text-neutral-400 mb-1">Host</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    required
                    className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-400 mb-1">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    required
                    className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-neutral-400 mb-1">Database Name</label>
                  <input
                    type="text"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    required
                    className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-400 mb-1">Username</label>
                  <input
                    type="text"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    required
                    className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-neutral-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
                />
              </div>
            </>
          )}

          <div className="flex items-center space-x-4 pt-2">
            <label className="flex items-center space-x-2 text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={isReadOnly}
                onChange={(e) => setIsReadOnly(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-950 text-blue-600 focus:ring-0"
              />
              <span>Read-Only Connection</span>
            </label>

            <label className="flex items-center space-x-2 text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={useTls}
                onChange={(e) => setUseTls(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-950 text-blue-600 focus:ring-0"
              />
              <span>Require SSL/TLS</span>
            </label>

            <label className="flex items-center space-x-2 text-neutral-300 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={saveToStore}
                onChange={(e) => setSaveToStore(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-950 text-blue-600 focus:ring-0"
              />
              <span>Save connection in SQLite store</span>
            </label>
          </div>

          {testResult && (
            <div className="rounded bg-emerald-950/40 border border-emerald-800/60 p-2 text-emerald-400 text-[11px]">
              ✓ {testResult}
            </div>
          )}

          {error && (
            <div className="rounded bg-red-950/40 border border-red-800/60 p-2 text-red-400 text-[11px]">
              ✕ {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-neutral-800">
            <button
              type="button"
              disabled={isTesting || isConnecting}
              onClick={handleTest}
              className="rounded bg-neutral-800 px-3 py-1.5 font-medium text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
            >
              {isTesting ? 'Testing...' : 'Test Connection'}
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 font-medium text-neutral-400 hover:text-neutral-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isConnecting}
                className="rounded bg-blue-600 px-4 py-1.5 font-semibold text-white shadow hover:bg-blue-500 disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
