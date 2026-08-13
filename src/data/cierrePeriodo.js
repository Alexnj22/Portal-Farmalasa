import { supabase } from '../supabaseClient';

// Cierre de período fiscal — la cadena del remanente (Art. 67 LIVA).
//
// La lectura devuelve la cadena ENTERA en una llamada, con los frenos ya
// resueltos por el servidor (`puede_cerrarse` y su `motivo_no_puede`). La vista
// no re-deduce las cuatro condiciones para cerrar: viven en
// `cerrar_periodo_fiscal`, y escritas dos veces el día que una cambie la otra
// seguiría opinando.
//
// Sin `fetchAllRows`: el RPC devuelve un único JSON, así que el corte de 1000
// filas de PostgREST no aplica. Y son un puñado de meses, no un catálogo.
export async function fetchPeriodosFiscales() {
    const { data, error } = await supabase.rpc('get_periodos_fiscales');
    if (error) throw error;
    return data || [];
}

// Congela el período. `declaradoReal` es lo que la contadora presentó de verdad,
// si difiere de lo calculado — nace NULL a propósito: «no se sabe» no es
// «coincide».
export async function cerrarPeriodoFiscal(periodo, nota, declaradoReal) {
    const { data, error } = await supabase.rpc('cerrar_periodo_fiscal', {
        p_periodo: periodo,
        p_nota: nota || null,
        p_declarado_real: declaradoReal ?? null,
    });
    if (error) throw error;
    return data;
}

// Reabrir exige motivo, y el servidor lo hace cumplir. Existe porque la
// alternativa es peor: sin esto, un período mal cerrado se corrige con un UPDATE
// a mano y la cadena se rompe en silencio.
export async function reabrirPeriodoFiscal(periodo, motivo) {
    const { data, error } = await supabase.rpc('reabrir_periodo_fiscal', {
        p_periodo: periodo,
        p_motivo: motivo,
    });
    if (error) throw error;
    return data;
}
