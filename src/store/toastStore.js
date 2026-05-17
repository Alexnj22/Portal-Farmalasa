import { create } from 'zustand';

export const useToastStore = create((set, get) => ({
    isOpen: false,
    title: '',
    message: '',
    type: 'success',
    theme: 'light',
    _timer: null,
    showToast: (title, message, type = 'success', theme = 'light') => {
        const prev = get()._timer;
        if (prev) clearTimeout(prev);
        const timer = setTimeout(() => set({ isOpen: false, _timer: null }), 3500);
        set({ isOpen: true, title, message, type, theme, _timer: timer });
    },
    hideToast: () => {
        const prev = get()._timer;
        if (prev) clearTimeout(prev);
        set({ isOpen: false, _timer: null });
    },
}));
