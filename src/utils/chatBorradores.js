// Lo que se estaba escribiendo en cada conversación del chat con clientes
// —texto, foto, producto u oferta— sobrevive a cerrar el panel o salir del
// hilo (2026-10-21: «si doy click afuera que se cierre el chat, pero si tenía
// escrito o adjuntado algo, que no se borre»). Es del núcleo desde el
// 2026-10-22: lo usan el `Compositor` del portal y el de la app del personal.
//
// Vive en memoria del módulo y no en `localStorage` porque una foto es un
// `File` (portal) o un `uri` local (app), que no se guardan ahí; recargar la
// página o cerrar la app lo pierde, igual que cualquier app de mensajería.
// Cada lado guarda las claves que tiene (`archivo` el portal, `foto` la app):
// el borrador se conserva mientras cualquiera de ellas traiga algo.

const borradores = new Map();   // id de conversación → { texto, archivo|foto, adjunto }

export const leerBorrador = (id) => borradores.get(id) ?? null;

export function guardarBorrador(id, borrador) {
    const b = borrador ?? {};
    const conAlgo = Object.entries(b).some(([k, v]) => (k === 'texto' ? !!String(v ?? '').trim() : !!v));
    if (conAlgo) borradores.set(id, b);
    else borradores.delete(id);
}

export const tieneBorrador = (id) => borradores.has(id);
