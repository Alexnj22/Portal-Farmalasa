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
    { value: 'app',        label: 'App de clientes', icono: 'Smartphone', ayuda: 'Aparece en la app Puntos Salud; una respuesta por cliente, y los puntos se acreditan solos.' },
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

/**
 * Las preguntas que el cliente ve, en orden, y sólo las respuestas que cuentan.
 *
 * Se recorre EN ORDEN y cada condición se evalúa contra lo ya visible: una
 * respuesta que quedó escondida (porque el cliente cambió de opinión más
 * arriba) no puede abrir otra pregunta. Es exactamente lo que hace
 * `encuesta_cliente_limpiar` en la base; si divergieran, el cliente
 * contestaría un recorrido que la base rechaza.
 */
export function recorrido(cuestionario, respuestas = {}) {
    const visibles = [];
    const limpias = {};
    for (const p of preguntasEnOrden(cuestionario)) {
        if (!cumpleCondicion(p.condicion, limpias)) continue;
        visibles.push(p);
        const r = respuestas[p.id];
        const vacia = r === undefined || r === null || (typeof r === 'string' && !r.trim()) || (Array.isArray(r) && !r.length);
        if (!vacia) limpias[p.id] = typeof r === 'string' ? r.trim() : r;
    }
    return { visibles, limpias };
}

/** Las preguntas que el cliente ve, en orden, con lo que lleva contestado. */
export function preguntasVisibles(cuestionario, respuestas) {
    return recorrido(cuestionario, respuestas).visibles;
}

/** Un teléfono de El Salvador: 8 dígitos que empiezan en 2, 6 o 7. */
export function telefonoValido(texto) {
    const d = String(texto || '').replace(/\D/g, '').slice(-8);
    return /^[267]\d{7}$/.test(d);
}

/**
 * ¿Se pueden guardar los datos de contacto? Devuelve el motivo para no
 * hacerlo, o `null`. Sin consentimiento no se guarda nada; con él, hace falta
 * el teléfono o el nombre, y el teléfono, si viene, tiene que ser válido.
 */
export function motivoParaNoGuardarContacto(c) {
    if (!c?.consiente) return 'Para guardar los datos hay que aceptar el consentimiento.';
    if (!String(c.telefono || '').trim() && !String(c.nombre || '').trim()) return 'Escribe el teléfono o el nombre, o envía sin datos.';
    if (String(c.telefono || '').trim() && !telefonoValido(c.telefono)) return 'El teléfono debe tener 8 dígitos.';
    return null;
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

// ── Resultados ─────────────────────────────────────────────────────────────

/**
 * Cómo leer un NPS (de −100 a 100). Los cortes son los de uso común: sobre 50
 * es excelente, sobre 0 hay más promotores que detractores.
 */
export function lecturaNps(puntaje) {
    if (puntaje == null) return { label: 'Sin datos', variant: 'neutral' };
    if (puntaje >= 50) return { label: 'Excelente', variant: 'success' };
    if (puntaje >= 0) return { label: 'Bueno', variant: 'info' };
    return { label: 'Por mejorar', variant: 'danger' };
}

/** Lo que significa un valor guardado, en palabras: «Sí», «De acuerdo», el texto de la opción. */
export function textoDeValor(pregunta, valor) {
    if (valor === undefined || valor === null || valor === '') return '';
    switch (pregunta.tipo) {
        case 'si_no': return valor ? 'Sí' : 'No';
        case 'csat': return CARITAS.find((c) => c.valor === Number(valor))?.label || String(valor);
        case 'likert': return ACUERDO[Number(valor) - 1] || String(valor);
        case 'unica': return pregunta.opciones?.find((o) => o.id === valor)?.texto || String(valor);
        case 'multiple':
        case 'ranking':
            return (Array.isArray(valor) ? valor : [valor])
                .map((id) => pregunta.opciones?.find((o) => o.id === id)?.texto || id).join(pregunta.tipo === 'ranking' ? ' > ' : '; ');
        default: return String(valor);
    }
}

/** Las opciones de una pregunta para pintar su distribución, en orden y con su rótulo. */
export function categoriasDe(pregunta) {
    switch (pregunta.tipo) {
        case 'nps': return Array.from({ length: 11 }, (_, n) => ({ clave: String(n), label: String(n) }));
        case 'csat': return CARITAS.map((c) => ({ clave: String(c.valor), label: `${c.emoji} ${c.label}` }));
        case 'likert': return ACUERDO.map((l, i) => ({ clave: String(i + 1), label: l }));
        case 'si_no': return [{ clave: 'true', label: 'Sí' }, { clave: 'false', label: 'No' }];
        case 'unica':
        case 'multiple': return (pregunta.opciones || []).filter((o) => o.texto).map((o) => ({ clave: o.id, label: o.texto }));
        default: return [];
    }
}

/** El CSV de respuestas: una columna por pregunta, con el valor en palabras. */
export function tablaDeRespuestas(cuestionario, filas, { fechaHora }) {
    const preguntas = preguntasEnOrden(cuestionario);
    const headers = ['Fecha', 'Sucursal', 'Canal', 'Entrevistó', 'NPS',
        ...preguntas.map((p) => `${p.numero}. ${p.texto}`), 'Nombre', 'Teléfono', 'Duración (s)'];
    const rows = filas.map((f) => [
        fechaHora(f.fecha), f.sucursal, canalDe(f.canal).label, f.entrevistador || '', f.nps ?? '',
        ...preguntas.map((p) => textoDeValor(p, f.respuestas?.[p.id])),
        f.contacto_nombre || '', f.telefono || '', f.duracion_seg ?? '',
    ]);
    return { headers, rows };
}

// ── Editar el cuestionario (el `Constructor` del portal y el de la app) ─────
// Todas devuelven un cuestionario NUEVO; ninguna cambia el que recibe.

const seccionesDe = (c) => (c?.secciones || []);
const conSecciones = (c, secciones) => ({ ...(c || {}), secciones });

/** Cambia los datos de una sección (título, descripción, preguntas). */
export function cambiarSeccion(cuestionario, si, cambios) {
    return conSecciones(cuestionario, seccionesDe(cuestionario).map((s, j) => (j === si ? { ...s, ...cambios } : s)));
}

/** Reemplaza una pregunta de una sección. */
export function cambiarPregunta(cuestionario, si, pi, nueva) {
    const s = seccionesDe(cuestionario)[si];
    return cambiarSeccion(cuestionario, si, { preguntas: (s?.preguntas || []).map((p, j) => (j === pi ? nueva : p)) });
}

export function agregarSeccion(cuestionario) {
    return conSecciones(cuestionario, [...seccionesDe(cuestionario), nuevaSeccion(idsDe(cuestionario))]);
}

/** Agrega una pregunta del tipo dado al final de la sección; devuelve también su id. */
export function agregarPregunta(cuestionario, si, tipo) {
    const p = nuevaPregunta(tipo, idsDe(cuestionario));
    const s = seccionesDe(cuestionario)[si];
    return { cuestionario: cambiarSeccion(cuestionario, si, { preguntas: [...(s?.preguntas || []), p] }), id: p.id };
}

/** Duplica una pregunta justo debajo de ella; devuelve también el id de la copia. */
export function duplicarPregunta(cuestionario, si, pi) {
    const ps = [...(seccionesDe(cuestionario)[si]?.preguntas || [])];
    const copia = { ...JSON.parse(JSON.stringify(ps[pi])), id: idNuevo(idsDe(cuestionario)) };
    ps.splice(pi + 1, 0, copia);
    return { cuestionario: cambiarSeccion(cuestionario, si, { preguntas: ps }), id: copia.id };
}

/**
 * Sube (`d = -1`) o baja (`d = 1`) una pregunta. Al pasar el borde de una
 * sección entra a la vecina: al final de la de arriba o al principio de la de abajo.
 */
export function moverPregunta(cuestionario, si, pi, d) {
    const secciones = seccionesDe(cuestionario);
    const ps = secciones[si]?.preguntas || [];
    if (pi + d >= 0 && pi + d < ps.length) return cambiarSeccion(cuestionario, si, { preguntas: mover(ps, pi, d) });
    const destino = si + d;
    if (destino < 0 || destino >= secciones.length) return cuestionario;
    const p = ps[pi];
    return conSecciones(cuestionario, secciones.map((s, j) => {
        if (j === si) return { ...s, preguntas: ps.filter((_, k) => k !== pi) };
        if (j === destino) return { ...s, preguntas: d > 0 ? [p, ...(s.preguntas || [])] : [...(s.preguntas || []), p] };
        return s;
    }));
}

/** Quita una sección con sus preguntas (y las condiciones que dependían de ellas). */
export function quitarSeccion(cuestionario, si) {
    let q = cuestionario;
    for (const p of seccionesDe(cuestionario)[si]?.preguntas || []) q = quitarPregunta(q, p.id);
    return conSecciones(q, seccionesDe(q).filter((_, j) => j !== si));
}

/** Con qué valor arranca una condición que mira a esa pregunta. */
export function valorInicialDeCondicion(p) {
    if (p.tipo === 'nps') return 6;
    if (p.tipo === 'csat' || p.tipo === 'likert') return 2;
    if (p.tipo === 'si_no') return false;
    if (p.opciones?.length) return p.opciones[0].id;
    return 0;
}

/** La condición «mostrar sólo si» que mira a la pregunta `c`, con su primer operador. */
export const condicionSobre = (c) => ({ pregunta: c.id, operador: operadoresPara(c.tipo)[0].value, valor: valorInicialDeCondicion(c) });

// ── Ajustes, resumen y exportación (2026-10-09) ─────────────────────────────
// Lo que decide la pestaña Ajustes, el resumen con IA y el nombre del CSV,
// escrito UNA vez para el portal y la app del personal.

/** Un número de meta escrito a mano: vacío = sin meta; si no, un entero de 1 para arriba. */
export const numeroDeMetaEscrito = (v) => (v === '' || v == null ? null : Math.max(1, parseInt(String(v).replace(/\D/g, ''), 10) || 0) || null);

/** Prender o apagar un canal sin repetirlo. */
export const canalesCon = (canales, c, on) => (on ? [...new Set([...(canales || []), c])] : (canales || []).filter((x) => x !== c));

/** Agregar o quitar una sucursal de la encuesta (nueva sin meta). */
export const sucursalesCon = (lista, branchId, on) => (on
    ? [...(lista || []), { branch_id: branchId, meta: null }]
    : (lista || []).filter((s) => s.branch_id !== branchId));

/** La cuota de una sucursal, escrita a mano. */
export const conMetaDeSucursal = (lista, branchId, v) => (lista || []).map((s) => (s.branch_id === branchId ? { ...s, meta: numeroDeMetaEscrito(v) } : s));

/** Cada sucursal con la muestra sugerida para su población. */
export const conMetasSugeridas = (lista, poblacion) => (lista || []).map((s) => ({ ...s, meta: muestraSugerida(poblacion?.[s.branch_id] || 0) }));

/** La muestra sugerida para lo elegido: por sucursal, la suma de cada una; general, la del total de atenciones. */
export function sugeridaDeLaEncuesta(encuesta, lista, poblacion) {
    if (encuesta?.alcance === 'sucursales') return (lista || []).reduce((a, s) => a + (muestraSugerida(poblacion?.[s.branch_id] || 0) || 0), 0);
    return muestraSugerida((lista || []).reduce((a, s) => a + (poblacion?.[s.branch_id] || 0), 0));
}

/**
 * Los comentarios que viajan a la IA para resumir: los más recientes, sin
 * repetidos y recortados a 300 letras, hasta 100. La IA es cara y tiene cuota.
 */
export function loteParaResumir(comentarios, max = 100) {
    const vistos = new Set();
    const lote = [];
    for (const c of comentarios || []) {
        const clave = String(c.texto ?? '').trim().toLowerCase();
        if (!clave || vistos.has(clave)) continue;
        vistos.add(clave);
        lote.push({ sucursal: c.sucursal, nps: c.nps, pregunta: c.pregunta, texto: String(c.texto).slice(0, 300) });
        if (lote.length >= max) break;
    }
    return lote;
}

/** Si el resumen se puede (re)hacer: no hay uno, o entraron `minimo_nuevos` comentarios desde el anterior. */
export function estadoDelResumen(resumen) {
    const hay = !!resumen?.texto;
    const nuevos = resumen?.nuevos ?? 0;
    const minimo = resumen?.minimo_nuevos ?? 5;
    const puede = !hay || nuevos >= minimo;
    return {
        hay, nuevos, puede,
        boton: !hay ? 'Resumir con IA' : puede ? `Actualizar resumen (${nuevos} nuevos)` : 'Resumen al día',
        ayuda: hay && !puede ? `Se actualiza cuando entren ${minimo} comentarios nuevos (van ${nuevos}).` : null,
    };
}

/** El nombre del CSV de respuestas: sin tildes ni símbolos. */
export const archivoDeEncuesta = (nombre) => `encuesta-${String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').toLowerCase()}`;

/** Una encuesta se puede borrar mientras es borrador (también una plantilla). */
export const encuestaBorrable = (e, puedeEditar) => !!puedeEditar && e?.estado === 'borrador';

/** El enlace público de una encuesta en una sucursal (QR, ticket, mensaje); `tablet` la deja en modo de mostrador. */
export const ORIGEN_DEL_PORTAL = 'https://portal.farmasalud.lat';
export const enlaceDeEncuesta = (token, tablet = false, origen = ORIGEN_DEL_PORTAL) => `${origen}/e/${token}${tablet ? '?modo=tablet' : ''}`;
