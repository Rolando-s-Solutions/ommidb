import React from 'react';
import { useToastStore, ToastItem } from '../stores/toast.store';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  const getTypeStyles = (type: ToastItem['type']) => {
    switch (type) {
      case 'success':
        return {
          icon: '✓',
          badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
        };
      case 'error':
        return {
          icon: '✕',
          badge: 'bg-red-500/20 text-red-400 border-red-500/40',
        };
      case 'warning':
        return {
          icon: '⚠',
          badge: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
        };
      case 'confirm':
        return {
          icon: '❓',
          badge: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
        };
      default:
        return {
          icon: 'ℹ',
          badge: 'bg-neutral-800 text-neutral-300 border-neutral-700',
        };
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col space-y-2 pointer-events-none">
      {toasts.map((toast) => {
        const { icon, badge } = getTypeStyles(toast.type);

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex flex-col rounded-lg border bg-neutral-900/95 p-3.5 shadow-2xl backdrop-blur-md transition-all duration-200 ${badge} font-sans`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-2.5">
                <span className="text-sm font-bold">{icon}</span>
                <div className="flex-1">
                  <h4 className="text-xs font-semibold text-neutral-100">
                    {toast.title}
                  </h4>
                  {toast.message && (
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-300 font-mono whitespace-pre-wrap">
                      {toast.message}
                    </p>
                  )}
                </div>
              </div>

              {toast.type !== 'confirm' && (
                <button
                  onClick={() => removeToast(toast.id)}
                  className="ml-3 text-neutral-500 hover:text-neutral-200 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Confirmation Action Buttons */}
            {toast.actions && toast.actions.length > 0 && (
              <div className="mt-3 flex items-center justify-end space-x-2 pt-2 border-t border-neutral-800">
                {toast.actions.map((act, idx) => {
                  let btnColor = 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200';
                  if (act.style === 'danger') {
                    btnColor = 'bg-red-600 hover:bg-red-500 text-white shadow-sm';
                  } else if (act.style === 'primary') {
                    btnColor = 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm';
                  }

                  return (
                    <button
                      key={idx}
                      onClick={act.onClick}
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${btnColor}`}
                    >
                      {act.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
