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
 * Los dos sentidos de un cambio que deja la existencia en la unidad vieja
 * (`existencia_por_corregir`, 2026-10-29):
 *
 *   achica  CAJA 1x16 → 1x1: había 1 caja y la caja muestra 16. Se descartan 15.
 *   crece   CAJA 1x1 → 1x24: había 1 caja y la caja la cuenta como 1 tableta
 *           (0 cajas). Se carga 1 caja; queda 1 tableta suelta de más, porque
 *           sin una presentación de 1 no hay cómo sacarla.
 */
export const esCarga = (f) => f?.sentido === 'crece';

/**
 * La causa que queda escrita en el movimiento de la caja. Dice el porqué y el
 * de→a con los números de ESTE lote, para que quien lo lea en el kardex dentro
 * de un año entienda qué pasó sin abrir el portal.
 */
export function causaDeCorreccion(f) {
    const cambio = `Corrección por cambio de presentación: antes 1 ${f.presentacion} = ${f.de}, `
        + `ahora 1 ${f.presentacion} = ${f.a}. La existencia quedó contada en la unidad vieja: `;
    const lote = f.lote ? ` del lote ${f.lote}` : '';
    return esCarga(f)
        ? cambio + `había ${f.muestra} ${f.presentacion.toLowerCase()} y quedaron como ${f.muestra} `
            + `unidades sueltas. Se cargan ${f.cargar}${lote}.`
        : cambio + `mostraba ${f.muestra}, son ${f.quedan}. Se descartan ${f.descartar}${lote}.`;
}

/**
 * Crea la solicitud que corrige UN lote: un descarte si la presentación se
 * achicó, una carga si creció. Es la misma solicitud de inventario de siempre
 * —la valida la base y la aplica `aplicar-movimiento-inventario`—, con
 * `correccion_de_factor` en la metadata para que la revisión sepa que este
 * lote ya tiene su corrección pedida.
 *
 * `id` lo pone quien llama: el alta no devuelve la fila y hace falta para
 * aplicarla enseguida.
 */
export function pedirCorreccionDeExistencia({ id, fila, usuarioId, aprobador }) {
    const carga = esCarga(fila);
    const op = OPERACIONES_AJUSTE.find(o => o.key === (carga ? 'CARGA' : 'DESCARTE'));
    const payload = solicitudDeAjuste({
        op,
        motivo: carga ? undefined : 'DESCUADRE',
        causa: causaDeCorreccion(fila),
        lineas: [{
            erp_product_id: fila.erp_product_id,
            descripcion:    fila.nombre,
            tipo:           fila.presentacion,
            factor:         fila.a,
            cantidad:       carga ? fila.cargar : fila.descartar,
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
        sentido: fila.sentido,
        de: fila.de, a: fila.a,
        muestra: fila.muestra, quedan: fila.quedan, sueltas: fila.sueltas,
        // H28: la corrección es de ESTE lote; la revisión la busca por lote.
        lote: fila.lote ?? null,
    };
    return insertMovimientoInventario(payload, { lineas: 1, correccion_de_factor: true, sentido: fila.sentido });
}

// ── Lo que se le dice a quien revisa (los textos de la web y de la app) ─────

const QUE_DICE = {
    texto:      (s) => `El texto de la presentación dice ${s.dice} y el factor ${s.catalogo}.`,
    existencia: (s) => `La existencia dice ${s.dice} por ${String(s.presentacion ?? '').toLowerCase()} y el catálogo ${s.catalogo}.`,
    venta:      (s) => `${s.filas} ventas de los últimos 30 días entraron con ${s.dice} por ${String(s.presentacion ?? '').toLowerCase()} y el catálogo dice ${s.catalogo}.`,
};

/** Por qué un factor no cuadra, en una frase. */
export const textoDelSospechoso = (s) => (QUE_DICE[s?.tipo] ?? QUE_DICE.texto)(s);

/** El MIN·MAX que se convirtió solo en un cambio: «Salud 1 4·9 → 1·3, …». */
export const minmaxDelCambio = (resultado) => (Array.isArray(resultado?.minmax) ? resultado.minmax : [])
    .map(m => `${m.sala} ${m.antes?.[0] ?? '—'}·${m.antes?.[1] ?? '—'} → ${m.ahora?.[0] ?? '—'}·${m.ahora?.[1] ?? '—'}`)
    .join(', ');
