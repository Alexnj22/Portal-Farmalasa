import { supabase } from '../supabaseClient';

/**
 * Régimen disciplinario del RIT Art. 83.
 *
 * ── Por qué todo pasa por RPC y nada escribe la tabla directo ────────────────
 * `employee_events` acepta un `insert` desde el navegador, así que registrar una
 * amonestación «a mano» sería posible. Sería un error, y de los caros: la
 * escalera, la validación de la proporción y la FIRMA viven adentro de
 * `registrar_sancion`. Escribir la fila directo se saltea las tres, y el
 * registro que existe para sostener un despido quedaría con un `impuesta_por`
 * puesto por el cliente — o sea falsificable.
 *
 * Es la misma decisión que `registrarEgreso`: quien firma no elige a nombre de
 * quién queda anotado.
 */

/**
 * El catálogo de faltas. Es una TABLA y no una constante porque el RIT Art. 82
 * dice que «la Empresa establecerá los lineamientos»: la lista es de la empresa
 * y va a crecer. Lo que se guarda en la sanción es la CLAVE, así que corregir un
 * rótulo nunca desconecta la reincidencia.
 */
export async function listarFaltas() {
    const { data, error } = await supabase
        .from('faltas_disciplinarias')
        .select('clave, nombre, articulo')
        .eq('activa', true)
        .order('orden');
    if (error) throw error;
    return data || [];
}

/**
 * Qué peldaño toca, y en qué se apoya.
 *
 * Devuelve la propuesta JUNTO A sus antecedentes a propósito: quien firma tiene
 * que poder ver por qué. Una escalera que dice «peldaño 3» sin mostrar la
 * evidencia es indefendible en un juicio, que es justo para lo que existe este
 * registro.
 *
 * La propuesta NO se aplica sola — la decide una persona. La función calcula lo
 * que el Art. 83 permite; imponerla es un acto con nombre y apellido.
 */
export async function consultarEscalera(employeeId, falta, fecha = null) {
    const { data, error } = await supabase.rpc('escalera_disciplinaria', {
        p_employee_id: employeeId,
        p_falta:       falta,
        p_fecha:       fecha,
    });
    if (error) throw error;
    return data;
}

/**
 * Imponer la sanción. Devuelve el id del evento, que es al que se le cuelga la
 * constancia firmada (`employee_documents.event_id`).
 *
 * **No recibe quién la impone.** La firma sale de `auth_employee_id()` adentro
 * de la base.
 *
 * Lanza con el motivo del reglamento cuando algo no cumple: `ART83_4_SIN_AUTORIZACION`
 * si falta la calificación del Director General de Inspección de Trabajo,
 * `ART83_3` si se le ponen más de un día al peldaño 3, `PELDANO_INVALIDO` si se
 * intenta registrar la terminación (que es una baja, no una sanción).
 */
export async function registrarSancion({ employeeId, falta, peldano, fecha, dias = null,
                                         nota = null, autorizacion = null }) {
    const { data, error } = await supabase.rpc('registrar_sancion', {
        p_employee_id:  employeeId,
        p_falta:        falta,
        p_peldano:      peldano,
        p_fecha:        fecha,
        p_dias:         dias,
        p_nota:         nota,
        p_autorizacion: autorizacion,
    });
    if (error) throw error;
    return data;
}

/**
 * El memorando del Art. 86, que es lo que hace BAJAR la escalera.
 *
 * El plazo es un PISO: «en un plazo no menor de sesenta días». Antes de eso la
 * base lo rechaza con `ART86_ANTES_DE_TIEMPO` y dice desde qué fecha se puede.
 */
export async function registrarRectificacion(employeeId, nota = null, fecha = null) {
    const { data, error } = await supabase.rpc('registrar_rectificacion', {
        p_employee_id: employeeId,
        p_nota:        nota,
        p_fecha:       fecha,
    });
    if (error) throw error;
    return data;
}

/**
 * El desenlace del reclamo del Art. 77.
 *
 * `REVOCADA` no es cosmético: la sanción deja de contar para la escalera, deja
 * de suspender y deja de pintar el aro en la foto. Las tres cosas lo consultan.
 */
export async function resolverReclamo(eventoId, estado, resolucion = null) {
    const { error } = await supabase.rpc('resolver_reclamo_sancion', {
        p_evento_id:  eventoId,
        p_estado:     estado,
        p_resolucion: resolucion,
    });
    if (error) throw error;
}

/**
 * Los cinco peldaños, para la pantalla. El 5 se muestra y **no se puede elegir**:
 * está para que quien decide vea dónde termina la escalera, no para registrarlo
 * acá — una terminación es una baja, con su liquidación y su causal del Art. 50.
 */
export const PELDANOS = [
    { n: 1, nombre: 'Amonestación verbal',  detalle: 'Se registra con la firma del trabajador' },
    { n: 2, nombre: 'Amonestación escrita', detalle: 'Cuando ya hay verbales por la misma causa' },
    { n: 3, nombre: 'Suspensión de 1 día',  detalle: 'Sin goce de salario' },
    { n: 4, nombre: 'Suspensión de 2 a 30 días', detalle: 'Exige la calificación del Director General de Inspección de Trabajo' },
    { n: 5, nombre: 'Terminación del contrato', detalle: 'Se registra como baja, no como sanción', noElegible: true },
];
