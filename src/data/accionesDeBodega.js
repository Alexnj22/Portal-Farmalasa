// Lo que Bodega hace sobre la sala de un pedido una vez preparado — finalizar
// con sus cajas, reenviar lo que no llegó, reintentar el ingreso al inventario
// y la conversación de las diferencias y sus devoluciones.
//
// Vivía dentro de `usePedidosData` (portal), mezclado con avisos y estado de
// pantalla. Sale al núcleo para que la app del teléfono haga exactamente lo
// mismo; los pasos que eran varias escrituras ahora son UNA función de la base
// (`data/pasosDelPedido`) y acá se llaman ésas. Quien llama pone el aviso
// y la bitácora; estas funciones lanzan si la parte principal falla y
// devuelven lo que pasó con la parte que puede fallar sola.
import {
    avanzarEtapaDePedidoEnSala, crearRuta, despacharTrasladoPedido, fetchItemsSinIngresar,
    recibirTrasladoPedido, updateRutaStatus,
} from './pedidos';
import { finalizarSalaConCajas, pedirReenvioSala } from './pasosDelPedido';
import { decidirDiferencia } from './diferencias';
import { mensajeAmigable } from '../utils/errorMessages';
import { decidirDevolucion, moverDevoluciones } from './devoluciones';
import { cajasDeRenglon, construirCajasEspeciales, renglonesQueSalen } from '../utils/cajasEspeciales';

const sinError = ({ error } = {}) => { if (error) throw error; };

/**
 * Finalizar: qué sale, el finalizado y las cajas y hojas en UNA transacción de
 * la base (`finalizar_sala_con_cajas`, `data/pasosDelPedido`), y recién al
 * final, aparte, el traslado al sistema. Desde el 2026-10-09 el navegador ya no
 * puede escribir esas columnas: los pasos sueltos sólo darían «permission
 * denied».
 *
 * @returns {{ yaEstaba?: true, cajasElectrolit, cajasEspeciales, despacho: { ok, error } | null }}
 *   `yaEstaba`: el segundo clic de un doble clic — ya estaba finalizado y NO se
 *   despacha otra vez. `despacho` es la parte que puede fallar SOLA: si falla,
 *   el pedido igual quedó finalizado y se reintenta desde el pedido.
 */
export async function finalizarPedidoConCajas({ pedidoId, sucId, rows = [], totalCajas, cajaMap, paginaItems, ajustesEnvio = [] }) {
    // Las cuentas de cajas salen de lo que de verdad SALE, no de lo asignado.
    const rowsQueSalen = renglonesQueSalen(rows, ajustesEnvio);
    const cajasElectrolit = rowsQueSalen
        .filter(r => (r.products?.nombre ?? '').toLowerCase().includes('electrolit')
            && (r.dispatch_tipo ?? '').toUpperCase() === 'CAJA')
        .reduce((sum, r) => sum + cajasDeRenglon(r), 0);
    const cajasEspeciales = construirCajasEspeciales(rowsQueSalen);

    const { data: fin, error } = await finalizarSalaConCajas({
        pedidoId, sucId, totalCajas, cajaMap, paginaItems, cajasElectrolit, cajasEspeciales, ajustesEnvio,
    });
    if (error) throw error;
    if (fin?.yaEstaba) return { yaEstaba: true, cajasElectrolit, cajasEspeciales, despacho: null };

    // Y recién ahora sale del sistema. En su PROPIO try: un tropiezo acá no
    // puede decir «no se pudo finalizar» sobre un pedido ya finalizado.
    let despacho;
    try {
        const r = await despacharTrasladoPedido(pedidoId, sucId);
        despacho = { ok: !!r?.ok, error: r?.ok ? null : (r?.error ?? null) };
    } catch (e) {
        despacho = { ok: false, error: e?.message ?? null };
    }
    return { cajasElectrolit, cajasEspeciales, despacho };
}

/**
 * Reenviar lo que no llegó: un ciclo nuevo, numerado y agregado por la base
 * (`pedir_reenvio_sala`). El ciclo nace PENDIENTE y la base avisa a la sala
 * cuando sale la ruta que lo lleva.
 *
 * @returns {{ ciclo, clave, especialesLabels }}
 */
export async function registrarReenvio({ pedidoId, sucId, cajas = [], electrolits = 0, especiales = [] }) {
    const especialesLabels = especiales.map(e => (typeof e === 'string' ? e : e.label));
    const { data, error } = await pedirReenvioSala({ pedidoId, sucId, cajas, especiales, electrolits });
    if (error) throw error;
    return { ciclo: data?.ciclo ?? null, clave: data?.clave ?? null, especialesLabels };
}

/**
 * Volver a ingresar al inventario lo que la sala ya contó y no entró. La lista
 * sale del SERVIDOR; sin ella entraría lo que nadie contó.
 *
 * @returns {{ nada: true } | { pedidos, entraron, completo }}
 */
export async function reintentarIngreso({ pedidoId, sucId }) {
    const { itemIds, error } = await fetchItemsSinIngresar(pedidoId, sucId);
    if (error) throw error;
    if (!itemIds.length) return { nada: true };
    const erp = await recibirTrasladoPedido(pedidoId, sucId, { itemIds });
    if (!erp.ok && erp.codigo !== 'NADA_QUE_RECIBIR') throw new Error(mensajeAmigable(erp.error, 'No se pudo ingresar.'));
    return { pedidos: itemIds.length, entraron: erp.recibidas ?? 0, completo: erp.completo ?? null };
}

/** Un paso del cierre de las diferencias de una sala. */
export async function pasoDeDiferencias({ pedidoId, sucId, userId = null, paso, nota = null }) {
    sinError(await avanzarEtapaDePedidoEnSala({
        p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: paso, p_user_id: userId,
        ...(paso === 'corregir_bodega' ? { p_nota: nota || null } : {}),
    }));
}

/**
 * Un turno de la decisión de una diferencia. Si el acuerdo cae en una salida
 * que se arregla en el sistema, la base deja la devolución aceptada y acá se
 * MUEVE; el fallo del movimiento no borra el acuerdo.
 *
 * @returns {{ data, movimiento: null | { ok, aLaSala, error } }}
 */
export async function decidirDiferenciaYMover({ itemId, accion, tipo = null, nota = null, evidencia = [] }) {
    const { data, error } = await decidirDiferencia({ itemId, accion, tipo, nota, evidencia });
    if (error) throw error;
    let movimiento = null;
    if (data?.devolucion_id) {
        const aLaSala = data?.mueve === 'traslado_a_sala';
        const r = await moverDevoluciones([data.devolucion_id], { simulacro: false });
        movimiento = { ok: !!r.ok, aLaSala, error: r.ok ? null : (r.fallos?.[0]?.error ?? r.error ?? null) };
    }
    return { data, movimiento };
}

/** Aceptar (y mover) o rechazar una devolución del circuito anterior. */
export async function decidirDevolucionYMover(id, accion, nota = null) {
    const { error } = await decidirDevolucion(id, accion, nota);
    if (error) throw error;
    if (accion !== 'aceptar') return { movimiento: null };
    const r = await moverDevoluciones([id], { simulacro: false });
    return { movimiento: { ok: !!r.ok, error: r.ok ? null : (r.fallos?.[0]?.error ?? r.error ?? null) } };
}

/**
 * Crear la ruta y sacarla de una vez (la ruta sale en cuanto se crea, como en
 * el portal). El `error` de la salida decide si la ruta salió: si falla, queda
 * en «pendiente» y se arranca desde Rutas.
 */
export async function crearRutaYSalir({ conductorId, conductorNombre, paradas, visitas = [], distanciaM = null, duracionMin = null, creadoPor = null }) {
    const { data: rutaId, error } = await crearRuta({
        p_conductor_id: conductorId, p_conductor_nombre: conductorNombre, p_paradas: paradas,
        p_distancia_total_m: distanciaM || null, p_duracion_min: duracionMin || null, p_creado_por: creadoPor,
    });
    if (error) throw error;
    sinError(await updateRutaStatus(rutaId, {
        status: 'en_ruta', salida_at: new Date().toISOString(), ...(visitas.length ? { visitas } : {}),
    }));
    return rutaId;
}
