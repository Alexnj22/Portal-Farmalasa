import { supabase } from '../supabaseClient';
import { solicitudDeAjuste, OPERACIONES_AJUSTE } from '../utils/ajusteInventario';
import { ERP_UBICACION_POR_SUCURSAL } from '../constants/erp';
import { insertMovimientoInventario } from './inventoryMovements';

/**
 * Revisión de factor (Productos → Revisión de factor, 2026-10-15).
 *
 * Tres listas en una llamada (`revision_de_presentaciones`):
 *   cambios      qué producto cambió de presentación y qué se convirtió solo
 *                (ventas, MIN·MAX) — ver `procesar_cambios_de_factor`;
 *   existencias  la existencia que la caja dejó en la unidad vieja, lote por
 *                lote, con lo que quedaría y lo que hay que descartar;
 *   sospechosos  productos cuyo factor no cuadra con su texto, su existencia o
 *                sus ventas recientes.
 */
export async function fetchRevisionDePresentaciones() {
    const { data, error } = await supabase.rpc('revision_de_presentaciones');
    if (error) return { data: null, error };
    return { data: data ?? { cambios: [], existencias: [], sospechosos: [] }, error: null };
}

/**
 * La causa que queda escrita en el movimiento de la caja. Dice el porqué y el
 * de→a con los números de ESTE lote, para que quien lo lea en el kardex dentro
 * de un año entienda qué pasó sin abrir el portal.
 */
export function causaDeCorreccion(f) {
    return `Corrección por cambio de presentación: antes 1 ${f.presentacion} = ${f.de}, `
        + `ahora 1 ${f.presentacion} = ${f.a}. La existencia quedó contada en la unidad vieja: `
        + `mostraba ${f.muestra}, son ${f.quedan}. Se descartan ${f.descartar}`
        + (f.lote ? ` del lote ${f.lote}` : '') + '.';
}

/**
 * Crea la solicitud de descarte que corrige UN lote. Es la misma solicitud de
 * inventario de siempre —la valida la base y la aplica
 * `aplicar-movimiento-inventario`—, con `correccion_de_factor` en la metadata
 * para que la revisión sepa que este lote ya tiene su corrección pedida.
 *
 * `id` lo pone quien llama: el alta no devuelve la fila y hace falta para
 * aplicarla enseguida.
 */
export function pedirCorreccionDeExistencia({ id, fila, usuarioId, aprobador }) {
    const op = OPERACIONES_AJUSTE.find(o => o.key === 'DESCARTE');
    const payload = solicitudDeAjuste({
        op,
        motivo: 'DESCUADRE',
        causa: causaDeCorreccion(fila),
        lineas: [{
            erp_product_id: fila.erp_product_id,
            descripcion:    fila.nombre,
            tipo:           fila.presentacion,
            factor:         fila.a,
            cantidad:       fila.descartar,
            lote:           fila.lote,
            vence:          fila.vence,
            existencia:     fila.muestra,
        }],
        usuarioId,
        aprobador,
        sala: {
            branchId:       fila.branch_id,
            nombre:         fila.sala,
            erpSucursalId:  fila.erp_sucursal_id,
            erpUbicacionId: ERP_UBICACION_POR_SUCURSAL[fila.erp_sucursal_id] ?? null,
        },
    });
    payload.id = id;
    payload.metadata.correccion_de_factor = {
        cambio_id: fila.cambio_id,
        de: fila.de, a: fila.a,
        muestra: fila.muestra, quedan: fila.quedan, sueltas: fila.sueltas,
    };
    return insertMovimientoInventario(payload, { lineas: 1, correccion_de_factor: true });
}
