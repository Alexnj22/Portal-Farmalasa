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

/**
 * La categoría de antigüedad de la pregunta 1 (A <1 año, B <3, C <5, D 5+),
 * que el formulario de respuesta llena solo desde la fecha de ingreso. Vivía
 * dentro de `EncuestaAdminView`; la app captura respuestas con la misma regla.
 */
export function categoriaDeAntiguedad(fechaIngreso, ahora = Date.now()) {
    if (!fechaIngreso) return null;
    const meses = (ahora - new Date(fechaIngreso).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (Number.isNaN(meses)) return null;
    if (meses < 12) return 'A';
    if (meses < 36) return 'B';
    if (meses < 60) return 'C';
    return 'D';
}

// ── A quién va una encuesta interna ─────────────────────────────────────────

/** Las cuatro formas de dirigir una encuesta: todo el personal, unas
 *  sucursales, las jefaturas de sala o unas personas. */
export const ALCANCES_DE_ENCUESTA = [
    { id: 'all',       label: 'Todos' },
    { id: 'branches',  label: 'Sucursales' },
    { id: 'roles',     label: 'Jefaturas' },
    { id: 'employees', label: 'Personal' },
];

/** Qué ids se guardan con el alcance: con «todos» o «jefaturas», ninguno. */
export const idsDelAlcance = (alcance, ids) => ((alcance === 'all' || alcance === 'roles') ? [] : (ids || []));

/** Quiénes deberían responderla —del alcance guardado— y todavía no lo hicieron.
 *  Con «todos» (o sin ids) la lista no se arma: sería todo el personal. */
export function pendientesDelAlcance(encuesta, empleados, respondieron) {
    if (!encuesta) return [];
    const ids = encuesta.scope_ids || [];
    let pool;
    if (encuesta.scope_tipo === 'roles' && ids.length) pool = (empleados || []).filter((e) => ids.includes(e.role_id));
    else if (encuesta.scope_tipo === 'branches' && ids.length) pool = (empleados || []).filter((e) => ids.some((id) => e.branch?.id === id));
    else if (encuesta.scope_tipo === 'employees' && ids.length) pool = (empleados || []).filter((e) => ids.includes(e.id));
    else return [];
    return pool.filter((e) => !respondieron.has(e.id));
}

// ── El análisis de la encuesta de clima (Resumen, Segmentos, Individuos) ────
// Lo usan `EncuestaView` del portal y `encuesta` de la app.

/** P3: por qué se quedan. */
export const RAZONES_DE_PERMANENCIA = [
    { k: 'A', label: 'Me encanta, quiero jubilarme' },
    { k: 'B', label: 'Estabilidad y beneficios' },
    { k: 'C', label: 'Sin otra opción por ahora' },
    { k: 'D', label: 'Buscando otro trabajo' },
];
/** P34: con quién comunican las inconformidades. */
export const CANALES_DE_INCONFORMIDAD = [
    { k: 'A', label: 'Jefe inmediato' },
    { k: 'B', label: 'Supervisión / Admin' },
    { k: 'C', label: 'Compañeros' },
    { k: 'D', label: 'Nadie (se lo guardan)' },
];
/** Los rangos de la autocalificación (1 a 10, o A–D en las encuestas viejas). */
export const RANGOS_DE_AUTOCALIFICACION = [
    { k: 'A', label: '9 – 10' }, { k: 'B', label: '7 – 8' }, { k: 'C', label: '5 – 6' }, { k: 'D', label: '1 – 4' },
];
export const IDX_RAZONES = 2;
export const IDX_INCONFORMIDADES = 33;

/** La pregunta numérica de la encuesta es la autocalificación (por defecto, la 31). */
export function indiceDeAutocalificacion(preguntas) {
    const p = (preguntas || []).find((x) => x.tipo === 'numerica');
    return p ? p.idx : 30;
}

/** Cuántos eligieron A, B, C o D en la pregunta `idx`. */
export function conteoDeOpciones(filas, idx) {
    const map = { A: 0, B: 0, C: 0, D: 0 };
    (filas || []).forEach((r) => { const v = r.r?.[idx]; if (v && map[v] !== undefined) map[v]++; });
    return map;
}

/** Una autocalificación en su rango (A–D) y su número, o null si no se entiende. */
export function leerAutocalificacion(v) {
    if (!v) return null;
    const mid = { A: 9.5, B: 7.5, C: 5.5, D: 2.5 }[v];
    if (mid) return { rango: v, numero: mid };   // encuestas viejas: A/B/C/D
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < 1 || n > 10) return null;
    return { rango: n >= 9 ? 'A' : n >= 7 ? 'B' : n >= 5 ? 'C' : 'D', numero: n };
}

/** La autocalificación de todos: cuántos en cada rango y el promedio. */
export function autocalificacion(filas, idx) {
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    const nums = [];
    (filas || []).forEach((r) => {
        const a = leerAutocalificacion(r.r?.[idx]);
        if (!a) return;
        dist[a.rango]++;
        nums.push(a.numero);
    });
    return { dist, promedio: nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null };
}

/** Las respuestas agrupadas por sucursal, en orden alfabético y con los jefes primero. */
export function filasPorSucursal(filas) {
    const map = {};
    (filas || []).forEach((row) => { const k = row.sucursal || 'Sin sucursal'; (map[k] ||= []).push(row); });
    return Object.entries(map)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, rows]) => [name, [...rows].sort((a, b) => (b.isJefe ? 1 : 0) - (a.isJefe ? 1 : 0))]);
}
