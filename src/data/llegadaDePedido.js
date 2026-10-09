/**
 * Confirmar que el pedido LLEGÓ a la sala: qué cajas vinieron bien, dañadas o
 * no vinieron, el Electrolit, las cajas especiales y las extra.
 *
 * Vivía dentro de `hooks/usePedidosData.js` (`handleLlegadaConfirm`). Se mudó
 * el 2026-10-01 cuando la app empezó a recibir pedidos: escrito dos veces, el
 * día que cambie cómo se marca una caja faltante, el teléfono marcaría otros
 * renglones que el portal. El hook y la app llaman a esta función.
 *
 * Desde el 2026-10-08 va en UNA transacción (`confirmar_llegada_pedido`): los
 * renglones de las cajas que no llegaron quedan en `falta_caja`, igual el
 * Electrolit y las especiales que faltaron, la etapa avanza a «llegó» y se
 * guarda el detalle. Desde el 2026-10-09 es el único camino: el navegador ya
 * no puede escribir `pedido_items` ni esas columnas de la sala.
 * Los avisos a Bodega los dispara la base (`avisar_camino_del_pedido`).
 *
 * Devuelve `{ tipo, electrolitSinUbicar, yaConfirmada? }` o LANZA: quien llama decide cómo
 * decirlo. `electrolitSinUbicar` son las cajas de Electrolit que faltaron y no
 * se pudo saber de qué sabor eran: quedan anotadas en la sala, sin renglón.
 */
import { fetchPedidoSucursalStatus } from './pedidos';
import { cajasDeRenglon } from '../utils/cajasEspeciales';
import { codigoDeNegocio, pasoDelPedido } from './pasosDelPedido';

/**
 * Qué renglones bloquea «faltaron N cajas de Electrolit» — sólo cuando se
 * puede SABER cuáles son.
 *
 * La sala responde un número, no un sabor: la pantalla de llegada pregunta
 * «¿cuántas cajas de Electrolit no llegaron?». Antes se marcaban los primeros N
 * renglones de Electrolit de la lista (`slice(0, n)`), o sea que con dos sabores
 * y una caja faltante se daba por no llegada la de MANZANA aunque faltara la de
 * COCO —la misma clase de error que costó el pedido #178 con las especiales— y
 * además contaba renglones donde la sala contaba CAJAS.
 *
 * Se puede saber en dos casos, y sólo en esos se marca:
 *   · faltan todas — entonces son todos los renglones;
 *   · todas son del mismo producto — da igual cuál de sus renglones.
 * Si no, NO se marca ninguno: el faltante queda anotado en la sala
 * (`electrolit_faltantes`) y `sinUbicar` lo dice para que quien llama lo avise.
 * Marcar uno al azar bloquea un producto que está en el estante y deja contar
 * como llegado el que no vino; sin marcar, el que no llegó sale como diferencia
 * al contarlo, que es la verdad.
 *
 * Los candidatos son los de `cajas_electrolit` (Electrolit despachado por CAJA)
 * que NO viajan como caja especial: ésas se preguntan aparte, con su etiqueta
 * E1…En, y ya tienen su propio mapa (`renglonesDeCajasFaltantes`). Las cajas
 * se cuentan sobre lo que SALIÓ (`cantidad_enviada`), no sobre lo asignado.
 */
export function renglonesDeElectrolitFaltante(rows, faltantes) {
    const n = Number(faltantes) || 0;
    if (n <= 0) return { ids: [], sinUbicar: 0 };
    const candidatos = (rows ?? []).filter((r) =>
        (r?.products?.nombre ?? '').toLowerCase().includes('electrolit')
        && (r?.dispatch_tipo ?? '').toUpperCase() === 'CAJA'
        && r?.caja_especial !== true
        && !r?.falta_caja
        && r?.status === 'pendiente')
        .map((r) => ({ r, cajas: cajasDeRenglon({ ...r, cantidad_asignada: r.cantidad_enviada ?? r.cantidad_asignada }) }))
        .filter((c) => c.cajas > 0);
    if (!candidatos.length) return { ids: [], sinUbicar: n };
    const total = candidatos.reduce((s, c) => s + c.cajas, 0);
    const productos = new Set(candidatos.map((c) => c.r.erp_product_id ?? c.r.products?.nombre));
    if (n >= total || productos.size === 1) {
        return { ids: candidatos.map((c) => c.r.id), sinUbicar: 0 };
    }
    return { ids: [], sinUbicar: n };
}

// Cuenta TODO lo que no llegó, no sólo las cajas numeradas. Escrito con
// `cajasFaltantes` a secas, el 1-sep-2026 Salud 1 reportó cuatro cajas de
// Electrolit no recibidas y la tarjeta igual dijo «Llegada confirmada — sin
// novedad»: las seis cajas con número sí habían llegado, y el tipo no miraba
// nada más.
export function tipoDeLlegada({ cajasDanadas = [], cajasFaltantes = [], electrolitFaltantes = null, especialesLlegadas = null }) {
    const hasFalta = cajasFaltantes.length > 0 || (electrolitFaltantes ?? 0) > 0
        || (!!especialesLlegadas && Object.values(especialesLlegadas).some((v) => v === 'faltante'));
    const hasDanada = cajasDanadas.length > 0;
    return hasFalta && hasDanada ? 'mixto' : hasFalta ? 'falta_caja' : hasDanada ? 'caja_danada' : 'completa';
}

// ── El camino de una sola transacción (2026-10-08) ──────────────────────────
//
// `confirmar_llegada_pedido` lo hace en la base, en un solo paso: un corte de
// red entre «llegó» y el detalle ya no deja la sala «llegó» sin `llegada_tipo`
// (sin aviso a bodega), ni renglones bloqueados de un pedido que figura sin
// llegar. Un caso se reintenta:
//   · el pedido es VIEJO y no tiene el mapa de renglones por hoja: la función
//     contesta PAGINA_ITEMS_REQUERIDO, se recalcula acá con la paginación del
//     PDF (que vive en JS) y se reintenta mandándolo; la función lo guarda.
// Un doble clic (YA_CONFIRMADA) no es un error: la llegada ya quedó, y se
// devuelve el tipo que tiene la base.
export async function confirmarLlegadaDePedido(args) {
    const {
        pedidoId, sucId, rows = [],
        cajasDanadas = [], cajasFaltantes = [], nota = '', electrolitFaltantes = null,
        especialesLlegadas = null, cajasExtra = 0, cajasExtraNotas = null,
    } = args;
    // El Electrolit que faltó lo elige ACÁ
    // (`renglonesDeElectrolitFaltante`: sólo se marca lo que se sabe cuál es) y
    // la función recibe los ids: elegir «los N primeros» en la base era el
    // `slice(0, n)` que ya se había corregido.
    const elec = (electrolitFaltantes ?? 0) > 0
        ? renglonesDeElectrolitFaltante(rows, electrolitFaltantes)
        : { ids: [], sinUbicar: 0 };

    const params = {
        p_pedido_id: pedidoId, p_sucursal_id: sucId,
        p_cajas_danadas: cajasDanadas, p_cajas_faltan: cajasFaltantes,
        p_nota: nota || null, p_electrolit_faltan: electrolitFaltantes,
        p_especiales_llegadas: especialesLlegadas,
        p_cajas_extra: cajasExtra > 0 ? cajasExtra : 0,
        p_cajas_extra_notas: cajasExtra > 0 ? (cajasExtraNotas ?? null) : null,
        p_pagina_items: null,
        p_electrolit_ids: elec.ids.length > 0 ? elec.ids : null,
    };
    let res = await pasoDelPedido('confirmar_llegada_pedido', params);
    if (res.error && codigoDeNegocio(res.error) === 'PAGINA_ITEMS_REQUERIDO') {
        const paginaItems = await mapaDeHojasRecalculado(sucId, rows);
        res = await pasoDelPedido('confirmar_llegada_pedido', { ...params, p_pagina_items: paginaItems });
    }
    if (res.error && codigoDeNegocio(res.error) === 'YA_CONFIRMADA') {
        const { data: pss } = await fetchPedidoSucursalStatus(pedidoId, sucId, 'llegada_tipo');
        return { tipo: pss?.llegada_tipo ?? tipoDeLlegada({ cajasDanadas, cajasFaltantes, electrolitFaltantes, especialesLlegadas }), electrolitSinUbicar: 0, yaConfirmada: true };
    }
    if (res.error) throw res.error;
    return { tipo: res.data?.tipo ?? tipoDeLlegada({ cajasDanadas, cajasFaltantes, electrolitFaltantes, especialesLlegadas }), electrolitSinUbicar: elec.sinUbicar };
}

// El mapa hoja → renglones de un pedido viejo, con la misma paginación del PDF.
// Va por import() porque ese archivo es el del papel, y en el teléfono sólo
// hace falta este camino de excepción.
async function mapaDeHojasRecalculado(sucId, rows) {
    const { getExactPageGroups } = await import('../utils/pedidoPrint');
    const pageGroups = await getExactPageGroups(sucId, rows);
    const recomputed = {};
    pageGroups.forEach((pg, idx) => { recomputed[String(idx + 1)] = pg.ids; });
    return recomputed;
}
