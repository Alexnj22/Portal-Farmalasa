// Reglas del chat con clientes que necesita la app del personal y que no viven
// en `chatClientes.js` (ese archivo lo comparten la app de clientes y el
// portal, y lo edita otra sesión: lo nuevo de la app va acá). El catálogo de
// etiquetas, la espera, el día del hilo y `etiquetarConversacion` SÍ están
// allá y se usan de allá.

/** Alterna una etiqueta en la lista, en el orden del catálogo (para el selector). */
export function alternarEtiqueta(lista, clave, catalogo) {
    const claves = Object.keys(catalogo ?? {});
    if (!claves.includes(clave)) return lista ?? [];
    const actual = new Set(lista ?? []);
    if (actual.has(clave)) actual.delete(clave); else actual.add(clave);
    return claves.filter((k) => actual.has(k));
}

/** `★★★★☆` de una calificación 1–5, o `null` sin calificación. */
export function estrellas(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v < 1) return null;
    const k = Math.min(5, v);
    return '★'.repeat(k) + '☆'.repeat(5 - k);
}

/** Mi reacción a un mensaje (la del equipo con mi ficha), o `null`. */
export function miReaccion(filas, miId) {
    return (filas ?? []).find((f) => f.autor === 'equipo' && String(f.employee_id) === String(miId))?.emoji ?? null;
}

/* ── Asignación y escalera de espera (2026-10-14, migración
 * `chat_asignacion_y_aviso_mayorista`) ────────────────────────────────────
 * `asignada_a` es el primer empleado que contestó: no cambia si contesta otro y
 * se libera al resolver; no bloquea a nadie. La escalera la sube un cron con la
 * farmacia abierta: a los 15 min sin respuesta se avisa a la sala del asignado
 * (`escalada_sala_at`) y a los 20 min a supervisión (`escalada_supervision_at`,
 * con su fila en `app_chat_incumplimientos`). Acá sólo se LEE: qué decir. */

/** El escalón más alto alcanzado, o `null`: `{ nivel: 'supervision'|'sala', at, texto }`. */
export function escaladaDe(c) {
    if (!c) return null;
    if (c.escalada_supervision_at) return { nivel: 'supervision', at: c.escalada_supervision_at, texto: 'Avisado a supervisión' };
    if (c.escalada_sala_at) return { nivel: 'sala', at: c.escalada_sala_at, texto: 'Avisado a la sala' };
    return null;
}

/** ¿Tiene asignado? (el id, o `null`). Una conversación resuelta no tiene. */
export const asignadoDe = (c) => (c?.asignada_a ? c.asignada_a : null);
