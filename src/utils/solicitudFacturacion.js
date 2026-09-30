/**
 * Las reglas de PEDIR un cambio sobre una factura (anular, forma de pago,
 * vendedor, cliente). Vivían privadas dentro de `WidgetAnnulmentRequest.jsx` y
 * se mudaron acá el 2026-09-30, cuando la app estrenó sus propios formularios:
 * escritas dos veces, la primera que cambiara dejaría a una de las dos
 * ofreciendo lo que el servidor rechaza. Los motivos de cada regla se quedaron
 * con ellas. Puras: no conocen ni React ni el navegador.
 */
import { hoySV } from './fecha';

export const MOTIVOS_ANULACION = [
    'Devolución del cliente',
    'Error en venta',
    'Duplicado / venta repetida',
    'Cobro incorrecto',
    'Producto no entregado',
    'Otro',
];

export const FORMAS_DE_PAGO = ['efectivo', 'tarjeta', 'credito', 'transferencia', 'cheque', 'bitcoin'];
export const ROTULO_PAGO = {
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', credito: 'Crédito',
    transferencia: 'Transferencia', cheque: 'Cheque', bitcoin: 'Bitcoin',
};

/** A qué forma de pago se puede cambiar: nunca a la misma ni a crédito
 *  (lo impone también `validar_solicitud_facturacion`). */
export const pagosPosibles = (actual) =>
    FORMAS_DE_PAGO.filter(p => p !== 'credito' && p !== String(actual ?? '').toLowerCase());

function hoyComoFechaLocal() {
    // El día de la sala como fecha local a medianoche. Sólo se usan sus partes
    // de fecha, nunca la hora.
    const [a, m, d] = hoySV().split('-').map(Number);
    return new Date(a, m - 1, d);
}

/** ¿La fecha (AAAA-MM-DD) es hoy en la sala? */
export function esDeHoy(dateStr) {
    const today = hoyComoFechaLocal();
    const d = new Date(dateStr + 'T00:00:00');
    return today.getFullYear() === d.getFullYear()
        && today.getMonth() === d.getMonth()
        && today.getDate() === d.getDate();
}

/* ── Anular pide una CAJA abierta, no un día abierto ────────────────────────
   Pedido del usuario el 2026-08-24, y corregido por él mismo esa misma noche.

   Anular devuelve efectivo, y ese efectivo sale de la caja que esté abierta en
   ese momento. Si la sala ya sacó su cierre del día, no hay ninguna: no hay de
   dónde descontar, y la venta quedaría moviendo un número ya declarado.

   El freno es del MOMENTO, no de la venta: una venta de hace tres días se anula
   sin problema mientras la sala tenga caja abierta. Lo decide la base con
   `sala_con_caja_abierta`, la MISMA función del trigger y de la Edge Function.

   `cajaAbierta` tiene cuatro valores a propósito. 'cargando' y `null` (no se
   pudo averiguar) NO son «hay caja»: ofrecer anular con esa duda es prometer
   algo que el servidor va a rechazar, y decir que ya cerró sería inventarlo.
   Los dos bloquean, y cada uno dice lo suyo. */
export function estadoDeLaCaja(cajaAbierta) {
    if (cajaAbierta === true)  return 'abierta';
    if (cajaAbierta === false) return 'cerrada';
    return cajaAbierta === 'cargando' ? 'cargando' : 'desconocido';
}
export const MOTIVO_SIN_ANULAR = {
    cerrada:     'La sala ya sacó su cierre del día — espera a mañana, o a que abra caja',
    cargando:    'Verificando si la sala tiene caja abierta…',
    desconocido: 'No se pudo verificar si la sala tiene caja abierta',
};

/* ── La ventana que el filtro de fecha admite ───────────────────────────────
   La lista trae las ventas del MES CORRIENTE; del 1 al 7 el mes recién
   arranca, así que el piso es el MENOR entre el primero del mes y hace 7 días:
   la ventana nunca baja de una semana. En enero cruza de año a propósito. */
export function ventanaDelFiltro() {
    const hoy = hoyComoFechaLocal();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const primeroDelMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const haceSiete = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 7);
    return { min: iso(primeroDelMes <= haceSiete ? primeroDelMes : haceSiete), max: iso(hoy) };
}

/* Una factura anulada ya no es un documento vivo: no se vuelve a anular, ni se
   le cambia el cliente, el pago ni el vendedor. La regla la impone la BD
   (`factura_esta_anulada` + trigger `validar_solicitud_facturacion`); acá se
   muestra antes de llenar un formulario que el servidor va a rechazar.

   Son DOS estados, no uno. Medido el 2026-08-06: 975 facturas en
   'DTE INVALIDADO EN MH' contra 14 en 'NULA'. Mirar sólo 'NULA' cubría el
   1.4% de los casos. */
export const ESTADOS_ANULADA = ['NULA', 'DTE INVALIDADO EN MH'];
export function esAnulada(inv) {
    return ESTADOS_ANULADA.includes(String(inv?.estado ?? '').toUpperCase());
}

/* Ámbito de la consulta de facturas: el mes en curso, o el día elegido en el
   filtro. Se resuelve en el servidor — antes el filtro de fecha se aplicaba
   sobre una lista ya truncada, y elegir un día del principio del mes no
   mostraba nada. */
export function ambitoDeFacturas(fecha = null) {
    if (fecha) return { fecha };
    const now  = hoyComoFechaLocal();
    const y    = now.getFullYear();
    const m    = String(now.getMonth() + 1).padStart(2, '0');
    const last = String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${last}` };
}

/**
 * La solicitud lista para `insertApprovalRequestSilent`: el sobre que las
 * CUATRO familias de facturación comparten —la factura, la sala, quién pide y
 * a quién se le avisa— más lo propio de cada una (`extra`).
 *
 * Estaba escrito cuatro veces en el portal; con la app habrían sido ocho.
 *
 * - `erp_invoice_id` es el id con el que se ubica la venta fuera del portal;
 *   `invoice_id` es el interno. Son dos numeraciones y hacen falta las dos.
 * - El aviso al aprobador NO lo manda quien llama: lo crea el trigger
 *   `notificar_solicitud_creada` en la misma transacción.
 */
export function solicitudDeFacturacion(tipo, { inv, usuarioId, sala, aprobador, nota = '', extra = {} }) {
    return {
        employee_id: usuarioId, approver_id: aprobador?.id ?? null,
        type: tipo, status: 'PENDING',
        note: String(nota ?? '').trim() || null,
        metadata: {
            invoice_id: inv.id,
            erp_invoice_id: inv.erp_invoice_id ?? null,
            correlativo: inv.correlativo, fecha: inv.fecha,
            total: inv.total, tipo_documento: inv.tipo_documento,
            branch_id: sala?.id ?? null, branch_name: sala?.name ?? null,
            ...extra,
            notified_employee_id: aprobador?.id ?? null,
            notified_employee: aprobador?.name ?? 'Sin supervisor asignado',
        },
    };
}
