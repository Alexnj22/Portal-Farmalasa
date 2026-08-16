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
    // La guarda vive acá y no en el widget: allá era una escritura de estado
    // SINCRÓNICA dentro del efecto que llama —render en cascada, y el lint lo
    // marca—. Devolviendo desde una función async, quien la espera escribe
    // después del tick.
    if (!branchId) return { filas: [], error: null };
    const { data, error } = await supabase.rpc('get_facturas_sala', {
        p_branch_id: Number(branchId),
        p_dias: dias,
        p_incluir_tomadas: incluirTomadas,
    });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}

// `contarFacturasSala` se eliminó el 2026-08-07. Envolvía a
// `contar_facturas_sala`, que era `SELECT count(*) FROM get_facturas_sala(...)`
// —o sea, la consulta pesada entera, materializando las 17 columnas para
// devolver un entero— y el widget la llamaba DOS veces por apertura: una al
// montar el tablero y otra al final de cada carga de la lista. El número de la
// baldosa sale ahora de contar las filas que ya se trajeron. La función de la
// base se dio de baja en el mismo commit.

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
// `items_text` lo arma el sync de correo (`extractItemsText`): une los renglones
// del DTE con ` | ` y le antepone a cada uno el CÓDIGO del proveedor —
// `${codigo} ${descripcion}`—. La descripción viene tal como la escribió el
// proveedor y trae de todo: un `\r` en medio, la cola de lote y vencimiento, y
// —en COFARSAL— un `|` PROPIO que separa el grupo del producto:
//
//   "2218 GRUPO DE TELEFONIAS|RECARGA TIGO $ 25.00 \rLote: 8168 Cant.: 8. Fecha Exp.: 01/01/2030 | 2218 …Lote: 8253 Cant.: 8.… | 2226 …RECARGA CLARO $1.00 …Cant.: 300."
//
// De ahí lo que importa es «RECARGA TIGO $ 25.00 × 16  ·  RECARGA CLARO $1.00 × 300».
//
// Cuatro cosas que se rompieron por leer mal ese texto (corregidas 2026-08-16,
// las cuatro visibles a la vez en la factura de arriba):
//
//   1. **Partir por `|` a secas mezcla los DOS usos del carácter**: el separador
//      de renglones que pone el sync (` | `, CON espacios) y el que el proveedor
//      escribe adentro de su descripción. Así «2218 GRUPO DE TELEFONIAS» salía
//      en pantalla como si fuera un producto más.
//   2. **El número de adelante es el código del proveedor, NO la cantidad.**
//      Medido: «4 GARRAFA DE AGUA» aparece igual en facturas de $4.00, $6.00 y
//      $10.00 — si fuera la cantidad, las tres valdrían lo mismo. Mostrarlo
//      invita a leer «4 garrafas» donde dice «producto n.º 4», y el comentario
//      viejo de este archivo cometía exactamente esa lectura.
//   3. **`([\d.]+)` se llevaba el punto que cierra la oración**: «Cant.: 8.».
//   4. **Dos lotes del mismo producto se pintaban como dos renglones idénticos**
//      —«RECARGA TIGO $ 25.00 × 8» dos veces— porque el lote, que es lo único
//      que los distingue, se tira. Se suman: 16, que es lo que la sala compró.
//
// El código del proveedor se quita a sabiendas de que un renglón sin código
// cuya descripción empiece con un número puro lo perdería. Hoy no existe: los
// tres proveedores con regla mandan código (COFARSAL y la envasadora) o no
// empiezan con número (Movistar: "Artículo: RECARGA ELECTRONICA…").
const SEP_RENGLONES = / \| /;
const MAX_RENGLONES = 6;

const fmtCantidad = (n) => String(Math.round(n * 1000) / 1000);

export function resumenRenglones(itemsText, { max = MAX_RENGLONES } = {}) {
    if (!itemsText) return 'Sin detalle';

    // Map en vez de array: la clave es el cuerpo del renglón, así dos lotes del
    // mismo producto caen en la misma entrada y sus cantidades se suman.
    const renglones = new Map();

    for (const crudo of String(itemsText).split(SEP_RENGLONES)) {
        const linea = crudo.replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
        if (!linea) continue;

        // La cantidad se rescata ANTES de tirar la cola administrativa, que es
        // donde el proveedor la escribe.
        const cant = linea.match(/\bCant\.?:\s*(\d+(?:[.,]\d+)?)/i);

        let cuerpo = linea.split(/\s*(?:Lote|Fecha Exp)\.?:/i)[0].trim();
        // Del `grupo|producto` del proveedor queda el producto — y con él se va
        // el código, que viaja pegado al grupo.
        cuerpo = cuerpo.split('|').pop().trim();
        // Sin `|` de por medio el código queda al frente y hay que quitarlo acá.
        cuerpo = cuerpo.replace(/^\d{1,6}\s+(?=\S)/, '').trim();
        if (!cuerpo) continue;

        const n = cant ? Number(cant[1].replace(',', '.')) : null;
        const previo = renglones.get(cuerpo);
        if (previo === undefined)            renglones.set(cuerpo, n);
        // Un renglón sin cantidad no se puede sumar: manda el «no se sabe».
        else if (previo === null || n === null) renglones.set(cuerpo, null);
        else                                 renglones.set(cuerpo, previo + n);
    }

    const lineas = [...renglones].map(
        ([cuerpo, n]) => (n === null ? cuerpo : `${cuerpo} × ${fmtCantidad(n)}`));
    if (!lineas.length) return 'Sin detalle';

    // `items_text` admite hasta 8 kB: una factura con 60 renglones convertiría
    // la tarjeta del tablero en una pared de texto. Hoy el máximo real son 3
    // renglones, así que el tope no recorta nada — está para que el día que
    // recorte, se note que recortó.
    if (lineas.length > max) {
        return [...lineas.slice(0, max), `y ${lineas.length - max} más`].join('  ·  ');
    }
    return lineas.join('  ·  ');
}
