/**
 * Clima organizacional — cómo se puntúa una respuesta, un bloque y una
 * pregunta, y cómo se leen las filas de la base. Vivía en `EncuestaView`; se
 * mudó el 2026-10-05 para que la app muestre los mismos resultados.
 *
 * Las respuestas son A–D (A = 4 … D = 1) o un número del 1 al 10, que se
 * lleva a la misma escala (9–10 = 4, 7–8 = 3, 5–6 = 2, 1–4 = 1). Una pregunta
 * INVERTIDA se puntúa al revés (5 − valor).
 */
export const PUNTAJE_DE_OPCION = { A: 4, B: 3, C: 2, D: 1 };

export function valorDeRespuesta(v) {
    if (!v || v === '-') return null;
    if (PUNTAJE_DE_OPCION[String(v).toUpperCase()] !== undefined) return PUNTAJE_DE_OPCION[String(v).toUpperCase()];
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 1 && n <= 10) return n >= 9 ? 4 : n >= 7 ? 3 : n >= 5 ? 2 : 1;
    return null;
}

/** El puntaje de un bloque (0–100) sobre las respuestas `rows` (`{ r: [...] }`), o `null` si nadie contestó. */
export function puntajeDeBloque(rows, indices, invertidas = new Set()) {
    let total = 0, count = 0;
    for (const row of rows || []) {
        for (const i of indices || []) {
            const v = valorDeRespuesta(row.r?.[i]);
            if (v !== null) { total += invertidas.has(i) ? (5 - v) : v; count++; }
        }
    }
    return count > 0 ? (total / (count * 4)) * 100 : null;
}

/** Cuántos contestaron A, B, C y D en una pregunta. */
export function distribucionDePregunta(rows, idx) {
    const d = { A: 0, B: 0, C: 0, D: 0 };
    let total = 0;
    for (const r of rows || []) {
        const v = r.r?.[idx];
        if (v && d[v] !== undefined) { d[v]++; total++; }
    }
    return { ...d, total };
}

/** El nivel de un puntaje, con su severidad. */
export function nivelDePuntaje(pct) {
    if (pct >= 85) return { label: 'Excelente', severidad: 'success' };
    if (pct >= 70) return { label: 'Bueno', severidad: 'info' };
    if (pct >= 55) return { label: 'Regular', severidad: 'warning' };
    return { label: 'Crítico', severidad: 'danger' };
}

// ── Las filas de la base, a la forma que usan las pantallas ──────────────────

export const bloqueDeLaBase = (b) => ({
    id: b.numero, _dbId: b.id, nombre: b.nombre, color: b.color, desc: b.descripcion, indices: b.indices,
    ctx: b.ctx_dirigido ? { dirigido: b.ctx_dirigido, tipo: b.ctx_tipo, badge: b.ctx_badge, nota: b.ctx_nota } : null,
});

export const preguntaDeLaBase = (p, bloquesBase = []) => ({
    id: p.numero,
    bloque: p.bloque_id ? bloquesBase.find((b) => b.id === p.bloque_id)?.numero ?? null : null,
    idx: p.indice, texto: p.texto, opciones: p.opciones, tipo: p.tipo, invertida: p.invertida,
});

export function respuestaDeLaBase(r) {
    const fn = (r.employee?.first_names || '').split(' ')[0];
    const ln = (r.employee?.last_names || '').split(' ')[0];
    return {
        nombre: `${fn} ${ln}`.trim() || r.display_name || '',
        isJefe: r.is_jefe, sucursal: r.employee?.branch?.name || '', photo: r.employee?.photo_url || null,
        r: r.responses, comentario: r.comentario,
    };
}

/** Los índices de las preguntas que se puntúan al revés. */
export const indicesInvertidos = (preguntas) => new Set((preguntas || []).filter((p) => p.invertida).map((p) => p.idx));

/** El índice global: todas las preguntas de todos los bloques juntas. */
export const puntajeGlobal = (rows, bloques, invertidas) => puntajeDeBloque(rows, (bloques || []).flatMap((b) => b.indices || []), invertidas);

/**
 * El puntaje (0–100, redondeado) de UNA persona en unas preguntas — el que usa
 * la administración de encuestas para cada fila. Ojo: no es lo mismo que
 * `puntajeDeBloque`, que junta todas las respuestas de todos antes de dividir.
 */
export function puntajeDePersona(respuestas, indices, invertidas = new Set()) {
    let total = 0, count = 0;
    for (const i of indices || []) {
        const raw = valorDeRespuesta(respuestas?.[i]);
        if (raw == null) continue;
        total += invertidas.has(i) ? (5 - raw) : raw;
        count++;
    }
    return count > 0 ? Math.round((total / (count * 4)) * 100) : null;
}

/** El promedio de los puntajes por persona (redondeado), o `null` si nadie contestó. */
export function promedioPorPersona(filas, indices, invertidas = new Set()) {
    const s = (filas || []).map((r) => puntajeDePersona(r.responses || [], indices, invertidas)).filter((x) => x != null);
    return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
}

export const ESTADO_ENCUESTA = { borrador: 'Borrador', activa: 'Activa', cerrada: 'Cerrada', archivada: 'Archivada' };
export const TIPO_ENCUESTA = { clima: 'Clima', satisfaccion: 'Satisfacción', desempeno: 'Desempeño', adhoc: 'Personalizada' };
