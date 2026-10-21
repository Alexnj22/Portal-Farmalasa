/**
 * Seguro de vida colectivo — la póliza de la empresa y el pago de cada año.
 *
 * El certificado de cada asegurado NO vive acá: es un documento del expediente
 * (`CERTIFICADO_SEGURO_VIDA`). Acá está lo que es de todos a la vez: la póliza
 * (el documento general, el mismo cada año) y cada pago con el listado de las
 * personas que la aseguradora cubrió. De ese listado sale quién está solvente.
 *
 * Tablas: `seguro_vida_poliza` (una fila), `seguro_vida_pagos` (una por año),
 * `seguro_vida_cubiertos`. El pago se escribe por `registrar_pago_seguro_vida`
 * para que el pago y su listado entren juntos o no entren.
 */
import { supabase } from '../supabaseClient';
import { subirArchivo } from '../utils/storageFiles';

/** Carpeta del bucket `documents`. Cae en la policy general de personal. */
const CARPETA = 'seguro-vida';

/** La póliza vigente (o `null` si todavía no hay fila). */
export async function fetchPoliza() {
    const { data, error } = await supabase.from('seguro_vida_poliza')
        .select('*').limit(1).maybeSingle();
    if (error) throw error;
    return data;
}

/** Los pagos, del más nuevo al más viejo, cada uno con su listado. */
export async function fetchPagos() {
    const { data, error } = await supabase.from('seguro_vida_pagos')
        .select('*, cubiertos:seguro_vida_cubiertos(id, employee_id, nombre_en_documento)')
        .order('anio', { ascending: false });
    if (error) throw error;
    return data || [];
}

/**
 * El pago de un año con su listado — lo que necesita la ficha de una persona
 * para decir si está solvente.
 * @param {number} anio
 */
export async function fetchPagoDelAnio(anio) {
    const { data, error } = await supabase.from('seguro_vida_pagos')
        .select('anio, cubiertos:seguro_vida_cubiertos(employee_id)')
        .eq('anio', anio).maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Guarda los datos de la póliza. `id` sale de la fila que ya existe: la tabla
 * admite una sola.
 * @param {object} poliza
 */
export async function guardarPoliza(poliza) {
    const fila = {
        aseguradora: poliza.aseguradora?.trim() || 'MAPFRE',
        numero_poliza: poliza.numero_poliza?.trim() || null,
        suma_asegurada: Number(poliza.suma_asegurada),
        tasa_por_millar: Number(poliza.tasa_por_millar),
        prima_por_persona: poliza.prima_por_persona === '' || poliza.prima_por_persona == null
            ? null : Number(poliza.prima_por_persona),
        documento_url: poliza.documento_url || null,
        documento_nombre: poliza.documento_nombre || null,
        notas: poliza.notas?.trim() || null,
        updated_at: new Date().toISOString(),
    };
    const q = poliza.id
        ? supabase.from('seguro_vida_poliza').update(fila).eq('id', poliza.id).select().maybeSingle()
        : supabase.from('seguro_vida_poliza').insert(fila).select().maybeSingle();
    const { data, error } = await q;
    if (error) throw error;
    // Sin policy que lo deje, el update devuelve CERO filas sin error.
    if (!data) throw new Error('No se guardó la póliza: hace falta permiso de edición en Personal.');
    return data;
}

/**
 * Sube un archivo del seguro (la póliza o el listado de un pago) y devuelve la
 * URL formato-public que se guarda.
 * El `File` del navegador, o el «archivo de la app» del teléfono
 * (`{ name, body: ArrayBuffer, contentType }`): el teléfono no tiene `File`.
 * @param {File|{name: string, body: ArrayBuffer, contentType?: string}} archivo
 * @param {string} sub  'poliza' | `pago-<año>`
 */
export async function subirArchivoDelSeguro(archivo, sub) {
    const limpio = String(archivo?.name || 'archivo').replace(/[^\w.-]+/g, '_');
    const ruta = `${CARPETA}/${sub}/${Date.now()}_${limpio}`;
    if (archivo && 'body' in archivo) return subirArchivo('documents', ruta, archivo.body, { contentType: archivo.contentType });
    return subirArchivo('documents', ruta, /** @type {File} */ (archivo));
}

/**
 * Registra (o corrige) el pago de un año con su listado.
 * @param {{ anio: number, fecha_pago?: string|null, monto_total?: number|null,
 *           prima_por_persona?: number|null, comprobante_url?: string|null,
 *           comprobante_nombre?: string|null, notas?: string|null,
 *           cubiertos: {employee_id: string|null, nombre: string}[] }} pago
 */
export async function registrarPago(pago) {
    const { data, error } = await supabase.rpc('registrar_pago_seguro_vida', {
        p_anio: pago.anio,
        p_fecha_pago: pago.fecha_pago || null,
        p_monto_total: pago.monto_total ?? null,
        p_prima_por_persona: pago.prima_por_persona ?? null,
        p_comprobante_url: pago.comprobante_url || null,
        p_comprobante_nombre: pago.comprobante_nombre || null,
        p_cubiertos: pago.cubiertos || [],
        p_notas: pago.notas || null,
    });
    if (error) throw error;
    return data;
}
