// ── Los pasos del pedido que eran varias escrituras, en una sola (2026-10-08) ──
//
// Finalizar una sala, pedir un reenvío, confirmar la llegada de un reenvío y
// programar la entrega se hacían desde `hooks/usePedidosData.js` en dos a siete
// escrituras seguidas. Un corte de red en el medio dejaba la sala a medias —
// finalizada sin cajas ni hojas, «llegó» con renglones todavía bloqueados— y
// los dos historiales jsonb se reescribían ENTEROS con lo que había leído la
// pantalla, así que dos pantallas abiertas se pisaban la entrada sin error.
//
// Cada paso es ahora UNA función de la base, que bloquea la fila y lo hace todo
// en una transacción. Mientras producción no las tenga, `rpcConRespaldo` cae al
// camino viejo, que vive acá abajo tal cual estaba en el hook.
//
// Todas devuelven `{ data, error }`. Un rechazo `YA_…` —el segundo clic de un
// doble clic— NO vuelve como error: vuelve `data.yaEstaba = true`, porque lo
// que se pidió ya está hecho y quien llama sólo tiene que refrescar.
import {
    avanzarEtapaDePedidoEnSala, confirmarEnvioPedido, fetchPedidoItemsFaltaElectrolit,
    fetchPedidoItemsFaltaEspeciales, fetchPedidoSucursalStatus, updatePedidoItemsFaltaCaja,
    updatePedidoSucursalStatus,
} from './pedidos';
import { renglonesDeCajasFaltantes } from '../utils/cajasEspeciales';
import { codigoDeNegocio, rpcConRespaldo } from './rpcConRespaldo';
import { reenvioSaleEnRuta } from './pedidos';

function yaEstabaHecho(res, codigo) {
    if (res.error && codigoDeNegocio(res.error) === codigo) {
        return { data: { yaEstaba: true }, error: null, camino: res.camino };
    }
    return res;
}

// ── Finalizar la sala: qué sale + finalizado + cajas y hojas ────────────────
// El traslado al sistema NO va acá: sigue después y aparte, como siempre — su
// fallo no puede deshacer el finalizado.
export async function finalizarSalaConCajas({
    pedidoId, sucId, userId = null, totalCajas, cajaMap, paginaItems,
    cajasElectrolit = 0, cajasEspeciales = [], ajustesEnvio = [],
}) {
    const res = await rpcConRespaldo('finalizar_sala_con_cajas', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_total_cajas: totalCajas,
        p_caja_map: cajaMap ?? {}, p_pagina_items: paginaItems ?? {},
        p_cajas_electrolit: cajasElectrolit, p_cajas_especiales: cajasEspeciales,
        p_ajustes: ajustesEnvio,
    }, async () => {
        // 1. Qué sale de verdad. Va ANTES de finalizar porque la RPC solo
        //    toca renglones en 'pendiente', y porque el traslado al sistema
        //    se apoya en este dato.
        const { error: envErr } = await confirmarEnvioPedido(pedidoId, sucId, ajustesEnvio);
        if (envErr) return { data: null, error: envErr };
        // 2. Finalizar. El `error` de esta RPC NO se puede ignorar: rechaza
        //    con excepción cuando hay una pausa sin reanudar.
        const { error: lcErr } = await avanzarEtapaDePedidoEnSala({
            p_pedido_id: pedidoId, p_sucursal_id: sucId,
            p_stage: 'finalizar', p_user_id: userId,
        });
        if (lcErr) return { data: null, error: lcErr };
        // 3. Cajas y hojas.
        const { error: pssErr } = await updatePedidoSucursalStatus(pedidoId, sucId, {
            total_cajas: totalCajas, caja_map: cajaMap, pagina_items: paginaItems,
            cajas_electrolit: cajasElectrolit, cajas_especiales: cajasEspeciales,
        });
        return { data: null, error: pssErr ?? null };
    });
    return yaEstabaHecho(res, 'YA_FINALIZADO');
}

// ── Programar la entrega: la entrada se AGREGA al historial en la base ──────
// `historial`, `por` y `nombre` sólo los usa el camino viejo, que todavía
// escribe el arreglo entero. Devuelve el historial final.
export async function programarEntregaSala({ pedidoId, sucId, cuando, motivo = null, historial = [], por = null, nombre = null }) {
    return rpcConRespaldo('programar_entrega_sala', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_cuando: cuando, p_motivo: motivo,
    }, async () => {
        const entry = { programada_at: cuando, registrado_at: new Date().toISOString(), por, nombre };
        const newHist = [...(historial ?? []), entry];
        const { error } = await updatePedidoSucursalStatus(pedidoId, sucId,
            { entrega_programada_at: cuando, entrega_programada_historial: newHist });
        return { data: error ? null : newHist, error: error ?? null };
    });
}

// ── Pedir un reenvío: el ciclo lo numera la base ────────────────────────────
// `especiales` acepta etiquetas o `{ label, producto }`; el ciclo guarda sólo
// la etiqueta. Devuelve `{ ciclo, clave }` (clave = `pedido__suc__rN`, la que
// usa «Nueva ruta» para marcar el reenvío).
export async function pedirReenvioSala({ pedidoId, sucId, cajas = [], especiales = [], electrolits = 0, userId = null }) {
    const etiquetas = especiales.map(e => (typeof e === 'string' ? e : e.label));
    return rpcConRespaldo('pedir_reenvio_sala', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_cajas: cajas,
        p_especiales: etiquetas, p_electrolits: electrolits,
    }, async () => {
        const now = new Date().toISOString();
        const enRuta = await reenvioSaleEnRuta();
        const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId, 'reenvios_historial');
        if (pssErr) return { data: null, error: pssErr };
        const historial = pss?.reenvios_historial ?? [];
        const ciclo     = historial.length + 1;
        // Con la base al día, el ciclo nace PENDIENTE (2026-10-07): `sent_at`
        // nulo y sin tocar `reenvio_bodega_at`; cuando la ruta sale, la base le
        // pone `sent_at` y avisa (`avisar_salida_de_ruta`). Sin esa migración
        // (`reenvioSaleEnRuta` en falso), sale como siempre: enviado al
        // pedirlo, y `reenvio_bodega_at` dispara el aviso a la sala.
        const nuevoCiclo = {
            ciclo, cajas, electrolits, especiales: etiquetas,
            sent_at: enRuta ? null : now, sent_by: enRuta ? null : userId,
            solicitado_at: now, solicitado_por: userId,
            arrived_at: null, arrived_tipo: null, cajas_ok: [], cajas_danadas: [], cajas_aun_faltantes: [],
        };
        const { error } = await updatePedidoSucursalStatus(pedidoId, sucId, {
            reenvio_por:        userId,
            ...(enRuta ? {} : { reenvio_bodega_at: now }),
            reenvios_historial: [...historial, nuevoCiclo],
        });
        if (error) return { data: null, error };
        return { data: { ciclo, clave: `${pedidoId}__${sucId}__r${ciclo}`, enRuta }, error: null };
    });
}

// ── La llegada de un reenvío ────────────────────────────────────────────────
// `especialesAun`: etiquetas que SIGUEN faltando. `electrolitOk`: el modal es
// todo-o-nada; a la base va como «cuántas faltan» (0 = llegó).
export async function confirmarLlegadaDeReenvio({
    pedidoId, sucId, ciclo, historial = [], userId = null,
    cajasOk = [], cajasDanadas = [], cajasFaltantes = [], nota = '',
    electrolitOk = true, electrolitCount = 0, especialesList = [], especialesAun = [],
}) {
    const res = await rpcConRespaldo('confirmar_llegada_reenvio', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_ciclo: ciclo,
        p_cajas_ok: cajasOk, p_cajas_danadas: cajasDanadas, p_cajas_faltan: cajasFaltantes,
        p_especiales: especialesAun,
        p_electrolit_faltan: electrolitCount > 0 && !electrolitOk ? electrolitCount : 0,
        p_nota: nota || null,
    }, async () => {
        const arrived_tipo = await llegadaDeReenvioPasoAPaso({
            pedidoId, sucId, ciclo, historial, userId, cajasOk, cajasDanadas, cajasFaltantes,
            nota, electrolitOk, electrolitCount, especialesList, especialesAun,
        });
        return { data: { ciclo, arrived_tipo }, error: null };
    });
    return yaEstabaHecho(res, 'YA_CONFIRMADO');
}

// El camino de siempre: lanza en el primer error. Devuelve el tipo de llegada.
async function llegadaDeReenvioPasoAPaso({
    pedidoId, sucId, ciclo, historial, userId, cajasOk, cajasDanadas, cajasFaltantes,
    nota, electrolitOk, electrolitCount, especialesList, especialesAun,
}) {
    const now = new Date().toISOString();
    const hasFalta = cajasFaltantes.length > 0;
    const arrived_tipo = hasFalta && cajasDanadas.length > 0 ? 'mixto'
                       : hasFalta                            ? 'falta_caja'
                       : cajasDanadas.length > 0             ? 'caja_danada'
                       :                                        'ok';

    const nuevoHistorial = historial.map(c =>
        c.ciclo === ciclo
            ? { ...c, arrived_at: now, arrived_tipo, arrived_por: userId, cajas_ok: cajasOk, cajas_danadas: cajasDanadas, cajas_aun_faltantes: cajasFaltantes, nota: nota || null,
              // Lo que sigue faltando, escrito en el ciclo: el aviso a bodega
              // sale de la base con ESTA escritura, antes de las que siguen.
              electrolit_ok: electrolitCount > 0 ? electrolitOk === true : null,
              especiales_aun: especialesAun }
            : c
    );

    const { error: segundaErr } = await updatePedidoSucursalStatus(pedidoId, sucId, {
        segunda_llegada_at: now,
        reenvios_historial: nuevoHistorial,
        falta_cajas: hasFalta ? cajasFaltantes : [],
        ...(electrolitCount > 0 ? { electrolit_ok: electrolitOk === true, electrolit_faltantes: electrolitOk ? 0 : electrolitCount } : {}),
    });
    if (segundaErr) throw segundaErr;

    const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId,
        'caja_map, pagina_items, cajas_especiales_llegadas, cajas_especiales');
    if (pssErr) throw pssErr;
    const cajaMapDb     = pss?.caja_map    ?? {};
    const paginaItemsDb = pss?.pagina_items ?? {};
    const getItemIds = (cajas) => {
        if (!Object.keys(paginaItemsDb).length) return [];
        return cajas.flatMap(n => (cajaMapDb[String(n)] ?? []).flatMap(p => paginaItemsDb[String(p)] ?? []));
    };

    // Las cajas que SÍ llegaron (OK o dañadas) dejan de bloquear sus renglones.
    const cajasLlegaron = [...cajasOk, ...cajasDanadas];
    if (cajasLlegaron.length > 0) {
        const llegadaIds = getItemIds(cajasLlegaron);
        if (llegadaIds.length > 0) {
            const { error } = await updatePedidoItemsFaltaCaja(llegadaIds, false);
            if (error) throw error;
        }
    }
    // Las que AÚN no llegaron los mantienen bloqueados.
    if (hasFalta) {
        const mIds = getItemIds(cajasFaltantes);
        if (mIds.length > 0) {
            const { error } = await updatePedidoItemsFaltaCaja(mIds, true);
            if (error) throw error;
        }
    }
    // El Electrolit, si llegó en este reenvío.
    if (electrolitCount > 0 && electrolitOk) {
        const faltaElec = await fetchPedidoItemsFaltaElectrolit(pedidoId, sucId);
        if (faltaElec === null) throw new Error('No se pudieron leer los renglones de Electrolit marcados como faltantes.');
        const elecIds = faltaElec.filter(r => (r.products?.nombre ?? '').toLowerCase().includes('electrolit')).map(r => r.id);
        if (elecIds.length > 0) {
            const { error } = await updatePedidoItemsFaltaCaja(elecIds, false);
            if (error) throw error;
        }
    }
    // Especiales: las que llegaron 'ok', las que no 'faltante'.
    const espLlegaron = (especialesList ?? []).filter(l => !especialesAun.includes(l));
    if (espLlegaron.length > 0 || especialesAun.length > 0) {
        const mergedEsp = { ...(pss?.cajas_especiales_llegadas ?? {}) };
        for (const label of espLlegaron)  mergedEsp[label] = 'ok';
        for (const label of especialesAun) mergedEsp[label] = 'faltante';
        const { error: mergedErr } = await updatePedidoSucursalStatus(pedidoId, sucId, { cajas_especiales_llegadas: mergedEsp });
        if (mergedErr) throw mergedErr;

        if (espLlegaron.length > 0) {
            const faltaEsp = await fetchPedidoItemsFaltaEspeciales(pedidoId, sucId);
            if (faltaEsp === null) throw new Error('No se pudieron leer los renglones de cajas especiales marcados como faltantes.');
            if (faltaEsp.length > 0) {
                // Si todas llegaron → todos. Si alguna aún falta → los de las
                // ETIQUETAS que llegaron, nunca los de una que sigue faltando
                // (la etiqueta → renglón sale de `cajas_especiales`).
                const marcar = (labels) => Object.fromEntries(labels.map(l => [l, 'faltante']));
                const { ids: idsLlegaron } = renglonesDeCajasFaltantes(pss?.cajas_especiales ?? [], marcar(espLlegaron));
                const { ids: idsAun }      = renglonesDeCajasFaltantes(pss?.cajas_especiales ?? [], marcar(especialesAun));
                const sigueFaltando = new Set(idsAun);
                const pendientes    = new Set(faltaEsp.map(r => r.id));
                const idsToClean = especialesAun.length === 0
                    ? faltaEsp.map(r => r.id)
                    : idsLlegaron.filter(id => pendientes.has(id) && !sigueFaltando.has(id));
                if (idsToClean.length > 0) {
                    const { error } = await updatePedidoItemsFaltaCaja(idsToClean, false);
                    if (error) throw error;
                }
            }
        }
    }
    return arrived_tipo;
}
