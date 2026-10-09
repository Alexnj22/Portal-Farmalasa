/**
 * Confirmar que el pedido LLEGÓ a la sala: qué cajas vinieron bien, dañadas o
 * no vinieron, el Electrolit, las cajas especiales y las extra.
 *
 * Vivía dentro de `hooks/usePedidosData.js` (`handleLlegadaConfirm`). Se mudó
 * el 2026-10-01 cuando la app empezó a recibir pedidos: escrito dos veces, el
 * día que cambie cómo se marca una caja faltante, el teléfono marcaría otros
 * renglones que el portal. El hook y la app llaman a esta función.
 *
 * Desde el 2026-10-08 va en UNA transacción (`confirmar_llegada_pedido`); el
 * orden de abajo es el del camino de pasos que queda de respaldo:
 *   1. los renglones de las cajas que no llegaron quedan en `falta_caja`
 *      (por hoja si existe el mapa, si no se recalcula, y si tampoco, todos);
 *   2. el Electrolit que faltó y las cajas especiales que no llegaron, igual;
 *   3. la etapa avanza a «llegó» (`avanzarEtapaDePedidoEnSala`);
 *   4. se guarda el detalle en `pedido_sucursal_status`.
 * Los avisos a Bodega los dispara la base (`avisar_camino_del_pedido`).
 *
 * Devuelve `{ tipo, electrolitSinUbicar, yaConfirmada? }` o LANZA: quien llama decide cómo
 * decirlo. `electrolitSinUbicar` son las cajas de Electrolit que faltaron y no
 * se pudo saber de qué sabor eran: quedan anotadas en la sala, sin renglón.
 */
import {
    avanzarEtapaDePedidoEnSala, fetchPedidoItemsPendientesIds, fetchPedidoSucursalStatus,
    updatePedidoItemsFaltaCaja, updatePedidoSucursalStatus,
} from './pedidos';
import { cajasDeRenglon, renglonesDeCajasFaltantes } from '../utils/cajasEspeciales';
import { codigoDeNegocio, rpcConRespaldo } from './rpcConRespaldo';

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
// `confirmar_llegada_pedido` hace en la base, en un solo paso, lo mismo que
// `llegadaPasoAPaso` más abajo: un corte de red entre «llegó» y el detalle ya
// no deja la sala «llegó» sin `llegada_tipo` (sin aviso a bodega), ni
// renglones bloqueados de un pedido que figura sin llegar. Sólo va por pasos
// si la base todavía no tiene la función (`rpcConRespaldo`). Y un caso se
// reintenta:
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
    // El Electrolit que faltó lo elige ACÁ la misma regla del camino viejo
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
    const respaldo = async () => ({ data: await llegadaPasoAPaso(args), error: null });
    let res = await rpcConRespaldo('confirmar_llegada_pedido', params, respaldo);
    if (res.error && codigoDeNegocio(res.error) === 'PAGINA_ITEMS_REQUERIDO') {
        const paginaItems = await mapaDeHojasRecalculado(sucId, rows);
        res = await rpcConRespaldo('confirmar_llegada_pedido', { ...params, p_pagina_items: paginaItems }, respaldo);
    }
    if (res.error && codigoDeNegocio(res.error) === 'YA_CONFIRMADA') {
        const { data: pss } = await fetchPedidoSucursalStatus(pedidoId, sucId, 'llegada_tipo');
        return { tipo: pss?.llegada_tipo ?? tipoDeLlegada({ cajasDanadas, cajasFaltantes, electrolitFaltantes, especialesLlegadas }), electrolitSinUbicar: 0, yaConfirmada: true };
    }
    if (res.error) throw res.error;
    if (res.camino === 'respaldo') return res.data;
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

// El camino de siempre, escritura por escritura. Queda para los tres casos de
// arriba; cuando la función esté en producción y reciba el Electrolit ya
// elegido, se va.
async function llegadaPasoAPaso({
    pedidoId, sucId, rows = [], userId = null,
    cajasDanadas = [], cajasFaltantes = [], nota = '', electrolitFaltantes = null,
    especialesLlegadas = null, cajasExtra = 0, cajasExtraNotas = null,
}) {
    const hasFaltaNumerada = cajasFaltantes.length > 0;
    const hasDanada = cajasDanadas.length > 0;
    const hasFaltaElec = (electrolitFaltantes ?? 0) > 0;
    const hasFaltaEsp = !!especialesLlegadas && Object.values(especialesLlegadas).some((v) => v === 'faltante');
    const hasFalta = hasFaltaNumerada || hasFaltaElec || hasFaltaEsp;
    const tipo = tipoDeLlegada({ cajasDanadas, cajasFaltantes, electrolitFaltantes, especialesLlegadas });

    if (hasFaltaNumerada) {
        const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId, 'caja_map, pagina_items');
        if (pssErr) throw pssErr;
        const cajaMapDb = pss?.caja_map ?? {};
        const paginaItemsDb = pss?.pagina_items ?? {};

        let missingIds = [];
        if (Object.keys(paginaItemsDb).length > 0) {
            const missingPages = cajasFaltantes.flatMap((n) => cajaMapDb[String(n)] ?? []);
            missingIds = missingPages.flatMap((p) => paginaItemsDb[String(p)] ?? []);
        } else if (Object.keys(cajaMapDb).length > 0) {
            // Pedidos viejos sin el mapa de hojas: se recalcula y se guarda.
            const recomputed = await mapaDeHojasRecalculado(sucId, rows);
            const { error: pagErr } = await updatePedidoSucursalStatus(pedidoId, sucId, { pagina_items: recomputed });
            if (pagErr) throw pagErr;
            const missingPages = cajasFaltantes.flatMap((n) => cajaMapDb[String(n)] ?? []);
            missingIds = missingPages.flatMap((p) => recomputed[String(p)] ?? []);
        } else {
            const allPending = await fetchPedidoItemsPendientesIds(pedidoId, sucId);
            if (allPending === null) throw new Error('No se pudieron leer los renglones pendientes de la sucursal.');
            missingIds = allPending.map((r) => r.id);
        }
        if (missingIds.length > 0) {
            const { error } = await updatePedidoItemsFaltaCaja(missingIds, true);
            if (error) throw error;
        }
    }

    // Ver `renglonesDeElectrolitFaltante`: sólo se marca lo que se sabe cuál es.
    let electrolitSinUbicar = 0;
    if (hasFaltaElec) {
        const { ids, sinUbicar } = renglonesDeElectrolitFaltante(rows, electrolitFaltantes);
        electrolitSinUbicar = sinUbicar;
        if (ids.length > 0) {
            const { error } = await updatePedidoItemsFaltaCaja(ids, true);
            if (error) throw error;
        }
    }

    if (hasFaltaEsp) {
        const { data: pssEsp, error: pssEspErr } = await fetchPedidoSucursalStatus(pedidoId, sucId, 'cajas_especiales');
        if (pssEspErr) throw pssEspErr;
        const { ids: faltaIds, huerfanas } = renglonesDeCajasFaltantes(pssEsp?.cajas_especiales ?? [], especialesLlegadas);
        if (huerfanas.length > 0) {
            throw new Error(`No se pudo identificar qué producto es la caja ${huerfanas.join(', ')}. Avisa a bodega antes de confirmar la llegada.`);
        }
        if (faltaIds.length > 0) {
            const { error } = await updatePedidoItemsFaltaCaja(faltaIds, true);
            if (error) throw error;
        }
    }

    const { error: llegadaErr } = await avanzarEtapaDePedidoEnSala({
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'confirmar_llegada', p_user_id: userId,
    });
    if (llegadaErr) throw llegadaErr;

    const { error: metaErr } = await updatePedidoSucursalStatus(pedidoId, sucId, {
        llegada_tipo: tipo,
        llegada_nota: nota || null,
        falta_cajas: cajasFaltantes,
        cajas_danadas: cajasDanadas,
        ...((hasFalta || hasDanada) ? { falta_caja_at: new Date().toISOString() } : {}),
        ...(electrolitFaltantes !== null ? { electrolit_ok: electrolitFaltantes === 0, electrolit_faltantes: electrolitFaltantes } : {}),
        ...(especialesLlegadas !== null ? { cajas_especiales_llegadas: especialesLlegadas } : {}),
        cajas_extra: cajasExtra > 0 ? cajasExtra : null,
        cajas_extra_notas: cajasExtra > 0 ? (cajasExtraNotas ?? null) : null,
    });
    if (metaErr) throw metaErr;
    return { tipo, electrolitSinUbicar };
}
