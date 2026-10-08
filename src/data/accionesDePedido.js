// Las acciones de Bodega y de la sala sobre un pedido, UNA vez para el portal
// (`usePedidosData`, `TabGenerar`) y la app del teléfono.
//
// Vivían dentro del hook del portal mezcladas con su estado de React (modales,
// «busy», recargas). Lo que sigue es sólo la ESCRITURA: quien llama decide qué
// pintar antes y después. Escrito dos veces, el día que una de las copias
// cambie el historial de reenvíos o la cuenta del código, las dos pantallas
// dejarían el mismo pedido en estados distintos.
import {
    anularPedido, avanzarEtapaDePedidoEnSala, confirmarPedido, fetchPedidoIdsSinceExcluding, fetchPedidoItemsFaltaElectrolit,
    fetchPedidoItemsFaltaEspeciales, fetchPedidoNumero, fetchPedidoSucursalStatus, fetchPedidoSucursalStatusForPedidos,
    fetchVistaPreviaDePedido, iniciarCodigosDeSucursalesDelPedido, updatePedidoItemsFaltaCaja, updatePedidoSucursalStatus,
} from './pedidos';
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

/** Programar (o mover) la entrega a una sala; cada cambio queda en el historial. */
export async function programarEntregaDePedido({ pedidoId, sucId, nuevoIso, historial = [], userId = null, nombre = null }) {
    const entry = { programada_at: nuevoIso, registrado_at: new Date().toISOString(), por: userId, nombre };
    sinError(await updatePedidoSucursalStatus(pedidoId, sucId, {
        entrega_programada_at: nuevoIso, entrega_programada_historial: [...(historial ?? []), entry],
    }));
}

/**
 * El ciclo de reenvío que falta confirmar: el primero sin `arrived_at`. Sin
 * historial, los pedidos viejos traían sólo `falta_cajas`: se arma un ciclo 1.
 * `null` si no hay nada pendiente.
 */
export function cicloDeReenvioPendiente(historial = [], faltaCajasLegacy = []) {
    const h = historial ?? [];
    const idx = h.findIndex((c) => !c.arrived_at);
    const ciclo = idx >= 0 ? h[idx] : h[h.length - 1];
    if (!ciclo) {
        return faltaCajasLegacy.length ? { ciclo: 1, cajas: faltaCajasLegacy, electrolits: 0, especiales: [], historial: [] } : null;
    }
    return { ciclo: ciclo.ciclo, cajas: ciclo.cajas ?? [], electrolits: ciclo.electrolits ?? 0, especiales: ciclo.especiales ?? [], historial: h };
}

/**
 * Confirmar la llegada de un reenvío. Escribe el ciclo en el historial, deja
 * `falta_caja` sólo en lo que sigue sin llegar y actualiza Electrolit y cajas
 * especiales. Devuelve lo que la pantalla necesita para abrir el conteo.
 *
 * El aviso a Bodega si todavía falta algo lo escribe la base al ver
 * `segunda_llegada_at` (`avisar_camino_del_pedido`), no quien llama.
 */
export async function confirmarLlegadaDeReenvio({
    pedidoId, sucId, ciclo, historial = [], electrolitCount = 0, especialesList = [], userId = null,
    cajasOk = [], cajasDanadas = [], cajasFaltantes = [], nota = '', electrolitOk = true, especialesAun = [],
}) {
    const now = new Date().toISOString();
    const hasFalta = cajasFaltantes.length > 0;
    const arrivedTipo = hasFalta && cajasDanadas.length > 0 ? 'mixto'
        : hasFalta ? 'falta_caja'
        : cajasDanadas.length > 0 ? 'caja_danada'
        : 'ok';

    const nuevoHistorial = (historial ?? []).map((c) => (c.ciclo === ciclo
        ? { ...c, arrived_at: now, arrived_tipo: arrivedTipo, arrived_por: userId, cajas_ok: cajasOk, cajas_danadas: cajasDanadas, cajas_aun_faltantes: cajasFaltantes, nota: nota || null,
            // Lo que sigue faltando, escrito en el ciclo: el aviso a bodega
            // sale de la base con ESTA escritura, antes de las que siguen.
            electrolit_ok: electrolitCount > 0 ? electrolitOk === true : null,
            especiales_aun: especialesAun }
        : c));

    sinError(await updatePedidoSucursalStatus(pedidoId, sucId, {
        segunda_llegada_at: now,
        reenvios_historial: nuevoHistorial,
        falta_cajas: hasFalta ? cajasFaltantes : [],
        ...(electrolitCount > 0 ? { electrolit_ok: electrolitOk === true, electrolit_faltantes: electrolitOk ? 0 : electrolitCount } : {}),
    }));

    const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId,
        'caja_map, pagina_items, paginas, hojas_recibidas, cajas_danadas, cajas_especiales_llegadas');
    if (pssErr) throw pssErr;
    const cajaMapDb = pss?.caja_map ?? {};
    const paginaItemsDb = pss?.pagina_items ?? {};
    const idsDeCajas = (cajas) => {
        if (!Object.keys(paginaItemsDb).length) return [];
        return cajas.flatMap((n) => (cajaMapDb[String(n)] ?? []).flatMap((p) => paginaItemsDb[String(p)] ?? []));
    };

    // Lo que llegó (bien o dañado) deja de faltar; lo que no, sigue faltando.
    const llegaron = idsDeCajas([...cajasOk, ...cajasDanadas]);
    if (llegaron.length) sinError(await updatePedidoItemsFaltaCaja(llegaron, false));
    if (hasFalta) {
        const siguen = idsDeCajas(cajasFaltantes);
        if (siguen.length) sinError(await updatePedidoItemsFaltaCaja(siguen, true));
    }

    if (electrolitCount > 0 && electrolitOk) {
        const faltaElec = await fetchPedidoItemsFaltaElectrolit(pedidoId, sucId);
        if (faltaElec === null) throw new Error('No se pudieron leer los renglones de Electrolit marcados como faltantes.');
        const elecIds = faltaElec.filter((r) => (r.products?.nombre ?? '').toLowerCase().includes('electrolit')).map((r) => r.id);
        if (elecIds.length) sinError(await updatePedidoItemsFaltaCaja(elecIds, false));
    }

    const espLlegaron = (especialesList ?? []).filter((l) => !especialesAun.includes(l));
    if (espLlegaron.length || especialesAun.length) {
        const merged = { .../** @type {Record<string, string>} */ (pss?.cajas_especiales_llegadas ?? {}) };
        for (const l of espLlegaron) merged[l] = 'ok';
        for (const l of especialesAun) merged[l] = 'faltante';
        sinError(await updatePedidoSucursalStatus(pedidoId, sucId, { cajas_especiales_llegadas: merged }));
        if (espLlegaron.length) {
            const faltaEsp = await fetchPedidoItemsFaltaEspeciales(pedidoId, sucId);
            if (faltaEsp === null) throw new Error('No se pudieron leer los renglones de cajas especiales marcados como faltantes.');
            if (faltaEsp.length) {
                const idsToClean = especialesAun.length === 0
                    ? faltaEsp.map((r) => r.id)
                    : faltaEsp.slice(0, Math.round(faltaEsp.length * espLlegaron.length / (especialesList ?? []).length)).map((r) => r.id);
                if (idsToClean.length) sinError(await updatePedidoItemsFaltaCaja(idsToClean, false));
            }
        }
    }

    return { arrivedTipo, cajaMap: cajaMapDb, paginaItems: paginaItemsDb, paginas: pss?.paginas ?? [], hojasRecibidas: pss?.hojas_recibidas ?? [] };
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
 * Generar un pedido directo: calcula, confirma y deja el código de cada sala.
 * NO imprime: el papel lo arma quien llama (el portal, con pdfmake).
 * Devuelve `null` si las salas están abastecidas.
 *
 * `globalMode`: el cálculo mira a TODAS las salas (reparte la Bodega entre
 * todas) pero el pedido sale sólo para las elegidas.
 */
export async function generarPedidoDirecto({ salas, globalMode = false, userId = null, responsableId = null }) {
    const elegidas = [...salas];
    const rpcParams = globalMode ? { p_sucursal_ids: SUCURSALES, p_target_ids: elegidas } : { p_sucursal_ids: elegidas };
    const { data, error } = await fetchVistaPreviaDePedido(rpcParams);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return null;

    const items = rows.map(renglonParaConfirmar);
    const { data: pedidoId, error: confErr } = await confirmarPedido({
        p_created_by: userId, p_notes: null, p_items: items,
        p_responsable_id: responsableId, p_revisado_por: null, p_sucursal_ids: elegidas,
    }, { directo: true });
    if (confErr) throw confErr;
    const { data: ped } = await fetchPedidoNumero(pedidoId);

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
    // `Promise.resolve`: una consulta de supabase se puede esperar pero NO trae
    // `.catch` propio — escrito directo revienta con «undefined is not a function»
    // después de haber creado el pedido.
    await Promise.resolve(iniciarCodigosDeSucursalesDelPedido({
        p_pedido_id: pedidoId, p_codigos: sucIds.map((id) => ({ erp_sucursal_id: id, codigo: codigos[id] })),
    })).catch(() => {});

    return { pedidoId, numero: ped?.numero ?? null, rows, items, map, sucIds, codigoFn, codigos };
}
