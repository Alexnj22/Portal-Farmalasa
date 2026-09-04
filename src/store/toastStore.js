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

/* ── Un error se lee, un éxito se ve ────────────────────────────────────────
 *
 * Los 3.5 segundos alcanzan para «Ingreso anotado»: ese aviso se reconoce de un
 * vistazo y no hay nada que hacer con él. Un error hay que LEERLO —«La caja no
 * aceptó el movimiento. Vuelve a intentarlo; si sigue igual, avisa a
 * Sistemas.» son 90 caracteres— y después decidir qué se hace.
 *
 * Reportado el 2026-09-03 en Salud 3: tres intentos seguidos de sacar $40 que
 * fallaron, y al preguntar qué decía el error nadie lo recordaba. No podían: el
 * único sitio donde se dijo ya se había ido, y lo que quedaba en pantalla era
 * un formulario sin explicación.
 *
 * El plazo va acá y no en cada llamada por lo mismo que el saneo de abajo: un
 * sitio nuevo escrito mañana no se va a acordar de pasar el número. Quien
 * necesite otro, lo pasa — un `duration` explícito sigue mandando.
 *
 * Y el aviso tiene su ✕: alargarlo no deja a nadie esperando.
 *
 * `info` se separó el 2026-09-04 por el mismo motivo, medido otra vez: un
 * `info` no confirma lo que se pidió —para eso está `success`—, dice que pasó
 * algo DISTINTO y casi siempre trae un número que hay que cruzar contra lo que
 * uno tenía en la cabeza. «Publicó 0 borradores exitosamente · 38 sin tocar,
 * las ajustó alguien a mano» son 74 caracteres y una pregunta; en 3.5 s no se
 * lee, y el reporte fue literal: «no alcancé a leer». Son 21 de 428. */
const PLAZO = { error: 10000, info: 8000, otros: 3500 };

export const useToastStore = create((set, get) => ({
    isOpen: false,
    title: '',
    message: '',
    type: 'success',
    _timer: null,
    showToast: (title, message, type = 'success', duration, { humano = false } = {}) => {
        const prev = get()._timer;
        if (prev) clearTimeout(prev);
        const vive = duration ?? PLAZO[type] ?? PLAZO.otros;
        const timer = setTimeout(() => set({ isOpen: false, _timer: null }), vive);
        set({ isOpen: true, title, message: sanear(message, type, humano), type, _timer: timer });
    },
    hideToast: () => {
        const prev = get()._timer;
        if (prev) clearTimeout(prev);
        set({ isOpen: false, _timer: null });
    },
}));
