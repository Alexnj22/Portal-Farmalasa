import { supabase } from '../supabaseClient';

// Resumen Fiscal — el movimiento del mes en un número por concepto.
//
// El RPC devuelve un **objeto JSON único**, no un SETOF, así que no pasa por
// `fetchAllRows`: el cap de 1000 filas de PostgREST no aplica (Patrón C de
// CLAUDE.md). Es una sola fila con todos los agregados adentro.
//
// La autorización vive dentro de la función, no acá: si quien pregunta no tiene
// `resumen_fiscal.can_view`, devuelve `{ error: 'FORBIDDEN' }` en vez de datos.
// El alcance por sucursal también lo resuelve el servidor — un usuario limitado
// a su sucursal no puede pedir otra aunque mande el parámetro.
export function fetchResumenFiscal(desde, hasta, branchId) {
    return supabase.rpc('get_resumen_fiscal', {
        p_desde: desde,
        p_hasta: hasta,
        p_branch_id: branchId ? Number(branchId) : null,
    });
}
