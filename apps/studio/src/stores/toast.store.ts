import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'confirm';

export interface ToastAction {
  label: string;
  onClick: () => void;
  style?: 'primary' | 'danger' | 'secondary';
}

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  durationMs?: number; // 0 or undefined for persistent / confirm
  actions?: ToastAction[];
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showWarning: (title: string, message?: string) => void;
  showInfo: (title: string, message?: string) => void;
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmLabel?: string
  ) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastItem = { ...toast, id };

    set((state) => ({ toasts: [...state.toasts, newToast] }));

    if (toast.type !== 'confirm' && toast.durationMs !== 0) {
      const duration = toast.durationMs || 4000;
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }

    return id;
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  showSuccess: (title, message) => {
    get().addToast({ title, message, type: 'success' });
  },

  showError: (title, message) => {
    get().addToast({ title, message, type: 'error', durationMs: 6000 });
  },

  showWarning: (title, message) => {
    get().addToast({ title, message, type: 'warning' });
  },

  showInfo: (title, message) => {
    get().addToast({ title, message, type: 'info' });
  },

  confirm: (title, message, onConfirm, confirmLabel = 'Confirm') => {
    const id = `toast-confirm-${Date.now()}`;
    const toast: ToastItem = {
      id,
      title,
      message,
      type: 'confirm',
      actions: [
        {
          label: confirmLabel,
          style: 'danger',
          onClick: () => {
            onConfirm();
            get().removeToast(id);
          },
        },
        {
          label: 'Cancel',
          style: 'secondary',
          onClick: () => {
            get().removeToast(id);
          },
        },
      ],
    };
    set((state) => ({ toasts: [...state.toasts, toast] }));
  },
}));
