// Chat con clientes — las reglas que comparten el portal (`views/chat-clientes`)
// y la app (`apps/mobile/app/chat-clientes`): en qué estado está una
// conversación, cuánto lleva esperando, cómo se rotula al cliente, qué dice el
// estado de una reserva o una receta, y cuándo un mensaje abre una tanda nueva.
// Vivían en `views/chat-clientes/estados.js`, `etiquetas.js` y `PanelCliente`
// (2026-10-12); esos archivos ahora reexportan.
//
// En qué punto está una conversación, DERIVADO de lo que la bandeja ya trae
// (no hay columna de estado en la base más allá de abierta/resuelta). Módulo
// sin componentes, por el fast refresh.
//
// El orden de las preguntas es la regla:
//   1. resuelta                      → «Resuelta»
//   2. lo último lo escribió el equipo → «Esperando al cliente» (la pelota
//      está del otro lado, aunque quien contestó la siga teniendo tomada)
//   3. alguien la tiene tomada         → «En atención · <nombre>»
//   4. lo demás —el cliente escribió y nadie la tiene— → «Nuevo»
//
// «Nuevo» incluye la que alguien abrió y soltó SIN contestar: el contador de
// sin leer quedó en cero, pero el cliente sigue esperando una respuesta.

import { shortEmployeeName } from './nameUtils';
import { diaDe, fechaTexto, hoySV, sumarDias } from './fecha';

export const ESTADOS = {
    nuevo:     { label: 'Nuevo',                variant: 'info' },
    atencion:  { label: 'En atención',          variant: 'chart-6' },
    esperando: { label: 'Esperando al cliente', variant: 'neutral' },
    resuelta:  { label: 'Resuelta',             variant: 'success' },
};

export function estadoDeConversacion(c) {
    if (c?.estado === 'resuelta') return 'resuelta';
    if (c?.ultimo_de === 'equipo') return 'esperando';
    if (c?.tomada_vigente) return 'atencion';
    return 'nuevo';
}

// Los umbrales de la espera: ámbar a los 15 minutos, rojo a la hora.
const AMBAR_MIN = 15;
const ROJO_MIN = 60;

/**
 * Cuánto lleva esperando un «Nuevo». Se cuenta desde `esperando_desde` —el
 * PRIMER mensaje del cliente que todavía nadie contestó, lo pone el trigger de
 * cada mensaje—, no desde el último: un cliente que escribe tres veces en
 * media hora lleva media hora esperando, no un minuto. Sin esa columna (filas
 * viejas), el último mensaje. `null` para los otros estados.
 * `tono`: 'neutral' | 'warning' | 'danger' (variantes de Badge).
 */
export function esperaDe(c, ahora) {
    if (estadoDeConversacion(c) !== 'nuevo') return null;
    const desde = Date.parse(c?.esperando_desde ?? c?.ultimo_mensaje_at);
    if (Number.isNaN(desde)) return null;
    const min = Math.max(0, Math.floor((ahora - desde) / 60_000));
    const label = min < 1 ? 'ahora'
        : min < 60 ? `${min} min`
        : min < 24 * 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
        : `${Math.floor(min / (24 * 60))} d`;
    return { min, label, tono: min > ROJO_MIN ? 'danger' : min > AMBAR_MIN ? 'warning' : 'neutral' };
}

/** Las pestañas de la vista (y los chips del panel): `filtro` → qué estados entran. */
export const FILTROS = {
    abierta:   { label: 'Todas abiertas',       estados: ['nuevo', 'atencion', 'esperando'] },
    nuevo:     { label: 'Nuevas',               estados: ['nuevo'] },
    atencion:  { label: 'En atención',          estados: ['atencion'] },
    esperando: { label: 'Esperando al cliente', estados: ['esperando'] },
    resuelta:  { label: 'Resueltas',            estados: ['resuelta'] },
};

/** El estado que se le pide a la base para ese filtro. */
export const estadoServidor = (filtro) => (filtro === 'resuelta' ? 'resuelta' : 'abierta');


// Las claves de `puntos_niveles` (vip es el primer nivel y se llama Bronce).
export const NIVELES = {
    vip:     { label: 'Bronce',  variant: 'chart-4' },
    plata:   { label: 'Plata',   variant: 'neutral' },
    oro:     { label: 'Oro',     variant: 'warning' },
    platino: { label: 'Platino', variant: 'info' },
};

/** «Team» (es del equipo), «Mayoreo <rango>» o «Cliente». */
export function tipoDeCliente(c) {
    if (c?.es_team) return { label: 'Team', variant: 'chart-1' };
    if (c?.es_mayoreo) return { label: `Mayoreo${c.rango ? ` ${c.rango}` : ''}`, variant: 'chart-9' };
    return { label: 'Cliente', variant: 'neutral' };
}

/** Dos iniciales del nombre del cliente, para cuando no tiene foto. */
export function inicialesDeCliente(nombre) {
    const partes = String(nombre ?? '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    return ((partes[0][0] ?? '') + (partes.length > 2 ? partes[2][0] : partes[1]?.[0] ?? '')).toUpperCase();
}

/** El nombre del cliente con mayúscula inicial (la ficha lo guarda en mayúsculas). */
export function nombreDeCliente(nombre) {
    return String(nombre ?? '').trim().toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase()) || 'Cliente';
}

/** El estado de una reserva viva, en el panel del cliente. */
export const RESERVA_DEL_CHAT = {
    en_revision: { label: 'En revisión', variant: 'warning' },
    pendiente:   { label: 'Pendiente',   variant: 'info' },
    lista:       { label: 'Lista para retirar', variant: 'success' },
};

/** Cómo va la receta de una reserva. */
export const RECETA_DEL_CHAT = {
    pendiente: 'Receta por revisar',
    otra_foto: 'Pidió otra foto de la receta',
    aprobada:  'Receta aprobada',
    rechazada: 'Receta rechazada',
};

/**
 * Un mensaje abre una tanda nueva (con la foto y el nombre de quien contestó)
 * si cambia el autor, o la persona del equipo, o pasaron más de 15 minutos.
 */
export function empiezaTanda(m, previo) {
    return !previo || previo.autor !== m.autor || previo.employee_id !== m.employee_id
        || Date.parse(m.created_at) - Date.parse(previo.created_at) > 15 * 60_000;
}

/** Quién es el autor de un mensaje o de una reacción, dicho corto. */
export function nombreDeAutor({ autor, employee_id: empId }, equipo, cliente) {
    if (autor === 'cliente') return cliente || 'Cliente';
    if (autor === 'sistema') return 'Aviso';
    const emp = empId ? equipo.get(empId) : null;
    return emp ? shortEmployeeName(emp) : 'Alguien del equipo';
}

/** El recorte de un mensaje para citarlo: sus primeros 140 caracteres, o «Foto». */
export function recorteDeMensaje(m) {
    const texto = String(m?.texto ?? '').trim();
    if (texto) return texto.length > 140 ? `${texto.slice(0, 140).trimEnd()}…` : texto;
    if (m?.foto_ruta) return 'Foto';
    if (m?.adjunto?.tipo === 'producto') return m.adjunto.nombre ?? 'Producto';
    if (m?.adjunto?.tipo === 'oferta') return m.adjunto.titulo ?? 'Oferta';
    return 'Mensaje';
}

// ── Etiquetas que el equipo le pone a una conversación (2026-10-13) ────────
//
// Una conversación por cliente, así que etiquetar la conversación es etiquetar
// al cliente. Las claves son las que acepta el CHECK de
// `app_chat_conversaciones.etiquetas` y se guardan con `chat_etiquetar`; el
// rótulo es libre. `icono` es el NOMBRE del ícono (el núcleo no conoce a
// lucide: la pantalla trae su mapa). El orden de este objeto es el orden en
// que se muestran.
export const ETIQUETAS = {
    urgente:     { label: 'Urgente',                variant: 'danger',  icono: 'Siren' },
    medicamento: { label: 'Consulta de medicamento', variant: 'chart-1', icono: 'Pill' },
    receta:      { label: 'Receta',                 variant: 'chart-6', icono: 'FileText' },
    reserva:     { label: 'Reserva',                variant: 'chart-4', icono: 'CalendarClock' },
    precio:      { label: 'Precio',                 variant: 'chart-9', icono: 'BadgeDollarSign' },
    queja:       { label: 'Queja',                  variant: 'warning', icono: 'MessageSquareWarning' },
    seguimiento: { label: 'Seguimiento',            variant: 'chart-8', icono: 'Repeat' },
    frecuente:   { label: 'Cliente frecuente',      variant: 'chart-3', icono: 'Heart' },
};

/** Las etiquetas de una conversación, conocidas y en el orden del catálogo. */
export function etiquetasDe(c) {
    const tiene = new Set(Array.isArray(c?.etiquetas) ? c.etiquetas : []);
    return Object.keys(ETIQUETAS).filter((k) => tiene.has(k));
}

/**
 * El orden de la bandeja: las abiertas con «Urgente» arriba; el resto, como
 * viene (el último mensaje primero). Estable: no reordena dentro de cada grupo.
 */
export function ordenarBandeja(conversaciones) {
    const lista = conversaciones ?? [];
    const urgente = (c) => c?.estado !== 'resuelta' && etiquetasDe(c).includes('urgente');
    return [...lista.filter(urgente), ...lista.filter((c) => !urgente(c))];
}

// ── Calificación del cliente (1 a 5 estrellas, al resolverse) ──────────────

/** Promedio y cuántas, de las filas con `calificacion`. `null` si no hay ninguna. */
export function resumenDeCalificaciones(filas) {
    const notas = (filas ?? []).map((f) => Number(f?.calificacion)).filter((n) => n >= 1 && n <= 5);
    if (!notas.length) return null;
    const promedio = notas.reduce((s, n) => s + n, 0) / notas.length;
    return { promedio: Math.round(promedio * 10) / 10, cuantas: notas.length };
}

// ── El hilo: separadores de día y mensajes nuevos ─────────────────────────

/** «Hoy», «Ayer» o «lunes, 5 de octubre» (con el año si no es el actual). */
export function etiquetaDeDia(instante, hoy = hoySV()) {
    const dia = diaDe(instante);
    if (!dia) return '';
    if (dia === hoy) return 'Hoy';
    if (dia === sumarDias(hoy, -1)) return 'Ayer';
    const opciones = { weekday: 'long', day: 'numeric', month: 'long' };
    if (dia.slice(0, 4) !== hoy.slice(0, 4)) opciones.year = 'numeric';
    const texto = fechaTexto(dia, opciones);
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** ¿El mensaje cae en otro día (de El Salvador) que el anterior? */
export function cambiaDeDia(m, previo) {
    return !previo || diaDe(m?.created_at) !== diaDe(previo?.created_at);
}

/**
 * El id del primer mensaje SIN LEER: el `sinLeer`-ésimo mensaje del cliente
 * contando desde el final. Si hay más sin leer que mensajes del cliente
 * cargados, el primero de esos. `null` si no hay nada sin leer.
 */
export function primerSinLeer(mensajes, sinLeer) {
    const n = Number(sinLeer) || 0;
    if (n <= 0) return null;
    const delCliente = (mensajes ?? []).filter((m) => m.autor === 'cliente');
    if (!delCliente.length) return null;
    return delCliente[Math.max(0, delCliente.length - n)].id;
}
