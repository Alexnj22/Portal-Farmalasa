import { create } from 'zustand';
import { mensajeAmigable, esTextoTecnico, MENSAJE_GENERICO } from '../utils/errorMessages';

// Guardia de último recurso (2026-08-01). `mensajeAmigable` se llama en cada
// sitio que muestra un error, pero un sitio nuevo escrito mañana no va a
// llamarlo — y esa es exactamente la forma en que se filtró
// `sync_inventory_batch: <!DOCTYPE html>…` a un usuario en producción.
//
// Así que el store también revisa. Solo sobre los toasts de tipo 'error': son
// los únicos cuyo texto puede venir de una máquina. Los avisos escritos por RRHH
// pasan por `humano: true` — texto de una persona, con sus URLs y su largo, que
// no se toca.
//
// Que el default sea "sanear" y el escape sea explícito es a propósito:
// olvidarse del flag arruina un aviso, olvidarse del saneo expone la base de
// datos. El olvido tiene que caer del lado barato.
const sanear = (message, type, humano) => {
    if (humano || type !== 'error') return message;
    if (typeof message !== 'string') return mensajeAmigable(message);
    if (!esTextoTecnico(message)) return message;
    console.error('[toast bloqueado: texto técnico]', message);
    return mensajeAmigable(message, MENSAJE_GENERICO);
};

export const useToastStore = create((set, get) => ({
    isOpen: false,
    title: '',
    message: '',
    type: 'success',
    _timer: null,
    showToast: (title, message, type = 'success', duration = 3500, { humano = false } = {}) => {
        const prev = get()._timer;
        if (prev) clearTimeout(prev);
        const timer = setTimeout(() => set({ isOpen: false, _timer: null }), duration);
        set({ isOpen: true, title, message: sanear(message, type, humano), type, _timer: timer });
    },
    hideToast: () => {
        const prev = get()._timer;
        if (prev) clearTimeout(prev);
        set({ isOpen: false, _timer: null });
    },
}));
