import { create } from 'zustand';

export const useToastStore = create((set, get) => ({
    isOpen: false,
    title: '',
    message: '',
    type: 'success',
    theme: 'light',
    _timer: null,
    showToast: (title, message, type = 'success', theme = 'light', duration = 3500) => {
        const prev = get()._timer;
        if (prev) clearTimeout(prev);
        const timer = setTimeout(() => set({ isOpen: false, _timer: null }), duration);
        set({ isOpen: true, title, message, type, theme, _timer: timer });
    },
    hideToast: () => {
        const prev = get()._timer;
        if (prev) clearTimeout(prev);
        set({ isOpen: false, _timer: null });
    },
}));
