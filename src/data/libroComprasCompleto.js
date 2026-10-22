import { supabase } from '../supabaseClient';

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
// UNA sola llamada a `get_libro_compras_completo_json` (Patrón C de CLAUDE.md:
// `RETURNS json` con `json_agg`), que devuelve el libro entero como un arreglo.
// Antes iba por `fetchAllRows`: páginas de 1000 con `.range()` sobre una
// función ordenada por (fecha, origen, documento) — un orden con EMPATES, y
// cada página es una ejecución distinta de la función. Un documento empatado
// en el corte entre dos páginas podía salir dos veces y otro ninguna: un CCF de
// menos y otro contado doble, sin error (auditoría 2026-10, grupo 4 H5).
// Además cada página re-ejecutaba la función entera. La envoltura arma el
// arreglo en una sola ejecución, con el orden de la original y la fila entera
// como desempate, así que el conjunto es exactamente el de la función.
//
// Devuelve el arreglo, o `null` si falló: las pantallas tratan `null` como
// fallo y nunca muestran un libro a medias como si fuera el entero.
const comoLibro = ({ data, error }) => {
    if (error) {
        console.error('Libro de compras:', error.message);
        return null;
    }
    return Array.isArray(data) ? data : null;
};

export async function fetchLibroComprasCompleto(desde, hasta, branchId) {
    return comoLibro(await supabase.rpc('get_libro_compras_completo_json', {
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
// Una sola llamada por lo mismo que su hermana (`get_libro_compras_declarable_json`).
export async function fetchLibroComprasDeclarable(desde, hasta) {
    return comoLibro(await supabase.rpc('get_libro_compras_declarable_json', { p_desde: desde, p_hasta: hasta }));
}
