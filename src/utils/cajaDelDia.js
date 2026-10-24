// El día de una caja: la cuenta del cajón y la lista de lo que movió efectivo.
//
// Vivían dentro de `MiCajaView` (`PanelDelDia` y `MovimientosDelDia`) y la app
// nativa necesita exactamente las mismas respuestas. Escritas dos veces, el día
// que una cambie la otra se queda vieja — y acá eso significa dos pantallas
// diciendo cuánto hay en el mismo cajón. Se mudaron tal cual; los porqués largos
// siguen junto a cada pantalla, que es donde se leen.
import { formatMoney } from './formatNumber';
import { entroEnEfectivo } from './cortesDiagnostico';

/** Sale del dato, no de una lista escrita a mano: `efectivo` → `Efectivo`. */
export const conMayuscula = (t) => {
    const s = String(t || '').trim();
    return s ? s[0].toUpperCase() + s.slice(1) : '—';
};

/**
 * Lo vendido por forma de pago y la cuenta del cajón, como la arma el panel
 * «Hoy» de Efectivo.
 *
 * **Los renglones del efectivo salen de `estado`** (`efectivo_piezas`, la suma
 * que hizo el servidor con `caja_efectivo_piezas`) y no se rearman acá: dos
 * sumas del mismo cajón con piezas leídas en momentos distintos darían dos
 * respuestas. Sin piezas (`puedeSumar = false`) no se afirma ningún total.
 *
 * @returns {{ formas, total, docs, pz, enCaja, puedeSumar, efectivoVendido,
 *             entradas, vales, enBolsas, apertura }}
 */
export function cuentaDelCajon({ estado, ventas }) {
    const formas = [...(ventas || [])]
        .map((v) => ({ tipo: String(v.tipo_pago), docs: Number(v.documentos || 0), total: Number(v.total || 0) }))
        .sort((a, b) => b.total - a.total);
    const total = formas.reduce((s, f) => s + f.total, 0);
    const docs = formas.reduce((s, f) => s + f.docs, 0);
    const pz = estado?.efectivo_piezas || null;
    const enCaja = estado?.efectivo ?? null;
    const puedeSumar = !!pz && enCaja != null;
    const efectivoVendido = pz ? Number(pz.ventas_efectivo || 0)
        : (formas.find((f) => f.tipo.toLowerCase() === 'efectivo')?.total ?? 0);
    return {
        formas, total, docs, pz, enCaja, puedeSumar, efectivoVendido,
        entradas: Number(pz?.entradas || 0),
        vales: Number(pz?.vales || 0),
        enBolsas: Number(pz?.en_bolsas || 0),
        apertura: Number(estado?.apertura ?? 0),
    };
}

/** De dónde salió el monto de un movimiento. `FOTO_CONFIRMADA` es el caso
 *  normal y la lista no lo rotula; el detalle sí lo dice. */
export const ORIGEN_DEL_MONTO = {
    FOTO_CONFIRMADA: 'leído de la boleta y confirmado',
    FOTO_SIN_CONFIRMAR: 'leído de la boleta, sin confirmar',
    FOTO_COTEJADA: 'leído de la boleta y comparado con el papel por quien lo anotó',
    A_MANO: 'escrito a mano',
};
export const ROTULO_DE_ORIGEN = {
    A_MANO: 'monto escrito a mano',
    FOTO_SIN_CONFIRMAR: 'monto sin comprobar',
};

/**
 * Todo lo que movió efectivo en el día de caja, en UNA lista: lo del cajón,
 * lo pagado con una bolsa y los cobros de crédito. La más reciente arriba.
 *
 * @param etiquetaDe  `codigo → rótulo` del catálogo de salidas de bolsa
 * @param correcciones Map `movimiento → solicitudes`, o null si no se sabe
 */
/** Con tarjeta o transferencia: no va a la caja, y eso NO es un error. */
const COMO_SE_PAGO = { TARJETA: 'con tarjeta', TRANSFERENCIA: 'por transferencia' };
const ESTADO_DE_AUTORIZACION = {
    PENDIENTE: 'falta autorizarlo', APROBADA: 'autorizado', RECHAZADA: 'no se autorizó',
};

export function lineasDelDia({ movimientos, deBolsas, cobros, etiquetaDe = conMayuscula, correcciones = null }) {
    const delCajon = (movimientos || []).map((m) => {
        const otraVia = COMO_SE_PAGO[m.forma_pago] || null;
        return {
        clave: `caja-${m.id}`,
        cuando: m.registrado_at,
        titulo: m.detalle || m.concepto,
        entra: m.tipo === 'ENTRADA',
        monto: Number(m.monto || 0),
        anulado: !!m.anulado_at,
        origen: 'De la caja',
        detalle: [
            m.numero_boleta ? `${otraVia ? 'comprobante' : 'boleta'} ${m.numero_boleta}` : null,
            otraVia,
            otraVia ? ESTADO_DE_AUTORIZACION[m.autorizacion] || null
                : (m.erp_movimiento_id ? null : 'sin llegar a la caja'),
        ].filter(Boolean),
        quien: m.registrado_por,
        foto: m.foto_url || null,
        movimiento: m,
        correcciones: correcciones?.get(m.id) || [],
        montoOrigen: m.monto_origen || null,
        clase: m.tipo === 'ENTRADA' ? 'entra' : 'sale',
        tipoTexto: otraVia ? `Ingreso ${otraVia}` : (m.tipo === 'ENTRADA' ? 'Ingreso a la caja' : 'Salida de la caja'),
        // Lo que no es efectivo no está en el cajón: fuera de la suma del tramo
        // (`netoDelTramo`) y con la misma marca que un cobro con tarjeta.
        sinEfectivo: !!otraVia,
        // En efectivo, vivo y sin número de la caja: un envío que se cortó. El
        // portal lo cuenta y la caja puede no tenerlo (Salud 3, 23-oct).
        sinCaja: !otraVia && !m.anulado_at && !m.erp_movimiento_id,
        autorizacion: m.autorizacion || null,
        datos: otraVia ? [
            ['Comprobante', m.numero_boleta || null],
            ['Total del comprobante', m.comprobante_total != null ? Number(m.comprobante_total).toFixed(2) : null],
            ['En la caja', 'no va a la caja: el dinero llegó por otra vía'],
            ['Autorización', m.autorizacion
                ? `${ESTADO_DE_AUTORIZACION[m.autorizacion]}${m.autorizacion_nota ? ` · ${m.autorizacion_nota}` : ''}`
                : null, m.autorizacion === 'PENDIENTE' || m.autorizacion === 'RECHAZADA'],
        ] : [
            ['Boleta', m.numero_boleta || null],
            ['En la caja', m.erp_movimiento_id
                ? `registrado · n.º ${m.erp_movimiento_id}`
                : 'todavía no llega a la caja', !m.erp_movimiento_id],
        ],
        };
    });
    const deLasBolsas = (deBolsas || []).map((o) => {
        const total = Math.abs(Number(o.monto || 0));
        const deHoy = Number(o.montoDeHoy || 0);
        return {
            clave: `bolsa-${o.id}`,
            cuando: o.registrado_at,
            titulo: `${etiquetaDe(o.tipo)}${o.entidad ? ` · ${o.entidad}` : ''}`,
            entra: false,
            monto: total,
            anulado: !!o.anulada_at,
            origen: 'De una bolsa',
            avisa: o.tocaLaCaja,
            detalle: [o.folio, o.numero_boleta ? `boleta ${o.numero_boleta}` : null].filter(Boolean),
            quien: o.registrado_por,
            foto: o.foto_url || null,
            montoOrigen: o.monto_origen || null,
            reparto: o.bolsasUsadas || [],
            afectaElCorte: deHoy,
            parcial: deHoy > 0.005 && deHoy < total - 0.005,
            clase: 'bolsa',
            tipoTexto: 'Pagado con una bolsa',
            datos: [
                ['Motivo', etiquetaDe(o.tipo)],
                ['A nombre de', o.entidad || null],
                ['Folio', o.folio || null],
                ['Boleta', o.numero_boleta || null],
                ['Afecta el corte de hoy', deHoy > 0.005 ? formatMoney(deHoy) : 'no', deHoy > 0.005],
            ],
        };
    });
    const deCreditos = (cobros || []).map((c) => {
        const efvo = entroEnEfectivo(c);
        return {
            clave: `cobro-${c.id}`,
            cuando: c.created_at,
            titulo: `Cobro de crédito · ${c.cliente || 'Sin nombre'}`,
            entra: true,
            monto: Number(c.monto || 0),
            anulado: !!c.anulado_at,
            origen: 'Cobro de un crédito',
            sinEfectivo: !efvo,
            detalle: [
                `crédito ${c.credito_erp}`,
                efvo ? 'en efectivo' : `${String(c.forma || 'otra forma').toLowerCase()} · no entra al cajón`,
                c.documento ? `documento ${c.documento}` : null,
                Number(c.saldo_despues) > 0.004
                    ? `queda debiendo ${formatMoney(c.saldo_despues)}`
                    : 'crédito saldado',
            ].filter(Boolean),
            quien: c.abonado_por,
            foto: c.comprobante_url || null,
            clase: 'cobro',
            tipoTexto: 'Cobro de un crédito',
            datos: [
                ['Cliente', c.cliente || null],
                ['Crédito', c.credito_erp ? `n.º ${c.credito_erp}` : null],
                ['Factura', c.factura_erp || null],
                ['Forma de pago', conMayuscula(c.forma || 'otra forma')],
                ['Al cajón', efvo ? 'sí, en efectivo' : 'no entra al cajón', !efvo],
                ['Documento', c.documento || null],
                ['Debía', c.saldo_antes != null ? formatMoney(c.saldo_antes) : null],
                ['Queda debiendo', Number(c.saldo_despues) > 0.004
                    ? formatMoney(c.saldo_despues) : 'nada · crédito saldado'],
            ],
        };
    });
    return [...delCajon, ...deLasBolsas, ...deCreditos]
        .sort((a, b) => String(b.cuando || '').localeCompare(String(a.cuando || '')));
}

/** Lo que el próximo corte va a medir de un tramo: entradas − salidas, sin
 *  lo anulado ni lo que se cobró con otra forma (no está en el cajón). */
export const netoDelTramo = (lineas) => (lineas || []).reduce(
    (t, l) => t + ((l.anulado || l.sinEfectivo) ? 0 : (l.entra ? l.monto : -l.monto)), 0);

/** El título de una corrección pedida sobre un movimiento, en sus tres estados. */
const NOMBRE_DE_FORMA = { EFECTIVO: 'efectivo', TARJETA: 'tarjeta', TRANSFERENCIA: 'transferencia' };

export function tituloDeCorreccion(dato) {
    const pendiente = dato.estado === 'PENDING';
    const rechazada = dato.estado === 'REJECTED';
    const anula = dato.que === 'ANULAR';
    // Cambiar la forma de pago no es un cambio de monto: el número no se mueve,
    // lo que cambia es si el dinero está en el cajón.
    if (dato.que === 'FORMA') {
        const a = NOMBRE_DE_FORMA[dato.forma_despues] || dato.forma_despues || '—';
        const de = NOMBRE_DE_FORMA[dato.forma_antes] || dato.forma_antes || '—';
        return pendiente ? `Se pidió pasarlo a ${a}`
            : rechazada ? `No se pasó a ${a}: se rechazó`
                : `Se pasó de ${de} a ${a}`;
    }
    return pendiente
        ? (anula ? 'Se pidió anularlo' : `Se pidió cambiarlo a ${formatMoney(dato.monto_despues)}`)
        : rechazada
            ? (anula ? 'No se anuló: la corrección se rechazó'
                : `No se cambió a ${formatMoney(dato.monto_despues)}: se rechazó`)
            : (anula ? `Se anuló · eran ${formatMoney(dato.monto_antes)}`
                : `Se corrigió el monto · antes decía ${formatMoney(dato.monto_antes)}`);
}

/**
 * Cómo va la sala contra la meta de HOY: la del mes repartida entre sus días
 * (la misma definición de `avisar_cierre_del_dia`). `null` cuando falta un
 * dato —sin meta, sin días o sin venta legible—: una meta que no se pudo leer
 * NO es una meta en cero, y un 0% sobre una sala que vendió es peor que nada.
 *
 * @param row  la fila de `get_meta_sala` (`monto_meta`, `dias_mes`, `venta_hoy`)
 */
export function avanceDeMetaDelDia(row) {
    const metaMes = Number(row?.monto_meta);
    const dias = Number(row?.dias_mes);
    const vendido = Number(row?.venta_hoy);
    if (!Number.isFinite(metaMes) || metaMes <= 0) return null;
    if (!Number.isFinite(dias) || dias <= 0) return null;
    if (!Number.isFinite(vendido)) return null;
    const meta = metaMes / dias;
    return { meta, vendido, pct: Math.round(vendido / meta * 100) };
}
