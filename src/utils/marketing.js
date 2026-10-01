// ── Planificador de contenido — la lógica que no conoce al navegador ────────
//
// El módulo `marketing` planifica las publicaciones del mes en redes, lleva el
// flujo de cada pieza con el diseñador, la revisión del calendario y la pauta.
// Las reglas que importan (quién aprueba, qué ve quién antes de publicar el
// mes) viven en la base —migración `marketing_planificador`—; esto es sólo lo
// que la pantalla necesita para pintar.
//
// Las listas de abajo NO tienen tabla a propósito: el valor guardado es un
// código (`reel`) y el rótulo es libre. Las marcas y las redes, que sí cambian
// con el negocio, salen de `marketing_marcas` y `marketing_redes`.

/** Los formatos. Deben coincidir con el CHECK de `marketing_piezas.formato`. */
export const FORMATOS = [
    { value: 'post',     label: 'Post',     icono: 'Image' },
    { value: 'carrusel', label: 'Carrusel', icono: 'GalleryHorizontal' },
    { value: 'reel',     label: 'Reel',     icono: 'Clapperboard' },
    { value: 'video',    label: 'Video',    icono: 'Video' },
    { value: 'historia', label: 'Historia', icono: 'CircleDashed' },
];

/**
 * Los pilares: de qué habla la pieza. Sirven para ver la mezcla del mes —un
 * mes que es todo promoción se nota en el resumen antes de publicarlo.
 */
export const PILARES = [
    { value: 'promocion',       label: 'Promoción',       tono: 'chart-1' },
    { value: 'producto',        label: 'Producto',        tono: 'chart-3' },
    { value: 'educativo',       label: 'Educativo',       tono: 'chart-4' },
    { value: 'institucional',   label: 'Institucional',   tono: 'chart-6' },
    { value: 'fecha_especial',  label: 'Fecha especial',  tono: 'chart-8' },
    { value: 'entretenimiento', label: 'Entretenimiento', tono: 'chart-9' },
];

/**
 * El flujo de una pieza, en el orden en que avanza. `variant` es el de `Badge`.
 * `aprobado` lo pone sólo quien revisa (lo impide un trigger en la base).
 */
export const ESTADOS_PIEZA = [
    { value: 'pendiente',  label: 'Pendiente',  variant: 'neutral' },
    { value: 'en_proceso', label: 'En proceso', variant: 'info' },
    { value: 'finalizado', label: 'Finalizado', variant: 'chart-3' },
    { value: 'cambios',    label: 'Con cambios', variant: 'warning' },
    { value: 'aprobado',   label: 'Aprobado',   variant: 'success' },
    { value: 'publicado',  label: 'Publicado',  variant: 'chart-9' },
];

/** Los estados que el diseñador mueve a mano. */
export const ESTADOS_DEL_DISENADOR = ['pendiente', 'en_proceso', 'finalizado'];

export const ESTADOS_MES = {
    planificando: { label: 'Planificando', variant: 'neutral', texto: 'El diseñador está armando el mes. Se ve el avance; los diseños, cuando lo envíe a revisión.' },
    en_revision:  { label: 'En revisión',  variant: 'info',    texto: 'El calendario está listo para revisar: comenta cada pieza, pide cambios o apruébalo.' },
    con_cambios:  { label: 'Con cambios',  variant: 'warning', texto: 'Se pidieron cambios. Cuando estén hechos, el diseñador lo vuelve a enviar.' },
    aprobado:     { label: 'Aprobado',     variant: 'success', texto: 'El calendario está aprobado para publicar.' },
};

export const PRIORIDADES = [
    { value: 'normal',  label: 'Normal',  variant: 'neutral' },
    { value: 'alta',    label: 'Alta',    variant: 'warning' },
    { value: 'urgente', label: 'Urgente', variant: 'danger' },
];

export const ESTADOS_SOLICITUD = [
    { value: 'nueva',     label: 'Nueva',     variant: 'info' },
    { value: 'aceptada',  label: 'Aceptada',  variant: 'chart-3' },
    { value: 'entregada', label: 'Entregada', variant: 'success' },
    { value: 'rechazada', label: 'Rechazada', variant: 'neutral' },
];

/** Objetivos de pauta. Deben coincidir con el CHECK de `marketing_pautas.objetivo`. */
export const OBJETIVOS_PAUTA = [
    { value: 'alcance',     label: 'Alcance' },
    { value: 'interaccion', label: 'Interacción' },
    { value: 'mensajes',    label: 'Mensajes' },
    { value: 'trafico',     label: 'Tráfico' },
    { value: 'ventas',      label: 'Ventas' },
    { value: 'seguidores',  label: 'Seguidores' },
];

const porValor = (lista) => Object.fromEntries(lista.map((x) => [x.value, x]));
const FORMATO = porValor(FORMATOS);
const PILAR = porValor(PILARES);
const ESTADO = porValor(ESTADOS_PIEZA);
const PRIORIDAD = porValor(PRIORIDADES);
const ESTADO_SOL = porValor(ESTADOS_SOLICITUD);
const OBJETIVO = porValor(OBJETIVOS_PAUTA);

// Un código que la lista no conoce se muestra tal cual y no se cae: es la falla
// segura para un dato escrito por una versión más nueva de la pantalla.
const de = (mapa, v) => mapa[v] || { value: v, label: v || '—', variant: 'neutral' };
export const formatoDe = (v) => de(FORMATO, v);
export const pilarDe = (v) => de(PILAR, v);
export const estadoDe = (v) => de(ESTADO, v);
export const prioridadDe = (v) => de(PRIORIDAD, v);
export const estadoSolicitudDe = (v) => de(ESTADO_SOL, v);
export const objetivoDe = (v) => de(OBJETIVO, v);

/** El primer día del mes `YYYY-MM`, como lo guarda `marketing_meses.mes`. */
export const primerDia = (mes) => `${String(mes).slice(0, 7)}-01`;

/**
 * Las semanas del mes para la grilla, lunes primero. Cada celda es `null`
 * (relleno) o la fecha `YYYY-MM-DD`. Se calcula con fechas UTC para que el
 * huso del navegador no corra un día.
 */
export function semanasDelMes(mes) {
    const [a, m] = String(mes).slice(0, 7).split('-').map(Number);
    const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const desfase = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7;
    const celdas = Array(desfase).fill(null);
    for (let d = 1; d <= dias; d++) celdas.push(`${String(mes).slice(0, 7)}-${String(d).padStart(2, '0')}`);
    while (celdas.length % 7) celdas.push(null);
    const semanas = [];
    for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
    return semanas;
}

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Las piezas agrupadas por fecha, en orden de hora. */
export function piezasPorDia(piezas) {
    const mapa = {};
    for (const p of piezas || []) (mapa[p.fecha] ||= []).push(p);
    for (const k of Object.keys(mapa)) {
        mapa[k].sort((x, y) => String(x.hora || '99').localeCompare(String(y.hora || '99')));
    }
    return mapa;
}

/** El avance del mes: cuántas piezas hay en cada estado y qué falta. */
export function resumenDelMes(piezas) {
    const lista = piezas || [];
    const por = Object.fromEntries(ESTADOS_PIEZA.map((e) => [e.value, 0]));
    for (const p of lista) por[p.estado] = (por[p.estado] || 0) + 1;
    const total = lista.length;
    const listas = por.finalizado + por.aprobado + por.publicado;
    return {
        total,
        por,
        listas,
        avance: total ? listas / total : 0,
        abiertas: por.pendiente + por.en_proceso + por.cambios,
        pautadas: lista.filter((p) => p.pautar).length,
    };
}

/** Cuántas piezas hay por formato y por pilar: la mezcla del mes. */
export function mezclaDelMes(piezas) {
    const formatos = {};
    const pilares = {};
    for (const p of piezas || []) {
        formatos[p.formato] = (formatos[p.formato] || 0) + 1;
        if (p.pilar) pilares[p.pilar] = (pilares[p.pilar] || 0) + 1;
    }
    return { formatos, pilares };
}

const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

/**
 * Los totales de la pauta. El costo por resultado sólo se calcula con algo
 * gastado Y algún resultado: dividir por cero, o un gasto sin resultados
 * anotados todavía, daría un número que parece una medición y no lo es.
 */
export function totalesDePauta(pautas, presupuestoMes = 0) {
    const t = { presupuesto: 0, gastado: 0, alcance: 0, impresiones: 0, interacciones: 0, mensajes: 0, clics: 0, conResultado: 0 };
    for (const p of pautas || []) {
        t.presupuesto += n(p.presupuesto);
        t.gastado += n(p.gastado);
        t.alcance += n(p.alcance);
        t.impresiones += n(p.impresiones);
        t.interacciones += n(p.interacciones);
        t.mensajes += n(p.mensajes);
        t.clics += n(p.clics);
        if (p.gastado != null) t.conResultado += 1;
    }
    t.presupuestoMes = n(presupuestoMes);
    t.disponible = t.presupuestoMes - t.presupuesto;
    t.costoPorMensaje = t.gastado > 0 && t.mensajes > 0 ? t.gastado / t.mensajes : null;
    t.costoPorClic = t.gastado > 0 && t.clics > 0 ? t.gastado / t.clics : null;
    t.cpm = t.gastado > 0 && t.impresiones > 0 ? (t.gastado / t.impresiones) * 1000 : null;
    return t;
}

/** ¿Es imagen o video? Decide cómo se muestra la vista previa. */
export function tipoDeArchivo(archivo) {
    const mime = String(archivo?.mime || '');
    if (mime.startsWith('image/')) return 'imagen';
    if (mime.startsWith('video/')) return 'video';
    if (mime === 'application/pdf') return 'pdf';
    return archivo?.enlace ? 'enlace' : 'otro';
}

/** Texto para buscar una pieza por lo que dice. */
export function textoDePieza(p, marcas = {}) {
    return [p.titulo, p.copy, p.hashtags, p.notas, formatoDe(p.formato).label,
        pilarDe(p.pilar).label, marcas[p.marca_id]?.nombre].filter(Boolean).join(' ');
}
