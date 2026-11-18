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
        fila.invalida = !(fila.cantidad > 0 && fila.precio);
        filas.push(fila);
    }
    return filas;
}

/** Los totales como `totalColumns` + `setTotals`, para consumidor final y ticket. */
export function totalesDeCobro(renglones) {
    let gravado = 0, exento = 0, descuento = 0;
    for (const r of renglones) {
        const sub = num(r.subtotal);
        if (String(r.id).trim() === '-999') { gravado -= sub; descuento += sub; continue; }
        if (Number.parseInt(r.exento, 10) === 0) gravado += sub; else exento += sub;
    }
    return { gravado: r2(gravado), exento: r2(exento), total: r2(gravado + exento), descuento: r2(descuento), items: renglones.length };
}

/** Qué impide cobrar esta preventa desde el portal, o null. */
export function motivoParaNoCobrar({ renglones, tipo_documento, cliente_retiene, credito }) {
    if (!renglones?.length) return 'La preventa no tiene productos.';
    if (renglones.some((r) => r.invalida)) return 'Hay un producto sin cantidad o sin precio. Cóbrala en la caja.';
    if (!['COF', 'TIK'].includes(String(tipo_documento))) return 'Esta preventa es crédito fiscal. Por ahora se cobra en la caja.';
    if (cliente_retiene && String(cliente_retiene) !== '0') return 'El cliente retiene IVA. Por ahora se cobra en la caja.';
    if (String(credito) !== '0') return 'Por ahora el kiosco sólo cobra al contado.';
    return null;
}

/** El cuerpo de `process=insert`, en el orden y con los nombres de `senddata`. */
export function armarGuardado({ renglones, cabecera, caja }) {
    const t = totalesDeCobro(renglones);
    const aplica = renglones.some((r) => ['precio', 'precio1', 'precio2'].includes(r.precio_seleccionado)) ? 1 : 0;
    const json = renglones.map(({ invalida: _i, ...r }) => JSON.stringify(r)).join(',');
    return {
        process: 'insert', cuantos: String(renglones.length), fecha_movimiento: caja.fecha,
        id_cliente: String(cabecera.id_cliente), total: f2(t.total),
        id_vendedor: String(cabecera.id_empleado ?? ''), json_arr: `[${json}]`,
        retencion: '0.00', total_percepcion: '0.00', iva: '0.00', items: String(t.items),
        subtotal: f2(t.gravado), sumas: f2(t.gravado), venta_exenta: f2(t.exento), suma_gravada: f2(t.gravado),
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
        direccion: tik ? '' : String(guardado.direccion ?? ''), nombreape: tik ? '' : String(guardado.nombre ?? ''),
        id_cliente: String(cabecera.id_cliente), efectivo: String(efectivo),
    };
}

/** Los campos ocultos de `venta.php` que dicen qué caja está abierta. null si no hay turno. */
export function leerCajaAbierta(html) {
    const inputs = etiquetas(String(html ?? ''), 'input').map((t) => t.attrs);
    const v = (id) => inputs.find((a) => a.id === id)?.value ?? '';
    const caja = { fecha: v('fecha'), fecha_fact: v('fecha_fact'), id_apertura: v('id_apertura'), turno: v('turno'), caja: v('caja') };
    return caja.id_apertura && caja.fecha ? caja : null;
}

/** El cliente que trae la preventa: la opción elegida de `select_cliente`. */
export function clienteDePreventa(selectCliente) {
    const opciones = etiquetas(String(selectCliente ?? ''), 'option').map((o) => o.attrs);
    const o = opciones.find((a) => 'selected' in a) ?? opciones[0];
    return o?.value ?? '';
}
