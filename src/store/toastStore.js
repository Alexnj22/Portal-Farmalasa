import { create } from 'zustand';

export const useToastStore = create((set, get) => ({
    isOpen: false,
    title: '',
    message: '',
    type: 'success',
    theme: 'light',
    showToast: (title, message, type = 'success', theme = 'light') => {
        set({ isOpen: true, title, message, type, theme });
        
        setTimeout(() => {
            if (get().isOpen) {
                set({ isOpen: false });
            }
        }, 3500);
    },
    hideToast: () => set({ isOpen: false })
}));