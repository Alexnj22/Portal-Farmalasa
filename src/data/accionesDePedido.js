// Las acciones de Bodega y de la sala sobre un pedido, UNA vez para el portal
// (`usePedidosData`, `TabGenerar`) y la app del teléfono.
//
// Vivían dentro del hook del portal mezcladas con su estado de React (modales,
// «busy», recargas). Lo que sigue es sólo la ESCRITURA: quien llama decide qué
// pintar antes y después. Escrito dos veces, el día que una de las copias
// cambie el historial de reenvíos o la cuenta del código, las dos pantallas
// dejarían el mismo pedido en estados distintos.
import {
    anularPedido, avanzarEtapaDePedidoEnSala, confirmarPedido, fetchPedidoIdsSinceExcluding, fetchPedidoNumero,
    fetchPedidoSucursalStatus, fetchPedidoSucursalStatusForPedidos, fetchVistaPreviaDePedido,
    iniciarCodigosDeSucursalesDelPedido,
} from './pedidos';
import { confirmarLlegadaDeReenvio as llegadaDeReenvioEnLaBase, programarEntregaSala } from './pasosDelPedido';
import { PAUSE_REASONS } from '../constants/pedidos';
import { SUCURSALES } from '../constants/erp';
import { buildPedidoCodigo, fefoProject } from '../utils/codigoDePedido';

const sinError = ({ error }) => { if (error) throw error; };

/** Avanza la etapa de UNA sala del pedido: 'iniciar' | 'pausar' | 'reanudar'. */
export async function etapaDePedido({ pedidoId, sucId, stage, userId = null, razon = null }) {
    sinError(await avanzarEtapaDePedidoEnSala({ p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: stage, p_user_id: userId, p_razon: razon }));
}

/** El texto de una pausa, como lo guarda el historial: «Almuerzo — comentario». */
export function textoDePausa(razonKey, comentario = '') {
    const r = PAUSE_REASONS.find((x) => x.key === razonKey);
    const base = r?.label ?? razonKey;
    return comentario.trim() ? `${base} — ${comentario.trim()}` : base;
}

/** Las razones que todavía se pueden usar (el almuerzo, una vez por pedido). */
export function razonesDePausaDisponibles(historial = []) {
    // La razón se guarda como «Rótulo — comentario» (`textoDePausa`): una pausa
    // de esa razón es la que EMPIEZA con su rótulo.
    const usadas = (r) => historial.filter((h) => String(h.razon ?? '').toLowerCase().startsWith(r.label.toLowerCase())).length;
    return PAUSE_REASONS.filter((r) => r.maxUses == null || usadas(r) < r.maxUses);
}

export async function anularPedidoConMotivo({ pedidoId, userId = null, motivo = null }) {
    sinError(await anularPedido({ p_pedido_id: pedidoId, p_anulado_por: userId, p_motivo: motivo || null }));
}

/**
 * Programar (o mover) la entrega a una sala; cada cambio queda en el historial.
 * La entrada se AGREGA en la base (`programar_entrega_sala`, `pasosDelPedido`):
 * reescribir el arreglo entero con lo que leyó la pantalla dejaba que dos
 * pantallas abiertas se pisaran la entrada sin error. Quién la programó lo
 * pone la base desde la sesión.
 */
export async function programarEntregaDePedido({ pedidoId, sucId, nuevoIso }) {
    sinError(await programarEntregaSala({ pedidoId, sucId, cuando: nuevoIso }));
}

/**
 * ¿Hay un reenvío pedido que todavía no salió de Bodega? Con la base al día el
 * ciclo nace PENDIENTE (`sent_at` nulo) y la base le pone `sent_at` cuando sale
 * su ruta: hasta entonces no se puede confirmar su llegada.
 */
export function reenvioTodaviaEnBodega(historial = []) {
    return (historial ?? []).some((c) => c && !c.sent_at && !c.arrived_at);
}

/**
 * El ciclo de reenvío que falta confirmar: el primero que SALIÓ (`sent_at`) y
 * no llegó. Uno pendiente sigue en Bodega y no cuenta (ver
 * `reenvioTodaviaEnBodega`); antes se tomaba el primero sin `arrived_at`, o el
 * último aunque ya hubiera llegado. Sin historial, los pedidos viejos traían
 * sólo `falta_cajas`: se arma un ciclo 1. `null` si no hay nada que confirmar.
 */
export function cicloDeReenvioPendiente(historial = [], faltaCajasLegacy = []) {
    const h = historial ?? [];
    const ciclo = h.find((c) => c?.sent_at && !c.arrived_at);
    if (!ciclo) {
        if (reenvioTodaviaEnBodega(h)) return null;
        return faltaCajasLegacy?.length ? { ciclo: 1, cajas: faltaCajasLegacy, electrolits: 0, especiales: [], historial: [] } : null;
    }
    return { ciclo: ciclo.ciclo, cajas: ciclo.cajas ?? [], electrolits: ciclo.electrolits ?? 0, especiales: ciclo.especiales ?? [], historial: h };
}

/**
 * Confirmar la llegada de un reenvío. Todo en UNA transacción de la base
 * (`confirmar_llegada_reenvio`, `pasosDelPedido`): el ciclo, las cajas, el
 * Electrolit, las especiales y los renglones que se liberan. Antes eran de
 * cuatro a siete escrituras desde el cliente y un corte en el medio dejaba la
 * llegada confirmada con renglones todavía bloqueados. Mientras la base no
 * tenga la función, `pasosDelPedido` cae al camino de pasos sueltos.
 *
 * Devuelve lo que la pantalla necesita para abrir el conteo. `yaEstaba`: el
 * segundo clic de un doble clic — ya estaba confirmada, sólo hay que refrescar.
 *
 * El aviso a Bodega si todavía falta algo lo escribe la base al ver
 * `segunda_llegada_at` (`avisar_camino_del_pedido`), no quien llama.
 */
export async function confirmarLlegadaDeReenvio({
    pedidoId, sucId, ciclo, electrolitCount = 0,
    cajasOk = [], cajasDanadas = [], cajasFaltantes = [], nota = '', electrolitOk = true, especialesAun = [],
}) {
    const { data, error } = await llegadaDeReenvioEnLaBase({
        pedidoId, sucId, ciclo,
        cajasOk, cajasDanadas, cajasFaltantes, nota,
        electrolitOk, electrolitCount, especialesAun,
    });
    if (error) throw error;
    // El mapa de hojas y lo ya contado, para abrir la recepción de lo que llegó.
    const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId,
        'caja_map, pagina_items, paginas, hojas_recibidas');
    if (pssErr) throw pssErr;
    return {
        arrivedTipo: data?.arrived_tipo ?? null,
        yaEstaba: !!data?.yaEstaba,
        cajaMap: pss?.caja_map ?? {}, paginaItems: pss?.pagina_items ?? {},
        paginas: pss?.paginas ?? [], hojasRecibidas: pss?.hojas_recibidas ?? [],
    };
}

/** Un renglón de la vista previa, como lo espera `confirm_pedido`. */
export function renglonParaConfirmar(row) {
    return {
        erp_sucursal_id:       row.erp_sucursal_id,
        erp_product_id:        row.erp_product_id,
        erp_presentacion_id:   row.erp_presentacion_id,
        cantidad_asignada:     row.cantidad_asignada,
        sin_stock:             row.sin_stock,
        revision_minmax:       row.revision_minmax,
        agotamiento:           row.agotamiento ?? false,
        stock_packs_snapshot:  Number(row.stock_packs),
        max_qty_snapshot:      row.max_qty,
        min_qty_snapshot:      row.min_qty,
        urgencia_pct_snapshot: row.urgencia_pct,
        lotes_asignados:       fefoProject(row.lotes_bodega, row.cantidad_asignada),
        factor:                row.factor,
        dispatch_tipo:         row.dispatch_tipo,
        dispatch_factor:       row.dispatch_factor,
        // confirm_pedido lo lee del payload; sin mandarlo, el COALESCE lo dejaba
        // en 1 para todo el catálogo (391 reglas tienen otro múltiplo).
        dispatch_multiplo:     row.dispatch_multiplo ?? 1,
        caja_especial:         row.caja_especial ?? false,
    };
}

/** Los renglones de la vista previa repartidos por sala y por sección del papel. */
export function renglonesPorSala(rows) {
    const map = {};
    for (const row of rows) {
        const s = row.erp_sucursal_id;
        if (!map[s]) map[s] = { normal: [], revision: [], sinStock: [], agotamiento: [] };
        if (row.sin_stock) map[s].sinStock.push(row);
        else if (row.revision_minmax) map[s].revision.push(row);
        else if (row.agotamiento) map[s].agotamiento.push(row);
        else map[s].normal.push(row);
    }
    return map;
}

/**
 * La vista previa de un pedido directo (lo que se va a mandar, renglón por
 * renglón). `globalMode`: el cálculo mira a TODAS las salas (reparte la Bodega
 * entre todas) pero el pedido sale sólo para las elegidas.
 */
export async function vistaPreviaDePedido({ salas, globalMode = false }) {
    const elegidas = [...salas];
    const rpcParams = globalMode ? { p_sucursal_ids: SUCURSALES, p_target_ids: elegidas } : { p_sucursal_ids: elegidas };
    const { data, error } = await fetchVistaPreviaDePedido(rpcParams);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

/**
 * Confirma una vista previa YA calculada y deja el código de cada sala. Va
 * aparte de `vistaPreviaDePedido` para que el portal muestre el resumen por
 * sala ANTES de confirmar: lo que se ve es lo que se guarda.
 * NO imprime: el papel lo arma quien llama (el portal, con pdfmake).
 *
 * `numero` puede venir `null` (la lectura se reintenta una vez): quien llama
 * dice «el pedido», nunca «Pedido #undefined». `codigosError`: los códigos de
 * sala no se guardaron — el pedido SÍ quedó confirmado, y hay que avisarlo.
 */
export async function confirmarPedidoDirecto({ rows, salas, globalMode = false, userId = null, responsableId = null }) {
    const elegidas = [...salas];
    const items = rows.map(renglonParaConfirmar);
    const { data: pedidoId, error: confErr } = await confirmarPedido({
        p_created_by: userId, p_notes: null, p_items: items,
        p_responsable_id: responsableId, p_revisado_por: null, p_sucursal_ids: elegidas,
    }, { directo: true });
    if (confErr) throw confErr;

    let numero = null;
    for (let intento = 0; intento < 2 && numero == null; intento++) {
        const { data: ped, error: numErr } = await fetchPedidoNumero(pedidoId);
        if (numErr) console.error('[pedidos] número del pedido:', numErr);
        numero = ped?.numero ?? null;
    }

    const map = renglonesPorSala(rows);
    const sucIds = SUCURSALES.filter((id) => map[id]);

    // El número de cada sala en el mes: cuántos pedidos tuvo este mes + 1.
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { data: delMes } = await fetchPedidoIdsSinceExcluding(inicioMes, pedidoId);
    const idsDelMes = (delMes ?? []).map((p) => p.id);
    const cuenta = {};
    for (const id of sucIds) cuenta[id] = 1;
    if (idsDelMes.length) {
        const { data: previos } = await fetchPedidoSucursalStatusForPedidos(idsDelMes, sucIds);
        for (const r of (previos ?? [])) if (cuenta[r.erp_sucursal_id] !== undefined) cuenta[r.erp_sucursal_id]++;
    }
    const codigoFn = buildPedidoCodigo(cuenta, new Date(), globalMode ? SUCURSALES.length : sucIds.length);
    const codigos = {};
    for (const id of sucIds) codigos[id] = codigoFn(id);
    // Los códigos de sala son los que llevan los PDF y los que se buscan
    // después: el error ya no se descarta, vuelve en `codigosError`.
    let codigosError = null;
    try {
        const { error } = await iniciarCodigosDeSucursalesDelPedido({
            p_pedido_id: pedidoId, p_codigos: sucIds.map((id) => ({ erp_sucursal_id: id, codigo: codigos[id] })),
        });
        codigosError = error ?? null;
    } catch (e) {
        codigosError = e;
    }
    if (codigosError) console.error('[pedidos] códigos de sala:', codigosError);

    return { pedidoId, numero, rows, items, map, sucIds, codigoFn, codigos, codigosError };
}

/**
 * Generar un pedido directo de una vez: calcula, confirma y deja el código de
 * cada sala (la app del teléfono). Devuelve `null` si las salas están
 * abastecidas.
 */
export async function generarPedidoDirecto({ salas, globalMode = false, userId = null, responsableId = null }) {
    const rows = await vistaPreviaDePedido({ salas, globalMode });
    if (!rows.length) return null;
    return confirmarPedidoDirecto({ rows, salas, globalMode, userId, responsableId });
}
