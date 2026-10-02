// ── Encuestas a clientes — la lógica que no conoce al navegador ─────────────
//
// Plan: docs/PLAN-ENCUESTAS-A-CLIENTES-2026-10-01.md. Las reglas que importan
// (quién aprueba, que lo aprobado no se edite, si una encuesta está lista para
// revisarse) viven en la base —migración `encuestas_clientes_base`—. Esto es lo
// que la pantalla necesita para construir y pintar.
//
// El cuestionario es un jsonb `{ secciones: [{ id, titulo, descripcion,
// preguntas: [...] }] }`. Cada pregunta:
//   { id, tipo, texto, ayuda?, obligatoria, dimension?, opciones?, escala?, condicion? }
// `condicion` = { pregunta, operador, valor }: la pregunta sólo se muestra si
// la respuesta a otra ANTERIOR cumple. La base rechaza una condición que mire
// hacia adelante.

/**
 * Tipos de pregunta. Deben coincidir con `v_tipos` de
 * `encuesta_cliente_problemas_de`. `numerica` = su respuesta es un número que
 * se puede promediar y comparar con `<`/`>`.
 */
export const TIPOS_PREGUNTA = [
    { value: 'nps',      label: 'Recomendación (0 a 10)', corto: 'NPS',       icono: 'Gauge',        numerica: true,
      ayuda: 'La pregunta estándar de lealtad. Mide promotores (9-10) contra detractores (0-6).' },
    { value: 'csat',     label: 'Satisfacción con caritas', corto: 'Caritas', icono: 'Smile',        numerica: true,
      ayuda: 'Cinco caritas, de muy insatisfecho a muy satisfecho.' },
    { value: 'likert',   label: 'Escala de acuerdo (1 a 5)', corto: 'Acuerdo', icono: 'SlidersHorizontal', numerica: true,
      ayuda: 'Una afirmación y qué tan de acuerdo está: de «Nada» a «Totalmente».' },
    { value: 'unica',    label: 'Opción única',          corto: 'Única',      icono: 'CircleDot',    opciones: true,
      ayuda: 'Elige una sola respuesta de la lista.' },
    { value: 'multiple', label: 'Opción múltiple',       corto: 'Múltiple',   icono: 'ListChecks',   opciones: true,
      ayuda: 'Puede marcar varias.' },
    { value: 'si_no',    label: 'Sí o no',               corto: 'Sí/No',      icono: 'ToggleRight',
      ayuda: 'Dos botones grandes.' },
    { value: 'ranking',  label: 'Ordenar por importancia', corto: 'Ordenar',  icono: 'ArrowDownUp',  opciones: true,
      ayuda: 'Ordena las opciones de la más a la menos importante.' },
    { value: 'numero',   label: 'Número',                corto: 'Número',     icono: 'Hash',         numerica: true,
      ayuda: 'Una cantidad: edad, veces que nos visita al mes…' },
    { value: 'texto',    label: 'Respuesta abierta',     corto: 'Abierta',    icono: 'MessageSquareText',
      ayuda: 'Que lo cuente con sus palabras.' },
];
export const tipoDe = (v) => TIPOS_PREGUNTA.find((t) => t.value === v) || TIPOS_PREGUNTA[TIPOS_PREGUNTA.length - 1];

/** Las caritas del CSAT y los rótulos del Likert, de 1 a 5. */
export const CARITAS = [
    { valor: 1, emoji: '😠', label: 'Muy insatisfecho' },
    { valor: 2, emoji: '🙁', label: 'Insatisfecho' },
    { valor: 3, emoji: '😐', label: 'Normal' },
    { valor: 4, emoji: '🙂', label: 'Satisfecho' },
    { valor: 5, emoji: '😄', label: 'Muy satisfecho' },
];
export const ACUERDO = ['Nada de acuerdo', 'En desacuerdo', 'Neutral', 'De acuerdo', 'Totalmente de acuerdo'];

/** El ciclo. Deben coincidir con el CHECK de `encuestas_cliente.estado`. */
export const ESTADOS = {
    borrador:    { label: 'Borrador',    variant: 'neutral', texto: 'Se está diseñando. Cuando esté lista, envíala a revisión.' },
    en_revision: { label: 'En revisión', variant: 'warning',   texto: 'Esperando la aprobación de gerencia. Mientras tanto no se edita.' },
    aprobada:    { label: 'Aprobada',    variant: 'success', texto: 'Aprobada. Ya se puede publicar para empezar a aplicarla.' },
    publicada:   { label: 'En campo',    variant: 'info',   texto: 'Publicada: se está aplicando. Se cierra sola al llegar a la fecha o a la meta.' },
    cerrada:     { label: 'Cerrada',     variant: 'neutral', texto: 'Ya no recibe respuestas. Para repetirla, duplícala.' },
    archivada:   { label: 'Archivada',   variant: 'neutral', texto: 'Guardada fuera de la lista principal.' },
};
export const estadoDe = (e) => ESTADOS[e] || ESTADOS.borrador;

/** Qué se ve en cada pestaña de la lista. */
export const GRUPOS = {
    diseno:   ['borrador', 'en_revision', 'aprobada'],
    campo:    ['publicada'],
    cerradas: ['cerrada', 'archivada'],
};

export const CANALES = [
    { value: 'qr',         label: 'QR o enlace',  icono: 'QrCode',     ayuda: 'El cliente responde desde su teléfono, sin iniciar sesión.' },
    { value: 'entrevista', label: 'Entrevista',   icono: 'Mic',        ayuda: 'Alguien del equipo la aplica desde el portal.' },
    { value: 'kiosco',     label: 'Tablet en sala', icono: 'Tablet',   ayuda: 'Un dispositivo en el mostrador donde el cliente responde.' },
];
export const canalDe = (v) => CANALES.find((c) => c.value === v) || { value: v, label: v };

export const INCENTIVOS = [
    { value: 'ninguno', label: 'Sin incentivo' },
    { value: 'puntos',  label: 'Puntos' },
    { value: 'muestra', label: 'Muestra médica' },
];

/** Operadores de una condición, según el tipo de la pregunta que se mira. */
export function operadoresPara(tipo) {
    if (tipoDe(tipo).numerica) {
        return [
            { value: '<=', label: 'es menor o igual a' },
            { value: '>=', label: 'es mayor o igual a' },
            { value: '=',  label: 'es igual a' },
        ];
    }
    if (tipo === 'si_no') return [{ value: '=', label: 'es' }];
    if (tipo === 'unica' || tipo === 'multiple') return [{ value: 'incluye', label: 'es / incluye' }];
    return [];
}
export const puedeSerCondicion = (tipo) => operadoresPara(tipo).length > 0;

// ── Construir ──────────────────────────────────────────────────────────────

/** Un id corto que no choque con los que ya hay en el cuestionario. */
export function idNuevo(usados = [], prefijo = 'p') {
    const set = new Set(usados);
    for (;;) {
        const id = `${prefijo}${Math.random().toString(36).slice(2, 8)}`;
        if (!set.has(id)) return id;
    }
}

export const idsDe = (cuestionario) => (cuestionario?.secciones || [])
    .flatMap((s) => [s.id, ...(s.preguntas || []).map((p) => p.id)]);

export function nuevaPregunta(tipo, usados) {
    const p = { id: idNuevo(usados), tipo, texto: '', obligatoria: tipo !== 'texto' };
    if (tipoDe(tipo).opciones) {
        p.opciones = [{ id: 'a', texto: '' }, { id: 'b', texto: '' }];
    }
    return p;
}

export function nuevaSeccion(usados, titulo = '') {
    return { id: idNuevo(usados, 's'), titulo, preguntas: [] };
}

/** Una opción nueva con la letra siguiente libre. */
export function nuevaOpcion(opciones = []) {
    const usadas = new Set(opciones.map((o) => o.id));
    let i = 0;
    while (usadas.has(String.fromCharCode(97 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''))) i += 1;
    return { id: String.fromCharCode(97 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''), texto: '' };
}

/** Mueve el elemento `i` a `i + delta` dentro de una copia del arreglo. */
export function mover(lista, i, delta) {
    const j = i + delta;
    if (j < 0 || j >= lista.length) return lista;
    const n = [...lista];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
}

/** Todas las preguntas en orden, con su número visible (1, 2, 3…). */
export function preguntasEnOrden(cuestionario) {
    let n = 0;
    return (cuestionario?.secciones || []).flatMap((s) => (s.preguntas || [])
        .map((p) => ({ ...p, numero: (n += 1), seccionId: s.id })));
}

/**
 * Al cambiar el tipo de una pregunta se conserva lo que sigue teniendo sentido
 * (texto, dimensión, obligatoria) y se descarta lo que no (opciones de un
 * tipo sin opciones).
 */
export function cambiarTipo(pregunta, tipo) {
    const n = { ...pregunta, tipo };
    if (tipoDe(tipo).opciones) {
        if (!n.opciones?.length) n.opciones = [{ id: 'a', texto: '' }, { id: 'b', texto: '' }];
    } else {
        delete n.opciones;
    }
    return n;
}

/** La pregunta sin su condición (se muestra siempre). */
export function sinCondicion(p) {
    const r = { ...p };
    delete r.condicion;
    return r;
}

/**
 * Quitar una pregunta deja huérfanas las condiciones que la miraban: se borran
 * también, o esas preguntas quedarían escondidas para siempre.
 */
export function quitarPregunta(cuestionario, preguntaId) {
    return {
        ...cuestionario,
        secciones: (cuestionario.secciones || []).map((s) => ({
            ...s,
            preguntas: (s.preguntas || [])
                .filter((p) => p.id !== preguntaId)
                .map((p) => (p.condicion?.pregunta === preguntaId ? sinCondicion(p) : p)),
        })),
    };
}

// ── Contestar ──────────────────────────────────────────────────────────────

/**
 * ¿Se muestra esta pregunta con lo que lleva contestado? La misma regla la
 * usan la vista previa y (fase 2) el formulario real: si divergieran, el
 * revisor aprobaría un recorrido que el cliente no hace.
 */
export function cumpleCondicion(condicion, respuestas = {}) {
    if (!condicion || !condicion.pregunta) return true;
    const r = respuestas[condicion.pregunta];
    if (r === undefined || r === null || r === '') return false;
    const v = condicion.valor;
    switch (condicion.operador) {
        case '<=': return Number(r) <= Number(v);
        case '>=': return Number(r) >= Number(v);
        case '=':  return typeof v === 'boolean' ? r === v : Number(r) === Number(v);
        case 'incluye': return Array.isArray(r) ? r.includes(v) : r === v;
        default: return true;
    }
}

/** Las preguntas que el cliente ve, en orden, con lo que lleva contestado. */
export function preguntasVisibles(cuestionario, respuestas) {
    return preguntasEnOrden(cuestionario).filter((p) => cumpleCondicion(p.condicion, respuestas));
}

/** ¿Falta contestar alguna obligatoria visible? Devuelve la primera. */
export function primeraSinContestar(preguntas, respuestas = {}) {
    return preguntas.find((p) => {
        if (!p.obligatoria) return false;
        const r = respuestas[p.id];
        if (Array.isArray(r)) return r.length === 0;
        return r === undefined || r === null || r === '';
    }) || null;
}

/** Texto de una condición, para mostrarla en el constructor. */
export function textoDeCondicion(condicion, preguntas) {
    if (!condicion?.pregunta) return '';
    const p = preguntas.find((x) => x.id === condicion.pregunta);
    if (!p) return 'Depende de una pregunta que ya no existe';
    const op = operadoresPara(p.tipo).find((o) => o.value === condicion.operador)?.label || condicion.operador;
    let valor = condicion.valor;
    if (p.tipo === 'si_no') valor = condicion.valor ? 'Sí' : 'No';
    else if (p.opciones) valor = p.opciones.find((o) => o.id === condicion.valor)?.texto || '—';
    return `Sólo si la ${p.numero} ${op} ${valor}`;
}

// ── Muestra ────────────────────────────────────────────────────────────────

/**
 * Cuántas respuestas hacen falta para que el resultado represente a una
 * población de `N` clientes, con 95% de confianza y el margen dado. Es la
 * fórmula de proporciones con p = 0.5 (el peor caso) y corrección por
 * población finita. Una SUGERENCIA: la meta la decide marketing.
 */
export function muestraSugerida(N, margen = 0.05, z = 1.96) {
    if (!N || N <= 0) return null;
    const n0 = (z * z * 0.25) / (margen * margen);
    return Math.ceil(n0 / (1 + (n0 - 1) / N));
}

/** Meta total de una encuesta: la general o la suma de las cuotas. */
export function metaTotal(encuesta, sucursales = []) {
    if (encuesta?.alcance === 'sucursales') {
        const suma = sucursales.reduce((a, s) => a + (Number(s.meta) || 0), 0);
        return suma || null;
    }
    return encuesta?.meta_total || null;
}

/** Resumen corto de cuándo termina: «Hasta el 15 nov · 384 respuestas». */
export function resumenDeCierre(encuesta, sucursales, fechaTexto) {
    const partes = [];
    if (encuesta.fecha_fin) partes.push(`Hasta el ${fechaTexto(encuesta.fecha_fin, { day: 'numeric', month: 'short' })}`);
    const meta = metaTotal(encuesta, sucursales);
    if (meta) partes.push(`${meta} respuestas`);
    return partes.join(' · ') || 'Sin cierre definido';
}
