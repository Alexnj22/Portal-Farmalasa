import { supabase } from '../supabaseClient';
import { solicitudDeAjuste, OPERACIONES_AJUSTE } from '../utils/ajusteInventario';
import { ERP_UBICACION_POR_SUCURSAL } from '../constants/erp';
import { insertMovimientoInventario } from './inventoryMovements';

/**
 * Consultas de existencia (Conteo de inventario → Consultas, 2026-10-29).
 *
 * Alguien le pregunta a una o varias salas «¿cuánto tenés de este producto?».
 * La sala cuenta SIN ver el sistema, por presentación (y por lote si el
 * producto es regulado). La base compara en unidades contra la existencia viva:
 * si no cuadra pide UN reconteo sin decir hacia dónde; si el reconteo tampoco
 * cuadra queda DESCUADRE, y lo ajusta sólo quien aprueba inventario. El
 * resumen de cada consulta le llega a Talento Humano y a Supervisión.
 *
 * Todo pasa por funciones de la base (`consulta_existencia_*`): ni el número
 * del sistema ni la diferencia viajan al navegador mientras la sala cuenta.
 */

// Los códigos que lanzan las funciones, dichos para quien está en sala.
const MENSAJES = {
    SIN_PERMISO:            'No tienes permiso para esto.',
    SIN_SALAS:              'Elige al menos una sala.',
    PRODUCTO_NO_ENCONTRADO: 'No se encontró el producto.',
    YA_PEDIDA:              'Esas salas ya tienen este producto pendiente de contar.',
    NO_ENCONTRADA:          'La consulta ya no existe.',
    FUERA_DE_ALCANCE:       'Esta consulta es de otra sala.',
    YA_CONTADA:             'Esta consulta ya se contó.',
    CONTEO_INVALIDO:        'Revisa el conteo: cantidades enteras y, si lleva lote, el número de lote.',
    SIN_DESCUADRE:          'Esta sala ya no tiene un descuadre pendiente.',
    NOTA_REQUERIDA:         'Escribe por qué no se ajusta.',
    SIN_SOLICITUD:          'No se creó ninguna solicitud de ajuste.',
};

function conMensaje(error) {
    if (!error) return null;
    const codigo = Object.keys(MENSAJES).find(k => String(error.message ?? '').includes(k));
    return codigo ? { ...error, message: MENSAJES[codigo], codigo } : error;
}

export async function fetchConsultasExistencia() {
    const { data, error } = await supabase.rpc('consultas_existencia_lista');
    return { data: Array.isArray(data) ? data : [], error: conMensaje(error) };
}

/** Las salas con inventario (son siete: no hace falta paginar). */
export async function fetchSalasConInventario() {
    const { data, error } = await supabase.from('erp_sucursal_map')
        .select('erp_sucursal_id, branch_id, nombre, es_bodega')
        .order('es_bodega').order('nombre');
    return { data: data ?? [], error };
}

/** `salas`: los `erp_sucursal_id` a los que se pregunta. */
export async function crearConsultaExistencia({ producto, salas, motivo = null, origen = 'manual' }) {
    const { data, error } = await supabase.rpc('consulta_existencia_crear', {
        p_producto: producto, p_salas: salas, p_motivo: motivo, p_origen: origen,
    });
    return { data, error: conMensaje(error) };
}

/** El producto, sus presentaciones y —si es regulado— sus lotes. Sin cantidades. */
export async function fetchParaContar(id) {
    const { data, error } = await supabase.rpc('consulta_existencia_para_contar', { p_id: id });
    return { data, error: conMensaje(error) };
}

/** `conteo`: [{ tipo, factor, cantidad, lote?, vence? }]. */
export async function contarExistencia(id, conteo) {
    const { data, error } = await supabase.rpc('consulta_existencia_contar', { p_id: id, p_conteo: conteo });
    return { data, error: conMensaje(error) };
}

/** Las líneas del ajuste, recalculadas contra la existencia de ahora. */
export async function fetchAjusteDeConsulta(id) {
    const { data, error } = await supabase.rpc('consulta_existencia_ajuste', { p_id: id });
    return { data, error: conMensaje(error) };
}

export async function resolverConsulta(id, { estado, solicitudes = [], nota = null }) {
    const { error } = await supabase.rpc('consulta_existencia_resolver', {
        p_id: id, p_estado: estado, p_solicitudes: solicitudes, p_nota: nota,
    });
    return { error: conMensaje(error) };
}

/** «faltan 1 caja y 2 blister» / «sobran 3 blister» / «cuadra». */
export function textoDeDiferencia(sala) {
    if (sala?.diferencia == null) return null;
    if (sala.diferencia === 0) return 'cuadra';
    return `${sala.diferencia < 0 ? 'faltan' : 'sobran'} ${sala.texto ?? Math.abs(sala.diferencia)}`;
}

/**
 * Crea las solicitudes que corrigen un descuadre: una CARGA con lo que sobra
 * en el estante y un DESCARTE con lo que falta. En un regulado puede haber las
 * dos (un lote de más y otro de menos). Devuelve los ids, en el orden creado.
 */
export async function pedirAjusteDeConsulta({ consulta, sala, ajuste, usuarioId, aprobador }) {
    const ids = [];
    for (const sentido of ['carga', 'descarte']) {
        const lineas = (ajuste?.lineas ?? []).filter(l => l.sentido === sentido);
        if (!lineas.length) continue;
        const carga = sentido === 'carga';
        const op = OPERACIONES_AJUSTE.find(o => o.key === (carga ? 'CARGA' : 'DESCARTE'));
        const causa = `Consulta de existencia: la sala contó ${ajuste.contado} unidades y el sistema decía `
            + `${ajuste.sistema} (${textoDeDiferencia(sala)}). Se contó dos veces.`;
        const payload = solicitudDeAjuste({
            op,
            motivo: carga ? undefined : 'DESCUADRE',
            causa,
            lineas: lineas.map(l => ({
                erp_product_id: consulta.erp_product_id,
                descripcion:    consulta.nombre,
                tipo:           l.tipo,
                factor:         l.factor,
                cantidad:       l.cantidad,
                lote:           l.lote,
                vence:          l.vence,
                existencia:     l.existencia,
            })),
            usuarioId,
            aprobador,
            sala: {
                branchId:       sala.branch_id,
                nombre:         sala.sala,
                erpSucursalId:  sala.erp_sucursal_id,
                erpUbicacionId: ERP_UBICACION_POR_SUCURSAL[sala.erp_sucursal_id] ?? null,
            },
        });
        const id = crypto.randomUUID();
        payload.id = id;
        payload.metadata.consulta_existencia = { consulta_id: consulta.id, sala_id: sala.id, sentido };
        const { error } = await insertMovimientoInventario(payload, { lineas: lineas.length, consulta_existencia: true, sentido });
        if (error) return { ids, error };
        ids.push(id);
    }
    return { ids, error: null };
}
