import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// Libro de compras COMPLETO — el que responde qué compró la farmacia de verdad.
//
// No reemplaza a `librosIva.js`. Aquel sale del ERP y su razón de ser es
// cotejarse contra el archivo del origen: mismo contenido y mismo formato, que
// es como se confirma que no sobra ni falta nada. Ese cotejo no se toca.
//
// Éste une las compras del ERP con los DTE recibidos por correo que no tienen
// compra registrada. Medido sobre junio-julio 2026: el libro del ERP deja fuera
// 528 documentos con $10,921.99 de crédito fiscal, contra $49,525.79 declarados.
//
// Va por `fetchAllRows` y no por un `.select()` pelado: el RPC devuelve una fila
// por documento y junio-julio ya dieron 1,384 — PostgREST cortaría en 1000 sin
// avisar. El costo es que la función se ejecuta una vez por trozo (PostgREST
// aplica `limit/offset` sobre el resultado); con dos trozos es despreciable, y
// si algún día un año entero lo vuelve caro, el camino es el Patrón C de
// CLAUDE.md (`RETURNS json` con `json_agg`).
export function fetchLibroComprasCompleto(desde, hasta, branchId) {
    return fetchAllRows(() =>
        supabase.rpc('get_libro_compras_completo', {
            p_desde: desde,
            p_hasta: hasta,
            p_branch_id: branchId ? Number(branchId) : null,
        }));
}
