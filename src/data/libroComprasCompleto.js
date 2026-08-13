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

// El libro DECLARABLE — el de arriba dice qué se compró; éste, qué de eso puede
// reclamarse como crédito fiscal. Son tres reglas que el completo no aplica:
// las notas de crédito restan y las de débito suman (Art. 62 LIVA), sólo cuenta
// el CCF de un proveedor con deducibilidad confirmada (Art. 65), y una factura
// no da crédito por más IVA que traiga.
//
// **No recibe sucursal, y no es un olvido.** El libro se presenta por NRC —la
// empresa— y los documentos que sólo llegaron por correo no tienen sucursal
// guardada. Aceptar el parámetro haría que pedir una sala omitiera cientos de
// CCF sin avisar.
//
// `fetchAllRows` por lo mismo que su hermana: junio-julio dan ~1,450 filas y
// PostgREST corta en 1000 sin decir nada.
export function fetchLibroComprasDeclarable(desde, hasta) {
    return fetchAllRows(() =>
        supabase.rpc('get_libro_compras_declarable', { p_desde: desde, p_hasta: hasta }));
}
