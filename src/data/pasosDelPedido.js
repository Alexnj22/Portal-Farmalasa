// ── Los pasos del pedido que eran varias escrituras, en una sola (2026-10-08) ──
//
// Finalizar una sala, pedir un reenvío, confirmar la llegada de un reenvío y
// programar la entrega se hacían desde `hooks/usePedidosData.js` en dos a siete
// escrituras seguidas. Un corte de red en el medio dejaba la sala a medias —
// finalizada sin cajas ni hojas, «llegó» con renglones todavía bloqueados— y
// los dos historiales jsonb se reescribían ENTEROS con lo que había leído la
// pantalla, así que dos pantallas abiertas se pisaban la entrada sin error.
//
// Cada paso es UNA función de la base, que bloquea la fila y lo hace todo en
// una transacción. Desde el 2026-10-09 es el ÚNICO camino: el rol del navegador
// ya no puede escribir esas columnas de `pedido_sucursal_status` ni nada de
// `pedido_items` (migración `columnas_del_navegador_fase_2`), así que el
// respaldo de pasos sueltos que había acá sólo podía dar «permission denied».
//
// Todas devuelven `{ data, error }`. Un rechazo `YA_…` —el segundo clic de un
// doble clic— NO vuelve como error: vuelve `data.yaEstaba = true`, porque lo
// que se pidió ya está hecho y quien llama sólo tiene que refrescar.
import { supabase } from '../supabaseClient';

// Los rechazos de negocio llegan como `CÓDIGO: texto` (`RAISE EXCEPTION
// 'YA_FINALIZADO: …'`). Devuelve el código, o null si no tiene esa forma.
export function codigoDeNegocio(error) {
    const m = /^([A-Z][A-Z_]+):/.exec(typeof error === 'string' ? error : (error?.message ?? ''));
    return m ? m[1] : null;
}

/** Llama a una función del pedido y devuelve `{ data, error }`; nunca lanza. */
export async function pasoDelPedido(nombre, params) {
    try {
        const res = await supabase.rpc(nombre, params);
        return { data: res?.data ?? null, error: res?.error ?? null };
    } catch (error) {
        return { data: null, error };
    }
}

function yaEstabaHecho(res, codigo) {
    if (res.error && codigoDeNegocio(res.error) === codigo) {
        return { data: { yaEstaba: true }, error: null };
    }
    return res;
}

// ── Finalizar la sala: qué sale + finalizado + cajas y hojas ────────────────
// El traslado al sistema NO va acá: sigue después y aparte, como siempre — su
// fallo no puede deshacer el finalizado.
export async function finalizarSalaConCajas({
    pedidoId, sucId, totalCajas, cajaMap, paginaItems,
    cajasElectrolit = 0, cajasEspeciales = [], ajustesEnvio = [],
}) {
    const res = await pasoDelPedido('finalizar_sala_con_cajas', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_total_cajas: totalCajas,
        p_caja_map: cajaMap ?? {}, p_pagina_items: paginaItems ?? {},
        p_cajas_electrolit: cajasElectrolit, p_cajas_especiales: cajasEspeciales,
        p_ajustes: ajustesEnvio,
    });
    return yaEstabaHecho(res, 'YA_FINALIZADO');
}

// ── Programar la entrega: la entrada se AGREGA al historial en la base ──────
// Devuelve el historial final.
export function programarEntregaSala({ pedidoId, sucId, cuando, motivo = null }) {
    return pasoDelPedido('programar_entrega_sala', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_cuando: cuando, p_motivo: motivo,
    });
}

// ── Pedir un reenvío: el ciclo lo numera la base ────────────────────────────
// `especiales` acepta etiquetas o `{ label, producto }`; el ciclo guarda sólo
// la etiqueta. Devuelve `{ ciclo, clave }` (clave = `pedido__suc__rN`, la que
// usa «Nueva ruta» para marcar el reenvío). El ciclo nace PENDIENTE: la base le
// pone `sent_at` y avisa cuando sale la ruta que lo lleva.
export function pedirReenvioSala({ pedidoId, sucId, cajas = [], especiales = [], electrolits = 0 }) {
    const etiquetas = especiales.map(e => (typeof e === 'string' ? e : e.label));
    return pasoDelPedido('pedir_reenvio_sala', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_cajas: cajas,
        p_especiales: etiquetas, p_electrolits: electrolits,
    });
}

// ── La llegada de un reenvío ────────────────────────────────────────────────
// `especialesAun`: etiquetas que SIGUEN faltando. `electrolitOk`: el modal es
// todo-o-nada; a la base va como «cuántas faltan» (0 = llegó).
export async function confirmarLlegadaDeReenvio({
    pedidoId, sucId, ciclo,
    cajasOk = [], cajasDanadas = [], cajasFaltantes = [], nota = '',
    electrolitOk = true, electrolitCount = 0, especialesAun = [],
}) {
    const res = await pasoDelPedido('confirmar_llegada_reenvio', {
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_ciclo: ciclo,
        p_cajas_ok: cajasOk, p_cajas_danadas: cajasDanadas, p_cajas_faltan: cajasFaltantes,
        p_especiales: especialesAun,
        p_electrolit_faltan: electrolitCount > 0 && !electrolitOk ? electrolitCount : 0,
        p_nota: nota || null,
    });
    return yaEstabaHecho(res, 'YA_CONFIRMADO');
}
