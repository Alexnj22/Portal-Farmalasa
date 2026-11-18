/**
 * El cobro de una preventa en la caja de hoy — la parte PURA (2026-11-17).
 *
 * La caja cobra en dos pasos que hoy arma su pantalla (`venta.js`):
 *   1. `process=insert` (F2 Pagar, `senddata`): guarda la factura con los
 *      productos que la preventa ya trae, la apertura, el turno y la caja.
 *   2. `process=imprimir_fact` (Enter en «Efectivo», `imprimev`): la finaliza
 *      con el efectivo recibido.
 * Levantado del código de la pantalla tras un cobro real de prueba (Salud 4,
 * factura 415125): `docs/COBRO-EN-LA-CAJA-COMO-LO-HACE-EL-SISTEMA-2026-11-17.md`.
 *
 * Esto sólo LEE lo que devuelve la caja y ARMA lo que hay que mandarle; quien
 * habla con ella es `supabase/functions/_shared/preventaCaja.ts`. Sin red ni
 * navegador, para poder enfrentarlo con la pantalla de la caja en una prueba.
 *
 * Sólo consumidor final y ticket. Crédito fiscal y clientes que retienen
 * llevan IVA y retención calculados aparte (`setTotals`): eso se cobra en la
 * caja hasta medirlo.
 */

const num = (s) => {
    const n = Number(String(s ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(v * 100) / 100;
const f2 = (v) => r2(v).toFixed(2);

/** Las etiquetas de apertura de un trozo de HTML, con sus atributos leídos. */
function etiquetas(html, nombre) {
    const re = new RegExp(`<${nombre}\\b([^>]*)>`, 'gi');
    return [...html.matchAll(re)].map((m) => ({ attrs: leerAtributos(m[1]), fin: m.index + m[0].length, inicio: m.index }));
}

/** `a="x" b='y' c=z d` → { a:'x', b:'y', c:'z', d:'' }. Tolera las comillas escapadas del JSON. */
export function leerAtributos(s) {
    const limpio = String(s).replace(/\\(["'])/g, '$1');
    const out = {};
    for (const m of limpio.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
        out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    return out;
}

/** El valor de un `<input id=…>` dentro de una fila. */
function valorDe(tr, id) {
    const e = etiquetas(tr, 'input').find((t) => t.attrs.id === id);
    return e ? (e.attrs.value ?? '') : null;
}

/** La lista desplegable (etiqueta select) cuya clase incluye `clase`, con su opción elegida. */
function elegidaDe(tr, clase) {
    const sel = etiquetas(tr, 'select').find((t) => String(t.attrs.class ?? '').split(/\s+/).includes(clase));
    if (!sel) return null;
    const cierre = tr.indexOf('</select', sel.fin);
    const cuerpo = tr.slice(sel.fin, cierre < 0 ? undefined : cierre);
    const opciones = etiquetas(cuerpo, 'option').map((o) => o.attrs);
    // Como el navegador: la marcada `selected`, y si ninguna, la primera.
    return opciones.find((o) => 'selected' in o) ?? opciones[0] ?? null;
}

/**
 * Los productos de una preventa, leídos de la `lista` que devuelve
 * `cargar_data`, con los mismos campos que arma `senddata` por fila.
 * Las filas con cantidad 0 o sin precio se marcan (`invalida`): la pantalla de
 * la caja las rechaza («Seleccione al menos un producto»).
 */
export function leerRenglonesDeLista(lista) {
    const html = String(lista ?? '');
    const filas = [];
    const re = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
    for (const m of html.matchAll(re)) {
        const attrsTr = leerAtributos(m[1]);
        const tr = m[2];
        const primera = tr.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '';
        // Sin recortar: la pantalla lo manda con sus espacios (`td:eq(0)).text()`).
        const id = primera.replace(/<[^>]*>/g, '');
        const precio = elegidaDe(tr, 'sel_r');
        const fila = {
            id_detalle: attrsTr.id_detalle ?? '',
            id,
            precio: valorDe(tr, 'precio_venta') ?? '',
            cantidad: num(valorDe(tr, 'cant')),
            unidades: valorDe(tr, 'unidades') ?? '',
            subtotal: valorDe(tr, 'subtotal_fin') ?? '',
            id_presentacion: elegidaDe(tr, 'sel')?.value ?? '',
            exento: valorDe(tr, 'exento') ?? '0',
            id_lote: Number.parseInt(elegidaDe(tr, 'lote-select')?.value ?? '', 10) || 0,
            precio_seleccionado: precio?.['data-key-precio'] ?? '',
            id_promo: valorDe(tr, 'id_promo') ?? '',
            descuento_promo: valorDe(tr, 'descuento_promo') ?? '',
            descuento_tipo: valorDe(tr, 'descuento_tipo') ?? '',
        };
        // Lo que la pantalla usa para RECALCULAR la fila (`actualiza_subtotal`)
        // pero no manda: no es enumerable, así no viaja en `json_arr`.
        Object.defineProperty(fila, 'calculo', {
            enumerable: false,
            value: { precio_sin_iva: valorDe(tr, 'precio_sin_iva') ?? '', descuento_monto: valorDe(tr, 'descuento_monto') ?? '-1' },
        });
        fila.invalida = !(fila.cantidad > 0 && fila.precio);
        filas.push(fila);
    }
    return filas;
}

const redondear = (v, d) => Number(Math.round(`${v}e${d}`) + `e-${d}`);   // `round` de la caja

/**
 * Cada fila como la deja `actualiza_subtotal` al cargar la preventa (el cambio
 * de documento la dispara para todas, releído el 2026-11-18):
 *   · consumidor final y ticket: cantidad × precio, menos la promoción,
 *     redondeado a 2;
 *   · crédito fiscal: cantidad × precio SIN IVA, menos la promoción, a 4
 *     decimales (medido: la CCF 409728 guarda 2 × $3.00 como $5.31).
 * La promoción: `descuento_monto` (−1 = ninguna) en % o por unidad, y su monto
 * queda en `descuento_promo`. La fila del descuento por puntos (−999) no la lleva.
 */
export function recalcularRenglones(renglones, tipo) {
    const ccf = String(tipo) === 'CCF';
    return renglones.map((r) => {
        const c = r.calculo;
        if (!c) return r;
        const precio = ccf ? num(c.precio_sin_iva) : num(r.precio);
        let sub = redondear(num(r.cantidad) * precio, 4);
        const fila = { ...r };
        const monto = String(c.descuento_monto ?? '-1');
        if (monto !== '-1' && String(r.id).trim() !== '-999') {
            if (String(r.descuento_tipo) === '%') {
                const d = redondear((num(monto) / 100) * sub, 2);
                sub -= d;
                fila.descuento_promo = String(d);
            } else {
                sub -= num(monto) * num(r.cantidad);
                fila.descuento_promo = String(redondear(num(monto) * num(r.cantidad), 2));
            }
        }
        // Texto, como lo lee la pantalla de su campo (`.val()`).
        fila.subtotal = ccf ? sub.toFixed(4) : String(redondear(sub, 2));
        Object.defineProperty(fila, 'calculo', { enumerable: false, value: c });
        return fila;
    });
}

/**
 * Los totales como `totalColumns` + `setTotals` de la pantalla de la caja
 * (releídos el 2026-11-18), para los tres documentos:
 *   · crédito fiscal: los precios van sin IVA; IVA = gravado × 13 % redondeado a
 *     2; si el cliente retiene, retención = gravado × su porcentaje;
 *   · consumidor final y ticket: los precios ya traen el IVA (no se suma); si el
 *     cliente retiene, retención = gravado ÷ 1.13 × su porcentaje.
 * La retención sólo corre desde `monto_retencion` (100 en la caja) y sólo con
 * «retiene 1»: al cargar el cliente la caja pone en 0 el porcentaje del 10.
 * Total = gravado + exento + IVA − retención, redondeado a 4 y mostrado a 2.
 * Enfrentado con facturas reales (CCF 410964, COF 414169: al centavo).
 *
 * `imp`: { tipo, iva, retiene, porc_retencion, monto_retencion }. Sin él, un
 * consumidor final sin retención (lo que se cobraba antes).
 */
export function totalesDeCobro(renglones, imp = {}) {
    let gravado = 0, exento = 0, descuento = 0, hayGravado = false, hayExento = false;
    for (const r of renglones) {
        const sub = num(r.subtotal);
        if (String(r.id).trim() === '-999') { gravado -= sub; descuento += sub; continue; }
        if (Number.parseInt(r.exento, 10) === 0) { gravado += sub; hayGravado = true; } else { exento += sub; hayExento = true; }
    }
    const tipo = String(imp.tipo ?? 'COF');
    const tasa = imp.iva == null || imp.iva === '' ? 0.13 : num(imp.iva);
    const porc = num(imp.porc_retencion);
    const desde = imp.monto_retencion == null || imp.monto_retencion === '' ? 100 : num(imp.monto_retencion);
    const retiene = String(imp.retiene ?? '').trim() === '1' && gravado >= desde;
    const iva = tipo === 'CCF' ? r2(gravado * tasa) : 0;
    const retencion = !retiene ? 0 : tipo === 'CCF' ? gravado * porc : (gravado / 1.13) * porc;
    const total = Math.round((gravado + exento + iva - retencion) * 10000) / 10000;
    return {
        gravado: r2(gravado), exento: r2(exento), iva, gravado_iva: r2(gravado + iva), retencion: r2(retencion), percepcion: 0,
        total: r2(total), descuento: r2(descuento), items: renglones.length, mixto: hayGravado && hayExento,
    };
}

/** Qué impide cobrar esta preventa desde el portal, o null. La forma de pago la juzga `problemaDelPago`. */
export function motivoParaNoCobrar({ renglones, tipo_documento, totales }) {
    if (!renglones?.length) return 'La preventa no tiene productos.';
    if (renglones.some((r) => r.invalida)) return 'Hay un producto sin cantidad o sin precio. Corrígelo antes de cobrar.';
    if (!['COF', 'CCF', 'TIK'].includes(String(tipo_documento))) return 'La preventa no dice qué documento lleva.';
    // La pantalla de la caja suma mal una venta con productos exentos y gravados
    // juntos (arrastra el subtotal de la fila anterior): no se cobra hasta medirla.
    if (totales?.mixto) return 'Tiene productos exentos y gravados juntos. Avísale a Soporte antes de cobrarla.';
    return null;
}

// ── Las formas de pago (2026-11-18) ─────────────────────────────────────────
// Las seis de la caja (`#con_pago` en `venta.php`), con el código que espera
// `credito`. En la caja todo lo que no es efectivo lleva un texto libre en
// «datos extra»; el kiosco pide cada dato por separado y lo arma siempre igual.
export const CODIGO_DE_PAGO = { contado: '0', credito: '1', tarjeta: '2', cheque: '3', bitcoin: '4', transferencia: '5' };

const limpio = (s) => String(s ?? '').trim();

/** Qué le falta a la forma de pago para cobrar, o null. */
export function problemaDelPago({ pago, detalle = {}, total, efectivo, clienteGenerico }) {
    if (!(pago in CODIGO_DE_PAGO)) return 'Elige la forma de pago.';
    if (pago === 'contado' && !(Number(efectivo) >= Number(total))) return 'El efectivo no alcanza para el total.';
    if (pago === 'tarjeta') {
        if (!limpio(detalle.terminal)) return 'Elige el POS con que se pagó.';
        if (!/^\d{1,12}$/.test(limpio(detalle.boleta))) return 'Escribe el número de boleta del POS.';
    }
    if (pago === 'transferencia' && (!limpio(detalle.banco) || !limpio(detalle.referencia))) return 'Escribe el banco y la referencia de la transferencia.';
    if (pago === 'cheque' && (!limpio(detalle.banco) || !limpio(detalle.numero))) return 'Escribe el banco y el número del cheque.';
    if (pago === 'bitcoin' && !limpio(detalle.referencia)) return 'Escribe la referencia del pago.';
    if (pago === 'credito' && clienteGenerico) return 'El crédito se le da a un cliente con nombre, no a clientes varios.';
    return null;
}

/** Lo que va en «datos extra» de la caja: los datos del pago en un texto ordenado. */
export function datosExtrasDelPago(pago, detalle = {}) {
    const d = (k) => limpio(detalle[k]).replace(/\s+/g, ' ');
    switch (pago) {
        case 'tarjeta': return `TARJETA POS ${d('terminal')} BOLETA ${d('boleta')}`;
        case 'transferencia': return `TRANSFERENCIA ${d('banco')} REF ${d('referencia')}`;
        case 'cheque': return `CHEQUE ${d('banco')} NUM ${d('numero')}`;
        case 'bitcoin': return `BITCOIN REF ${d('referencia')}`;
        default: return '';
    }
}

/** El cuerpo de `process=insert`, en el orden y con los nombres de `senddata`. */
export function armarGuardado({ renglones, cabecera, caja, impuestos = {} }) {
    const t = totalesDeCobro(renglones, { ...impuestos, tipo: cabecera.tipo_documento });
    const aplica = renglones.some((r) => ['precio', 'precio1', 'precio2'].includes(r.precio_seleccionado)) ? 1 : 0;
    const json = renglones.map(({ invalida: _i, ...r }) => JSON.stringify(r)).join(',');
    return {
        process: 'insert', cuantos: String(renglones.length), fecha_movimiento: caja.fecha,
        id_cliente: String(cabecera.id_cliente), total: f2(t.total),
        id_vendedor: String(cabecera.id_empleado ?? ''), json_arr: `[${json}]`,
        retencion: f2(t.retencion), total_percepcion: '0.00', iva: f2(t.iva), items: String(t.items),
        subtotal: f2(t.gravado_iva), sumas: f2(t.gravado), venta_exenta: f2(t.exento), suma_gravada: f2(t.gravado),
        tipo_impresion: String(cabecera.tipo_documento), id_factura: String(cabecera.id_factura),
        id_apertura: String(caja.id_apertura), turno: String(caja.turno), caja: String(caja.caja),
        credito: String(cabecera.credito), codvende: String(cabecera.codvende ?? ''),
        datos_extras: String(cabecera.datos_extras ?? ''), medico: String(cabecera.id_medico && cabecera.id_medico !== '0' ? cabecera.id_medico : ''),
        totalDescuento: String(t.descuento), aplica_farmalasa: String(aplica),
    };
}

/**
 * El cuerpo de `process=imprimir_fact` (finalizar con el efectivo), como `imprimev`.
 *
 * `guardado` es la respuesta de `process=insert`. Lo que la pantalla pone en sus
 * campos al guardar (releído en `venta.js` el 2026-11-18):
 *   · consumidor final y crédito fiscal: nombre y dirección del cliente
 *     (`#nomcli`, `#dircli`); el número del documento (`#numdoc`) queda vacío;
 *   · ticket: el número (`#numdoc` = `ultimo`) y nada del cliente.
 * Y `numero_factura_consumidor` es `#numdoc` salvo en ticket, que va vacío.
 */
export function armarFinalizado({ cabecera, guardado, caja, efectivo }) {
    const tik = String(cabecera.tipo_documento) === 'TIK';
    const numdoc = tik ? String(guardado.ultimo ?? '') : '';
    return {
        process: 'imprimir_fact', numero_doc: numdoc,
        tipo_impresion: String(cabecera.tipo_documento), num_doc_fact: String(guardado.id_factura ?? cabecera.id_factura),
        numero_factura_consumidor: tik ? '' : numdoc, fecha_fact: String(caja.fecha_fact ?? ''),
        // El crédito fiscal lleva además el NIT y el NRC que devolvió la caja al guardar.
        ...(String(cabecera.tipo_documento) === 'CCF' ? { nit: String(guardado.nit ?? ''), nrc: String(guardado.nrc ?? '') } : {}),
        direccion: tik ? '' : String(guardado.direccion ?? ''), nombreape: tik ? '' : String(guardado.nombre ?? ''),
        id_cliente: String(cabecera.id_cliente), efectivo: String(efectivo),
    };
}

/** Los campos ocultos de `venta.php` que dicen qué caja está abierta. null si no hay turno. */
export function leerCajaAbierta(html) {
    const inputs = etiquetas(String(html ?? ''), 'input').map((t) => t.attrs);
    const v = (id) => inputs.find((a) => a.id === id)?.value ?? '';
    const caja = { fecha: v('fecha'), fecha_fact: v('fecha_fact'), id_apertura: v('id_apertura'), turno: v('turno'), caja: v('caja'),
        // Los impuestos de la pantalla (campos ocultos): IVA y desde cuánto se retiene.
        iva: v('porc_iva') || '0.13', monto_retencion: v('monto_retencion1') || '100' };
    return caja.id_apertura && caja.fecha ? caja : null;
}

/** El cliente que trae la preventa: la opción elegida de `select_cliente`. */
export function clienteDePreventa(selectCliente) {
    const opciones = etiquetas(String(selectCliente ?? ''), 'option').map((o) => o.attrs);
    const o = opciones.find((a) => 'selected' in a) ?? opciones[0];
    return o?.value ?? '';
}
