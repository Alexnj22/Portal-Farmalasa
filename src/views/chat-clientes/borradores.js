// Lo que se estaba escribiendo en cada conversación —texto, foto, producto u
// oferta— sobrevive a cerrar el panel de la burbuja (2026-10-21: «si doy click
// afuera que se cierre el chat, pero si tenía escrito o adjuntado algo, que no
// se borre»). Vive en memoria del módulo y no en `localStorage` porque una foto
// es un `File`, que no se puede guardar ahí; recargar la página lo pierde, igual
// que cualquier app de mensajería web.

const borradores = new Map();   // id de conversación → { texto, archivo, adjunto }

export const leerBorrador = (id) => borradores.get(id) ?? null;

export function guardarBorrador(id, { texto, archivo, adjunto }) {
    if (texto?.trim() || archivo || adjunto) borradores.set(id, { texto, archivo, adjunto });
    else borradores.delete(id);
}

export const tieneBorrador = (id) => borradores.has(id);
