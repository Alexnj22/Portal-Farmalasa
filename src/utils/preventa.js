// La PREVENTA de una reserva — la venta armada en el portal y dejada lista
// para que la caja la cobre (2026-10-21).
//
// La preventa es del PORTAL (`public.preventas`): qué se vende, a quién, quién
// la vendió y qué falta pagar. El sistema donde hoy se factura es un DESTINO,
// y su número viaja como referencia externa (`externo_id`). El día que la
// facturación pase entera al portal, esta misma venta se factura acá y sólo
// cambia el adaptador —`supabase/functions/_shared/preventaCaja.ts`—, que es
// lo único que sabe cómo habla la caja de hoy.
//
// Por eso esto vive en el núcleo y no dentro de la edge function: lo usan la
// función que la envía (Deno la importa tal cual) y la pantalla que decide si
// muestra el botón. Escrito dos veces, el día que cambie una regla —quién
// firma como vendedor, cuándo va el cliente genérico— una copia se queda vieja.
//
// Sin imports a propósito: la corre también Deno, en el servidor.

/** Los cargos de administración no tienen código de vendedor propio: firman con éste. */
export const CODIGO_VENDEDOR_ADMIN = '1000';
/** Gerente General (2), Administrador (3), Talento Humano (11), Supervisor/a de Ventas (13). */
export const CARGOS_SIN_CODIGO = [2, 3, 11, 13];

/**
 * El cliente que va en la venta cuando no se puede mandar el real: CLIENTE
 * FRECUENTE (consumidor final). Su id es el del sistema de la caja.
 */
export const CLIENTE_GENERICO = '-2';

/** Estados de reserva desde los que se arma una preventa. */
export const ESTADOS_CON_PREVENTA = ['pendiente', 'lista'];

/** Estados de una preventa que todavía cuentan: con una de éstas no se arma otra. */
export const PREVENTA_VIVA = ['enviando', 'viva', 'sin_enlace'];

/** El código de vendedor de quien la envía: el de su ficha, salvo los cargos de administración. */
export function codigoDeVendedor(emp) {
    if (!emp) return null;
    if (CARGOS_SIN_CODIGO.includes(Number(emp.role_id))) return CODIGO_VENDEDOR_ADMIN;
    const c = String(emp.code ?? '').trim();
    return /^\d+$/.test(c) ? c : null;
}

/** Lo que el sistema de la caja lee bien: letras sin tilde, dígitos y signos simples. */
export const esTextoSeguro = (s) => /^[A-Za-z0-9 .,\-()]*$/.test(String(s ?? ''));

/** Un texto pasado a ASCII (sin tildes ni Ñ), en mayúsculas, para una nota. */
export function enAscii(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9 .,\-()/#$]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * A quién se le vende. El cliente real (su número en la caja) si se puede;
 * si no, el genérico, con el motivo.
 *
 * ⚠️ El sistema de la caja tiene un defecto medido el 2026-10-21: si el cliente
 * de una preventa tiene Ñ o una tilde en el nombre, la LISTA de preventas de esa
 * sala sale vacía y desaparecen TODAS, también las que armó la sala a mano. Por
 * eso un nombre que no sea ASCII va como cliente genérico, y el código de la
 * reserva viaja en la nota para que la caja sepa de quién es.
 */
export function clienteDeLaVenta(c) {
    const erp = String(c?.erp_id ?? '').trim();
    if (!/^\d+$/.test(erp)) return { id: CLIENTE_GENERICO, generico: true, motivo: 'sin_ficha_en_caja' };
    if (!esTextoSeguro(c?.name)) return { id: CLIENTE_GENERICO, generico: true, motivo: 'nombre_con_tilde' };
    return { id: erp, generico: false, motivo: null };
}

const centavos = (v) => Math.round(Number(v || 0) * 100) / 100;

/**
 * Arma la venta de una preventa a partir de lo que devuelve `preventa_preparar`.
 *
 * `datos`: `{ codigo, documento, falta_pagar, pagado, cliente: { erp_id, name },
 *   vendedor: { code, role_id }, renglones: [{ reserva_id, producto_id, nombre,
 *   cantidad, factor, precio_unitario, precio_normal, lista_precio }] }`.
 *
 * Devuelve la venta del portal: a quién, quién la vende, los renglones al precio
 * de la reserva, lo que falta pagar y la nota que acompaña a la venta. No dice
 * nada de cómo la recibe la caja: eso lo traduce el adaptador.
 */
export function armarVenta(datos) {
    const renglones = (datos?.renglones ?? []).map((r) => ({
        reserva_id: Number(r.reserva_id),
        producto_id: Number(r.producto_id),
        nombre: String(r.nombre ?? ''),
        cantidad: Number(r.cantidad),
        factor: Number(r.factor) || 1,
        precio: centavos(r.precio_unitario),
        precio_normal: r.precio_normal == null ? null : centavos(r.precio_normal),
        lista_precio: r.lista_precio ?? null,
        subtotal: centavos(Number(r.precio_unitario) * Number(r.cantidad)),
    }));
    if (!renglones.length) throw new Error('La preventa no tiene productos.');
    for (const r of renglones) {
        if (!(r.producto_id > 0)) throw new Error(`«${r.nombre}» no tiene código de producto.`);
        if (!(r.cantidad > 0)) throw new Error(`«${r.nombre}» no tiene cantidad.`);
        if (!(r.precio > 0)) throw new Error(`«${r.nombre}» no tiene precio.`);
    }
    const vendedor = codigoDeVendedor(datos?.vendedor);
    if (!vendedor) throw new Error('Tu ficha no tiene código de vendedor.');
    const cliente = clienteDeLaVenta(datos?.cliente);
    const total = centavos(renglones.reduce((t, r) => t + r.subtotal, 0));
    const faltaPagar = datos?.falta_pagar == null ? total : centavos(datos.falta_pagar);
    const pagado = centavos(datos?.pagado);
    return {
        codigo: String(datos?.codigo ?? ''),
        documento: datos?.documento === 'credito_fiscal' ? 'credito_fiscal' : 'consumidor_final',
        cliente, vendedor, renglones, total, falta_pagar: faltaPagar, pagado,
        nota: notaDeLaVenta({ codigo: datos?.codigo, cliente, nombre: datos?.cliente?.name, pagado, faltaPagar, documento: datos?.documento }),
    };
}

// El monto de la nota NO es texto de pantalla: va al papel de la caja, en ASCII
// y sin separador de miles. Por eso no `formatMoney`, que además es del
// navegador y este archivo lo corre también Deno.
const montoAscii = (v) => '$' + (Math.round(Number(v || 0) * 100) / 100).toFixed(2);

/**
 * La nota que acompaña a la venta en la caja: el código de la reserva siempre;
 * el nombre del cliente cuando va como genérico; lo ya pagado (para no cobrarlo
 * dos veces) y si pide crédito fiscal. Sólo ASCII y corta.
 */
export function notaDeLaVenta({ codigo, cliente, nombre, pagado, faltaPagar, documento }) {
    const partes = [`RESERVA ${enAscii(codigo)}`];
    if (cliente?.generico && nombre) {
        const p = enAscii(nombre).split(' ');
        partes.push(p.length > 2 ? `${p[0]} ${p[2]}` : p.join(' '));
    }
    if (pagado > 0.004) partes.push(`PAGADO ${montoAscii(pagado)} FALTA ${montoAscii(faltaPagar)}`);
    if (documento === 'credito_fiscal') partes.push('CCF');
    return partes.join(' - ').slice(0, 90);
}

/** ¿La fila de la reserva admite enviar una preventa? (La base lo vuelve a decidir.) */
export function puedeEnviarPreventa(r) {
    if (!r || !ESTADOS_CON_PREVENTA.includes(r.estado)) return false;
    if (r.bajo_receta && r.origen === 'app' && r.receta_estado !== 'aprobada') return false;
    return !PREVENTA_VIVA.includes(r.preventa_estado);
}

/** Lo que la sala lee de la preventa de una reserva, en una línea. */
export function textoDePreventa(r) {
    if (!r?.preventa_estado || r.preventa_estado === 'fallida' || r.preventa_estado === 'descartada') return '';
    const ref = r.preventa_ref ? ` #${r.preventa_ref}` : '';
    if (r.preventa_estado === 'enviando') return 'Enviando la preventa…';
    if (r.preventa_estado === 'facturada') return `Facturada${r.factura ? ` · ${r.factura}` : ''}`;
    if (r.preventa_estado === 'sin_enlace') return `Preventa${ref} en caja · al facturar, ciérrala con «Retirar»`;
    return `Preventa${ref} en caja`;
}
