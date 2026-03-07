import { create } from 'zustand';

export const useToastStore = create((set, get) => ({
    isOpen: false,
    title: '',
    message: '',
    type: 'success', // 'success', 'error', 'info'

    showToast: (title, message, type = 'success') => {
        set({ isOpen: true, title, message, type });
        
        // Auto-cierre después de 3.5 segundos
        setTimeout(() => {
            // Solo lo cierra si sigue siendo el mismo toast
            if (get().isOpen) {
                set({ isOpen: false });
            }
        }, 3500);
    },

    hideToast: () => set({ isOpen: false })
}));