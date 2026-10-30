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
    // La función devuelve `json`: para los tipos es un `Json` sin forma.
    /** @type {{ cambios: any[], existencias: any[], sospechosos: any[] }} */
    const datos = /** @type {any} */ (data) ?? { cambios: [], existencias: [], sospechosos: [] };
    // La presentación que CAMBIÓ vive en el cambio, no en la fila: la fila
    // lleva la de la existencia (en X-Ray Dol, el blíster nuevo; cambió la caja).
    const tipoDelCambio = new Map((datos.cambios ?? []).map(c => [c.id, c.resultado?.presentacion]));
    datos.existencias = (datos.existencias ?? []).map(f => ({
        ...f, tipo_cambio: tipoDelCambio.get(f.cambio_id) ?? f.presentacion,
    }));
    return { data: datos, error: null };
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
 * Dónde entra la carga. Si la caja creó una presentación de 1 junto con el
 * cambio (X-Ray Dol: CAJA 1→4 y un BLISTER 1 nuevo), la carga va ahí y
 * cuadra exacto —1 caja que quedó como 1 blíster se arregla con 3 blísteres—;
 * si no, se carga la presentación que cambió. Lo decide la base.
 */
export const presentacionDeCarga = (f) => ({
    tipo:   f?.carga_tipo ?? f?.presentacion,
    factor: f?.carga_factor ?? f?.a,
});

/**
 * La causa que queda escrita en el movimiento de la caja. Dice el porqué y el
 * de→a con los números de ESTE lote, para que quien lo lea en el kardex dentro
 * de un año entienda qué pasó sin abrir el portal.
 */
export function causaDeCorreccion(f) {
    const tipo = f.tipo_cambio ?? f.presentacion;
    const cambio = `Corrección por cambio de presentación: antes 1 ${tipo} = ${f.de}, `
        + `ahora 1 ${tipo} = ${f.a}. La existencia quedó contada en la unidad vieja: `;
    const lote = f.lote ? ` del lote ${f.lote}` : '';
    const cambiada = String(f.tipo_cambio ?? f.presentacion).toLowerCase();
    return esCarga(f)
        ? cambio + `había ${f.muestra} ${cambiada} y quedaron como ${f.muestra} `
            + `${presentacionDeCarga(f).factor === 1 ? String(presentacionDeCarga(f).tipo).toLowerCase() : 'unidades sueltas'}. `
            + `Se cargan ${f.cargar} ${String(presentacionDeCarga(f).tipo).toLowerCase()}${lote}.`
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
export function pedirCorreccionDeExistencia({ id, fila, usuarioId, aprobador, vence = null }) {
    const carga = esCarga(fila);
    const op = OPERACIONES_AJUSTE.find(o => o.key === (carga ? 'CARGA' : 'DESCARTE'));
    const payload = solicitudDeAjuste({
        op,
        motivo: carga ? undefined : 'DESCUADRE',
        causa: causaDeCorreccion(fila),
        lineas: [{
            erp_product_id: fila.erp_product_id,
            descripcion:    fila.nombre,
            tipo:           carga ? presentacionDeCarga(fila).tipo : fila.presentacion,
            factor:         carga ? presentacionDeCarga(fila).factor : fila.a,
            cantidad:       carga ? fila.cargar : fila.descartar,
            lote:           fila.lote,
            // La foto no trae fecha cuando la caja no la tenía; la pone quien
            // corrige (o sale del conteo de la sala). Sin ella, la caja rechaza
            // la carga de un perecedero.
            vence:          fila.vence ?? vence,
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

/**
 * Una corrección que la caja rechazó por falta de fecha de vencimiento queda
 * pendiente: esto le pone la fecha (sólo eso) para volver a aplicarla.
 */
export async function ponerVenceACorreccion(id, vence) {
    const { error } = await supabase.rpc('correccion_de_factor_poner_vence', { p_id: id, p_vence: vence });
    return { error };
}

/**
 * ¿La carga necesita una fecha que la foto no trae? Sólo una carga de un
 * perecedero: un descarte sale de un lote que ya existe.
 */
export const necesitaVence = (f) => esCarga(f) && !!f?.perecedero && !f?.vence;

/**
 * Lo que la corrección mueve, en unidades: lo que se carga (en la presentación
 * de carga) o, en negativo, lo que se descarta.
 */
export const unidadesDeLaCorreccion = (f) => (esCarga(f)
    ? (f?.cargar ?? 0) * (presentacionDeCarga(f).factor || 1)
    : -(f?.descartar ?? 0));

/**
 * Lo que la sala contó de más (+) o de menos (−) DESPUÉS de la corrección: la
 * parte de la diferencia que no viene del cambio de tamaño. Sin conteo, o con
 * un conteo que cuadra con lo de hoy (no hay que corregir), 0.
 */
export function restoDelConteo(f, conteo) {
    const d = conteo?.diferencia;
    if (d == null || d === 0 || !['CUADRA', 'DESCUADRE'].includes(conteo?.estado)) return 0;
    return d - unidadesDeLaCorreccion(f);
}

/** Unidades en las presentaciones del cambio: «1 caja», «1 caja y 2 blister». */
export function restoEnPresentaciones(f, unidades) {
    const u = Math.abs(unidades);
    const grande = String(f?.tipo_cambio ?? f?.presentacion ?? '').toLowerCase();
    const factor = esCarga(f) ? Number(f?.a) || 1 : 1;
    if (factor <= 1) return `${u} ${grande}`;
    const chica = String(presentacionDeCarga(f).tipo ?? 'unidades').toLowerCase();
    const enteras = Math.floor(u / factor);
    const sueltas = u % factor;
    return [enteras ? `${enteras} ${grande}` : '', sueltas ? `${sueltas} ${chica}` : '']
        .filter(Boolean).join(' y ');
}

/**
 * La nota con que se aplica la corrección. Le llega a la jefatura de la sala en
 * el aviso de «Carga aplicada», así que si la sala contó algo que la corrección
 * no cubre lo dice ahí, con qué tiene que pedir (usuario, 2026-10-30).
 */
export function notaDeCorreccion(f, conteo) {
    const base = 'Corrección por cambio de presentación.';
    const resto = restoDelConteo(f, conteo);
    if (!resto) return base;
    const txt = restoEnPresentaciones(f, resto);
    return resto > 0
        ? `${base} No se ajustó ${txt} que contaron de más: si lo tienen, pidan la carga y expliquen de dónde salió.`
        : `${base} No se descontó ${txt} que faltó en el conteo: si no está, pidan el descarte y expliquen por qué.`;
}
