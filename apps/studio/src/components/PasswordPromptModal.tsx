import React, { useState } from 'react';
import { ConnectionConfig } from '../types/omnidb';

interface PasswordPromptModalProps {
  isOpen: boolean;
  connection: ConnectionConfig | null;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}

export const PasswordPromptModal: React.FC<PasswordPromptModalProps> = ({
  isOpen,
  connection,
  onClose,
  onSubmit,
}) => {
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !connection) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(password);
      setPassword('');
      onClose();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-2xl text-neutral-100 font-sans">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center space-x-2">
            <span className="text-base text-amber-400">🔒</span>
            <h3 className="text-sm font-semibold">Password Required</h3>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200">
            ✕
          </button>
        </div>

        <div className="mt-3 text-xs text-neutral-400 space-y-1">
          <div>
            Connecting to: <span className="font-semibold text-neutral-200">{connection.name}</span>
          </div>
          <div className="text-[11px] font-mono text-neutral-500">
            {connection.user}@{connection.host}:{connection.port}/{connection.database}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1">
              Database Password
            </label>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password..."
              required
              className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="rounded bg-red-950/40 border border-red-800/60 p-2 text-red-400 text-[11px]">
              ✕ {error}
            </div>
          )}

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 font-medium text-neutral-400 hover:text-neutral-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-1.5 font-semibold text-white shadow transition-colors"
            >
              {isSubmitting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
