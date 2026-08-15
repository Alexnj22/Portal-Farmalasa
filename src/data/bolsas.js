import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// Bolsas de efectivo — el dinero que la sala guarda al confirmar un corte, hasta
// que administración lo cuenta.
//
// Entre «el corte cuadró» y «el dinero llegó» no había ningún registro, y ese
// hueco dura hasta tres días. Importa además por algo que no se ve: cuando sacan
// dinero de una bolsa y dejan el papel, **el papel ocupa el lugar del billete y
// el corte siguiente sigue cuadrando**. Un descuadre de bolsa es invisible para
// todas las cuentas que el portal ya hace.
//
// El diseño completo: `docs/PLAN-BOLSAS-DE-EFECTIVO-2026-08-15.md`.

const CAMPOS = `
    id, folio, branch_id, corte_id, origen, motivo_origen,
    monto_inicial, fecha, hora, caja,
    cerrada_por, cerrada_at, estado, etiqueta_version, etiqueta_impresa_at
`;

/**
 * Las bolsas de un rango. Por defecto sólo las que siguen en la sala.
 *
 * Va por `fetchAllRows` como todo lo demás: son 2-3 por sala y por día, o sea
 * ~500 al mes con las seis salas, y el tope de PostgREST son 1000. Hoy no
 * trunca; el día que lo haga, el síntoma sería una sala que «no tiene bolsas»,
 * que se lee como que ya las entregó.
 */
export function fetchBolsas({ desde, hasta, estados = ['ABIERTA'] } = {}) {
    return fetchAllRows(() => {
        let q = supabase.from('bolsas').select(CAMPOS);
        if (desde) q = q.gte('fecha', desde);
        if (hasta) q = q.lte('fecha', hasta);
        if (estados?.length) q = q.in('estado', estados);
        return q.order('fecha', { ascending: false }).order('hora', { ascending: false });
    });
}

/**
 * Los cortes confirmados que todavía no tienen su bolsa, con **cuánto** falta
 * guardar de cada uno.
 *
 * Es el invariante del sistema en forma de lista: si un corte confirmado no
 * tiene bolsa, o falta guardar el dinero o falta registrarlo. Detecta el caso
 * peor — efectivo contado que nunca se guardó.
 *
 * La cifra la calcula el SERVIDOR (`bolsa_sugerida`) y no se replica acá. Los
 * cortes son acumulativos dentro del día, así que lo que entra a la bolsa es la
 * resta contra lo ya embolsado; escribir esa aritmética también en JavaScript
 * sería tener dos definiciones de cuánto dinero hay, y la del navegador no es la
 * que manda.
 */
export async function fetchCortesPorEmbolsar({ desde, hasta }) {
    const { data, error } = await supabase.rpc('get_cortes_por_embolsar', {
        p_desde: desde, p_hasta: hasta,
    });
    if (error) { console.error('bolsas: fetchCortesPorEmbolsar failed:', error.message); return []; }
    return data || [];
}

/**
 * Cerrar la bolsa de un corte.
 *
 * `montoVisto` es lo que decía la pantalla y NO es lo que se guarda: el servidor
 * calcula el suyo y rechaza si no coinciden. Misma regla que
 * `resolverDiferencia`, por el mismo motivo — si el monto lo manda el navegador,
 * cualquiera elige cuánto dinero dice haber guardado.
 */
export function cerrarBolsa(corteId, montoVisto) {
    return supabase.rpc('cerrar_bolsa_de_corte', {
        p_corte_id: corteId,
        p_monto_esperado: montoVisto,
    });
}

/**
 * Deja constancia de que la etiqueta se mandó a imprimir y devuelve el número
 * que le tocó.
 *
 * Ese número es el que hace que el papel diga «ETIQUETA #3 - ANULA LA
 * ANTERIOR», y hace falta porque **la etiqueta se vuelve mentira en cuanto sale
 * plata de la bolsa**: sobre la mesa de administración, dos etiquetas de la
 * misma bolsa se ven iguales y sólo una dice la verdad.
 *
 * No promete que salió papel — la respuesta de la ticketera es opaca — así que
 * se puede marcar tantas veces como se reimprima.
 */
export function marcarEtiquetaImpresa(id) {
    return supabase.rpc('marcar_etiqueta_impresa', { p_bolsa_id: id });
}

/** Se anula, nunca se borra: la etiqueta ya salió y está pegada a una bolsa. */
export function anularBolsa(id, motivo) {
    return supabase.rpc('anular_bolsa', { p_id: id, p_motivo: motivo });
}
