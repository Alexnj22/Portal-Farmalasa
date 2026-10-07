// Movido desde src/views/distribucion/comun.js (2026-10-07) para que la app
// nativa use las mismas reglas que el portal. Rótulos y reglas de Torogoz.
import { hoySV, sumarDias } from './fecha';
// Rótulos y reglas de pantalla compartidos por las pestañas de Distribución.
//
// La pantalla habla del PORTAL (CLAUDE.md): «Enviado a Hacienda» sí, porque
// Hacienda es a quien el cliente le reclama; pero nunca «API», «token», «JWS» ni
// el nombre de ningún sistema de origen.

export const TIPO_DOCUMENTO = {
    '01': { corto: 'Factura', largo: 'Factura' },
    '03': { corto: 'CCF', largo: 'Crédito Fiscal' },
    '04': { corto: 'Remisión', largo: 'Nota de Remisión' },
    '05': { corto: 'N. crédito', largo: 'Nota de Crédito' },
    '06': { corto: 'N. débito', largo: 'Nota de Débito' },
};

// El estado que importa es si Hacienda lo SELLÓ. Todo lo demás es «todavía no
// cuenta» con distinto motivo, y el rótulo dice cuál.
export const ESTADO_DOCUMENTO = {
    sin_firmar:   { variant: 'warning', label: 'Falta la firma',  ayuda: 'Guardado. Se firma y se envía cuando esté el certificado.' },
    firmado:      { variant: 'warning', label: 'Por enviar',      ayuda: 'Firmado y todavía sin sello de Hacienda.' },
    contingencia: { variant: 'warning', label: 'Sin conexión',    ayuda: 'Se emitió sin poder enviarlo; va en el próximo aviso de contingencia.' },
    sellado:      { variant: 'success', label: 'Sellado',         ayuda: 'Hacienda lo recibió y lo selló.' },
    rechazado:    { variant: 'danger',  label: 'Rechazado',       ayuda: 'Hacienda no lo aceptó. Se corrige y se emite uno nuevo.' },
    invalidado:   { variant: 'neutral', label: 'Invalidado',      ayuda: 'Anulado ante Hacienda.' },
    descartado:   { variant: 'neutral', label: 'Descartado',      ayuda: 'Nunca llegó a Hacienda y se retiró para corregir el pedido.' },
};

export const ESTADO_PEDIDO = {
    // «Preventa»: guardada sin facturar (así la llama quien vende en ruta).
    confirmado: { variant: 'info',    label: 'Preventa' },
    facturado:  { variant: 'success', label: 'Facturado' },
    entregado:  { variant: 'success', label: 'Entregado' },
    anulado:    { variant: 'neutral', label: 'Anulado' },
};

// Las tres vistas de Pedidos (pedido del usuario, 2026-09-28: «separados por
// finalizados y pendientes»). Viven en la dirección (`?vista=`), como toda
// pestaña del portal. Pendiente = preventa, guardada sin facturar;
// finalizado = ya tiene documento.
/** Las pestañas de Ventas perdidas (van en `?estado=`). */
export const VISTAS_PERDIDAS = [
    { key: 'pendiente',  label: 'Pendientes' },
    { key: 'atendida',   label: 'Atendidas' },
    { key: 'descartada', label: 'Descartadas' },
];

export const VISTAS_PEDIDOS = [
    { key: 'pendientes',  label: 'Pendientes',  estados: ['confirmado'] },
    { key: 'finalizados', label: 'Finalizados', estados: ['facturado', 'entregado'] },
    { key: 'anulados',    label: 'Anulados',    estados: ['anulado'] },
];


export const TIPO_CLIENTE = [
    { value: 'tienda',       label: 'Tienda' },
    { value: 'supermercado', label: 'Supermercado' },
    { value: 'farmacia',     label: 'Farmacia' },
    { value: 'otro',         label: 'Otro' },
];
export const rotuloTipoCliente = (t) => TIPO_CLIENTE.find(x => x.value === t)?.label ?? t;

/** A tiendas y supermercados sólo va venta libre (Ley de Medicamentos art. 57 b). */
export const soloVentaLibre = (tipoCliente) => tipoCliente === 'tienda' || tipoCliente === 'supermercado';

export const FORMA_PAGO = [
    { value: '01', label: 'Efectivo' },
    { value: '05', label: 'Transferencia o depósito' },
    { value: '04', label: 'Cheque' },
    { value: '02', label: 'Tarjeta de débito' },
    { value: '03', label: 'Tarjeta de crédito' },
];

export const DOC_IDENTIDAD = [
    { value: '36', label: 'NIT' },
    { value: '13', label: 'DUI' },
    { value: '03', label: 'Pasaporte' },
    { value: '02', label: 'Carné de residente' },
    { value: '37', label: 'Otro' },
];

/**
 * Un monto escrito por una persona → número, o null si no es un monto.
 * Acepta coma o punto decimal («1,20» y «1.20»): el campo de dinero del
 * navegador no tiene separador decimal fijo, por eso nunca es `type="number"`.
 */
export function leerMonto(texto) {
    const t = String(texto ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
    return Number(t);
}

/**
 * El catálogo de actividades económicas de Hacienda (CAT-019), cargado con
 * `import()` la primera vez que un formulario lo pide: ~50 kB que no tienen por
 * qué viajar con la vista. Si falla, la próxima llamada reintenta.
 */
let actividadesPromesa = null;
export function cargarActividades() {
    if (!actividadesPromesa) {
        actividadesPromesa = import('../data/actividadesMH')
            .then(m => m.ACTIVIDADES_MH.map(([value, label]) => ({ value, label: `${value} · ${label}`, desc: label })))
            .catch(e => { actividadesPromesa = null; throw e; });
    }
    return actividadesPromesa;
}

// ── El tablero (Inicio) ────────────────────────────────────────────────────
// Los períodos van en `?periodo=`; el rango sale de la hora de El Salvador.
export const PERIODOS = [
    { key: 'hoy', label: 'Hoy' },
    { key: '7d', label: '7 días' },
    { key: '30d', label: '30 días' },
    { key: 'mes', label: 'Este mes' },
    { key: 'mes_ant', label: 'Mes anterior' },
    { key: '90d', label: '90 días' },
];

/** El rango de fechas de cada período, en la hora de El Salvador. */
export function rangoDe(periodo, hoy = hoySV()) {
    const primeroDe = (iso) => `${iso.slice(0, 8)}01`;
    switch (periodo) {
        case 'hoy': return { desde: hoy, hasta: hoy };
        case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy };
        case 'mes': return { desde: primeroDe(hoy), hasta: hoy };
        case 'mes_ant': {
            const fin = sumarDias(primeroDe(hoy), -1);
            return { desde: primeroDe(fin), hasta: fin };
        }
        case '90d': return { desde: sumarDias(hoy, -89), hasta: hoy };
        default: return { desde: sumarDias(hoy, -29), hasta: hoy };
    }
}

// ── ¿Está bien con Hacienda? ───────────────────────────────────────────────
// Pedido del usuario (2026-09-29): «que en la facturación me avise si todo
// está bien con Hacienda (código de generación y recibido) o falta algo, y si
// falta algo que salga para reenviar».
//
// Revisa las piezas que hacen válido un documento y dice QUÉ hacer, no sólo
// en qué estado está. «Recibido» es sello VÁLIDO: 40 caracteres, no «algo en
// la columna» (la regla del sello del portal, CLAUDE.md).
const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
export const selloValido = (s) => typeof s === 'string' && s.trim().length === 40;

/**
 * @returns {{ nivel: 'ok'|'pendiente'|'error'|'info', titulo: string, detalle: string,
 *             pasos: {clave:string, rotulo:string, ok:boolean|null, valor?:string}[],
 *             accion: null|'reenviar'|'corregir'|'invalidacion'|'contingencia' }}
 */
export function revisionHacienda(d) {
    if (!d) return null;
    const codigo = String(d.codigo_generacion ?? '').toUpperCase();
    const firmado = !['sin_firmar', 'descartado'].includes(d.estado);
    const sello = selloValido(d.sello_recibido);
    const pasos = [
        { clave: 'numero', rotulo: 'Número de control', ok: String(d.numero_control ?? '').length === 31, valor: d.numero_control },
        { clave: 'codigo', rotulo: 'Código de generación', ok: UUID.test(codigo), valor: codigo },
        { clave: 'firma', rotulo: 'Firmado', ok: firmado },
        { clave: 'sello', rotulo: 'Recibido por Hacienda (sello)', ok: sello, valor: sello ? d.sello_recibido : undefined },
    ];
    const base = { pasos, accion: null };
    if (d.estado === 'descartado') {
        return { ...base, nivel: 'info', titulo: 'Retirado antes de llegar a Hacienda', detalle: 'El pedido volvió a «por facturar» para corregirlo.' };
    }
    if (d.estado === 'invalidado') {
        return { ...base, nivel: 'info', titulo: 'Invalidado ante Hacienda', detalle: 'Quedó anulado y sus unidades volvieron al inventario.' };
    }
    if (d.invalidacion_estado === 'rechazada') {
        return { ...base, nivel: 'error', accion: 'invalidacion', titulo: 'Hacienda rechazó la invalidación', detalle: 'El documento sigue vigente. Revisa el motivo y vuelve a enviarla.' };
    }
    if (d.invalidacion_estado === 'pendiente') {
        return { ...base, nivel: 'pendiente', accion: 'invalidacion', titulo: 'Invalidación por enviar',
            detalle: d.reemplazo_id ? 'Sale sola cuando el documento que lo reemplaza tenga sello.' : 'Está firmada y todavía no llega a Hacienda.' };
    }
    if (d.estado === 'rechazado') {
        return { ...base, nivel: 'error', accion: 'corregir', titulo: 'Hacienda lo rechazó',
            detalle: 'No tiene validez. Corrige lo que dice Hacienda (casi siempre la ficha del cliente) y vuelve a facturar el pedido.' };
    }
    if (d.estado === 'contingencia') {
        // Emitido sin poder transmitirlo (sin señal, o Hacienda caída). Primero
        // va el AVISO de contingencia; con el aviso recibido, el documento.
        return d.contingencia_id
            ? { ...base, nivel: 'pendiente', accion: 'reenviar', titulo: 'Aviso de contingencia recibido: falta transmitirlo',
                detalle: 'Hacienda ya conoce la contingencia; reenvíalo para que lo selle.' }
            : { ...base, nivel: 'pendiente', accion: 'contingencia', titulo: 'Emitido en contingencia',
                detalle: 'Es válido para entregar. Falta enviar el aviso de contingencia a Hacienda (hasta 72 horas).' };
    }
    if (!sello) {
        return { ...base, nivel: 'pendiente', accion: 'reenviar', titulo: firmado ? 'Falta que Hacienda lo reciba' : 'Falta firmarlo y enviarlo',
            detalle: d.intentos > 0 ? `Se intentó ${d.intentos} ${d.intentos === 1 ? 'vez' : 'veces'} y no hubo respuesta. Reenvíalo.` : 'Todavía no se ha enviado.' };
    }
    return { ...base, nivel: 'ok', titulo: 'Todo bien con Hacienda', detalle: 'Tiene código de generación y sello de recepción.' };
}

/** ¿Pide que alguien haga algo? (un rechazo ya refacturado o anulado es constancia). */
export function pideAccion(d) {
    const r = revisionHacienda(d);
    if (!r || r.nivel === 'ok' || r.nivel === 'info') return false;
    if (d.estado === 'rechazado') return d.pedido ? d.pedido.estado === 'confirmado' && d.pedido.dte_id == null : true;
    return true;
}

/** Las pestañas de Facturación (van en `?cubeta=`; la lee la vista y la pestaña). */
export const CUBETAS_FACTURACION = [
    { key: 'accion', label: 'Por resolver' },
    { key: 'todos', label: 'Todos' },
    { key: 'sellados', label: 'Sellados' },
    { key: 'invalidados', label: 'Invalidados' },
];
