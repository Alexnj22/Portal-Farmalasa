// Facturas de mi Sala — capa de datos.
//
// Todo pasa por RPC SECURITY DEFINER: `purchase_dte_documents` está cerrada al
// personal de sala (su RLS pide el módulo de contabilidad), así que el navegador
// no puede leerla de forma directa ni aunque quiera. El permiso y el alcance los
// comprueba la base, no esta capa.
import { supabase } from '../supabaseClient';

/**
 * Los documentos que le corresponden a una sala.
 *
 * Es una LISTA, no el resultado de una búsqueda a ciegas. El filtro de fecha y
 * monto del widget acota esto en memoria; nunca es la única forma de llegar a
 * una fila. El motivo: con un buscador por monto ±$X, "no hay resultados" y "el
 * monto que recordás está mal" se ven idénticos, y la sala concluye que la
 * factura nunca llegó. Con la lista delante, vacío significa vacío.
 *
 * `incluirTomadas` trae también las de otras salas, en gris. Responde
 * «¿por qué no me aparece la mía?» sin que nadie tenga que llamar por teléfono.
 */
export async function fetchFacturasSala(branchId, { dias = 45, incluirTomadas = false } = {}) {
    // La guarda vive acá y no en el widget, igual que en `contarFacturasSala`:
    // allá era una escritura de estado SINCRÓNICA dentro del efecto que llama
    // —render en cascada, y el lint lo marca—. Devolviendo desde una función
    // async, quien la espera escribe después del tick.
    if (!branchId) return { filas: [], error: null };
    const { data, error } = await supabase.rpc('get_facturas_sala', {
        p_branch_id: Number(branchId),
        p_dias: dias,
        p_incluir_tomadas: incluirTomadas,
    });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}

/** El número de la baldosa: cuántas esperan que esta sala las tome. */
export async function contarFacturasSala(branchId, dias = 45) {
    if (!branchId) return { total: 0, error: null };
    const { data, error } = await supabase.rpc('contar_facturas_sala', {
        p_branch_id: Number(branchId), p_dias: dias,
    });
    return { total: data ?? 0, error };
}

/**
 * Tomar una factura.
 *
 * El candado NO está acá: está en el índice único parcial
 * `purchase_dte_claims_uno_vivo`. Si dos salas confirman en el mismo segundo,
 * una entra y la otra recibe «Otra sala tomó esta factura primero» — que es el
 * mensaje que levanta el RPC al capturar el 23505. Un chequeo previo en el
 * navegador no puede dar esa garantía: entre leer y escribir no hay nada.
 */
export async function reclamarFactura(documentId, branchId) {
    const { data, error } = await supabase.rpc('reclamar_factura_compra', {
        p_document_id: Number(documentId), p_branch_id: Number(branchId),
    });
    if (error) return { claimId: null, error: error.message ?? 'No se pudo tomar la factura.' };
    return { claimId: data, error: null };
}

/**
 * Soltarla. La fila no se borra: se cierra con quién y por qué.
 *
 * La sala puede soltar la que tomó por error mientras nadie la haya registrado
 * como compra; después de eso solo contabilidad. Esa segunda mitad la decide el
 * RPC, no esta función.
 */
export async function soltarFactura(claimId, motivo = null) {
    const { error } = await supabase.rpc('soltar_factura_compra', {
        p_claim_id: Number(claimId), p_motivo: motivo,
    });
    return { error: error?.message ?? null };
}

/** El panel de contabilidad: quién tomó qué, y si terminó registrada. */
export async function fetchFacturasSalaPanel(dias = 90) {
    const { data, error } = await supabase.rpc('get_facturas_sala_panel', { p_dias: dias });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}

// ── El renglón, legible ─────────────────────────────────────────────────────
// `items_text` viene tal como lo escribió el proveedor y trae de todo: el
// separador `|` entre renglones, un `\r` en medio de la línea de COFARSAL, y la
// cola de lote y vencimiento que a la sala no le dice nada para decidir si la
// factura es suya.
//
//   "2218 GRUPO DE TELEFONIAS|RECARGA TIGO $ 25.00 \rLote: 8168 Cant.: 16. Fecha Exp.: 01/01/2030"
//
// De ahí lo que importa es «RECARGA TIGO $ 25.00 · Cant.: 16».
export function resumenRenglones(itemsText) {
    if (!itemsText) return 'Sin detalle';
    return itemsText
        .split('|')
        .map(l => l.replace(/\r/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map(l => {
            const cant = l.match(/Cant\.?:\s*([\d.]+)/i);
            // Se corta en Lote/Fecha Exp. porque son la cola administrativa; la
            // cantidad se rescata antes de tirarla, que es lo que sí ayuda a
            // reconocer la factura.
            const cuerpo = l.split(/\s*(?:Lote|Fecha Exp)\.?:/i)[0].trim();
            return cant ? `${cuerpo} · Cant.: ${cant[1]}` : cuerpo;
        })
        .filter(Boolean)
        .join('  ·  ');
}
