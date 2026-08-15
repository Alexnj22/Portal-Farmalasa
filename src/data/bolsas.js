import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { signPhotosDeep } from '../utils/storageFiles';

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
    cerrada_por, cerrada_at, estado, etiqueta_version, etiqueta_impresa_at,
    entregada_por, entregada_at, recibida_por, recibida_at,
    contado, contado_por, contado_at,
    dif_via, dif_causa, dif_por, dif_at
`;

/**
 * Las bolsas de un rango. Por defecto sólo las que siguen en la sala.
 *
 * Va por `fetchAllRows` como todo lo demás: son 2-3 por sala y por día, o sea
 * ~500 al mes con las seis salas, y el tope de PostgREST son 1000. Hoy no
 * trunca; el día que lo haga, el síntoma sería una sala que «no tiene bolsas»,
 * que se lee como que ya las entregó.
 */
export function fetchBolsas({ desde, hasta, estados = ['ABIERTA'], porFechaDeConteo = false } = {}) {
    return fetchAllRows(() => {
        let q = supabase.from('bolsas').select(CAMPOS);
        // `porFechaDeConteo` recorta por CUÁNDO SE CONTÓ y no por la fecha del
        // corte. Existe porque sin él el historial mentía: una bolsa del corte
        // del martes que se cuenta hoy desaparecía de la pantalla en cuanto se
        // firmaba —el período arranca en «Hoy»— y quien acababa de contarla veía
        // su trabajo esfumarse. Lo destapó la prueba en el entorno de pruebas
        // con una bolsa de hace cinco días.
        const campo = porFechaDeConteo ? 'contado_at' : 'fecha';
        if (desde) q = q.gte(campo, desde);
        // El fin del día, no la medianoche: `contado_at` lleva hora, y comparar
        // contra la fecha pelada dejaría fuera todo lo contado después de las
        // 00:00 del último día del rango.
        if (hasta) q = q.lte(campo, porFechaDeConteo ? `${hasta}T23:59:59.999Z` : hasta);
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

/**
 * Se anula, nunca se borra: la etiqueta ya salió y está pegada a una bolsa.
 *
 * Es además **la corrección** del guardado automático. Desde que la bolsa nace
 * sola al confirmar el corte (decisión del usuario, 2026-08-15), el registro
 * afirma que existe antes de que nadie meta un billete; si el dinero no se
 * guardó, la salida es anularla con su motivo, no borrar la fila.
 */
export function anularBolsa(id, motivo) {
    return supabase.rpc('anular_bolsa', { p_id: id, p_motivo: motivo });
}

// ── La cadena de custodia ───────────────────────────────────────────────────
//
// Tres actos y tres firmas distintas: la sala entrega, administración acusa
// recibo, administración cuenta. Que sean tres y no uno es el control: quien
// entrega no puede firmar la recepción, y el servidor lo rechaza.

/** La bolsa sale de la sala. Varias a la vez: se entregan juntas. */
export function entregarBolsas(ids) {
    return supabase.rpc('entregar_bolsas', { p_ids: ids });
}

/**
 * Administración acusa recibo, **sin contar el dinero**. Cuenta bolsas: es el
 * paso rápido de cuando llega la valija, y el conteo puede ser al otro día.
 */
export function recibirBolsas(ids) {
    return supabase.rpc('recibir_bolsas', { p_ids: ids });
}

/**
 * El conteo. `esperadoVisto` es lo que decía la pantalla y NO es lo que se
 * guarda: el servidor calcula el suyo y rechaza si no coinciden.
 *
 * Lo contado queda para siempre — resolver una diferencia después no lo pisa.
 */
export function contarBolsa(id, contado, esperadoVisto) {
    return supabase.rpc('contar_bolsa', {
        p_id: id, p_contado: contado, p_esperado: esperadoVisto,
    });
}

/** REPONE (entra dinero), RETIRA (sale) o JUSTIFICA (no mueve nada). */
export function resolverDiferenciaBolsa(id, via, causa) {
    return supabase.rpc('resolver_diferencia_bolsa', { p_id: id, p_via: via, p_causa: causa });
}

/** La bitácora de una bolsa: cada firma, con quién y cuándo. */
export async function fetchEventosDeBolsa(id) {
    const { data, error } = await supabase.rpc('get_bolsa_eventos', { p_bolsa_id: id });
    if (error) { console.error('bolsas: fetchEventosDeBolsa failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
}

/**
 * Quién firmó cada paso: nombre y foto.
 *
 * NO va contra `employees_safe`. Su policy esconde a los superusuarios de todos
 * menos de sí mismos, y quien cuenta el dinero suele serlo: la pantalla decía
 * «sin registrar quién» sobre una firma que sí tiene autor. Es el mismo motivo
 * por el que existe `get_cortes_resolutores`.
 */
export async function fetchPersonasDeBolsas(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return [];
    const { data, error } = await supabase.rpc('get_bolsas_personas', { p_ids: unicos });
    if (error) { console.error('bolsas: fetchPersonasDeBolsas failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
}
