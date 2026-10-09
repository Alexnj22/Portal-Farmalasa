// Bloque 6.A — capa de datos, entidad "encuestas" (clima laboral).
// Extraído de EncuestaAdminView.jsx (11 llamadas) y EncuestaView.jsx
// (7 llamadas, de las cuales 4 reutilizan funciones ya definidas acá:
// fetchSurveys, fetchSurveyBloques, fetchSurveyPreguntas, updateSurvey).
import { supabase } from '../supabaseClient';
import { conBitacora } from './audit';
import { preguntarASaly } from './ia';

export function fetchSurveys() {
    return supabase.from('surveys').select('*').order('año', { ascending: false });
}

export function fetchSurveyResponseCounts(surveyIds) {
    return supabase.from('survey_responses').select('survey_id').in('survey_id', surveyIds);
}

export function fetchEmployeesForSurvey() {
    return supabase.from('employees')
        .select('id, first_names, last_names, photo_url, role_id, hire_date, branch:branches(id, name)')
        .order('first_names');
}

export function fetchSurveyBloques(surveyId) {
    return supabase.from('survey_bloques').select('*').eq('survey_id', surveyId).order('numero');
}

export function fetchSurveyPreguntas(surveyId) {
    return supabase.from('survey_preguntas').select('*').eq('survey_id', surveyId).order('numero');
}

export function fetchSurveyResponses(surveyId) {
    return supabase.from('survey_responses')
        .select('*, employee:employees!employee_id(id, first_names, last_names, photo_url, role_id, branch:branches(id, name))')
        .eq('survey_id', surveyId);
}

// Sin bitácora a propósito: además de la edición del administrador, la usa
// EncuestaView para guardar el resumen de IA en caché, que no es una acción de
// nadie. La edición del administrador pasa por `actualizarEncuesta`.
export function updateSurvey(surveyId, payload) {
    return supabase.from('surveys').update(payload).eq('id', surveyId);
}

// ── Escrituras del administrador: se anotan solas (D3, 2026-09-28) ─────────
// La entrada la escribe la función que guarda, no la pantalla, para que
// cualquier cliente la herede. Sólo se anota si la escritura entró.

/** Editar una encuesta → `ENCUESTA_ACTUALIZADA`. */
export function actualizarEncuesta(surveyId, payload) {
    return conBitacora(updateSurvey(surveyId, payload), 'ENCUESTA_ACTUALIZADA', String(surveyId),
        { survey_id: surveyId });
}

/** Crear una encuesta → `ENCUESTA_CREADA`. */
export function insertSurvey(payload) {
    return conBitacora(supabase.from('surveys').insert(payload), 'ENCUESTA_CREADA', null,
        { nombre: payload?.nombre });
}

/** Editar la respuesta de una persona → `ENCUESTA_RESPUESTA_EDITADA` (target: la persona). */
export function updateSurveyResponse(responseId, patch, { surveyId = null, employeeId = null } = {}) {
    return conBitacora(supabase.from('survey_responses').update(patch).eq('id', responseId),
        'ENCUESTA_RESPUESTA_EDITADA', employeeId, { survey_id: surveyId, response_id: responseId });
}

/** Cargar la respuesta de una persona → `ENCUESTA_RESPUESTA_AGREGADA`. */
export function insertSurveyResponse(payload) {
    return conBitacora(supabase.from('survey_responses').insert(payload),
        'ENCUESTA_RESPUESTA_AGREGADA', payload?.employee_id ?? null, { survey_id: payload?.survey_id ?? null });
}

/** Borrar la respuesta de una persona → `ENCUESTA_RESPUESTA_ELIMINADA`. */
export function deleteSurveyResponse(responseId, { surveyId = null, employeeId = null } = {}) {
    return conBitacora(supabase.from('survey_responses').delete().eq('id', responseId),
        'ENCUESTA_RESPUESTA_ELIMINADA', employeeId, { survey_id: surveyId, response_id: responseId });
}

// EncuestaView.jsx (vista de resultados) usa un join más liviano que
// fetchSurveyResponses (sin id/role_id de empleado, branch solo con name).
export function fetchSurveyResponsesForView(surveyId) {
    return supabase.from('survey_responses')
        .select('*, employee:employees!employee_id(first_names, last_names, photo_url, branch:branches(name))')
        .eq('survey_id', surveyId);
}

export function fetchSurveyAiSummaries(surveyId) {
    return supabase.from('surveys').select('ai_summaries').eq('id', surveyId).single();
}

/**
 * Resume los comentarios de un segmento con Saly y lo guarda en la encuesta,
 * mezclado con lo que ya hubiera (otro segmento puede estar guardándose a la
 * vez). Portal y app. Devuelve el texto, o lanza.
 */
export async function generarResumenDeComentarios(surveyId, comments, segment) {
    const { data, error } = await preguntarASaly({ action: 'analyze-survey-comments', payload: { comments, segment } });
    if (error) throw error;
    const summary = data?.aiSummary || 'Sin respuesta.';
    if (surveyId) {
        const { data: current } = await fetchSurveyAiSummaries(surveyId);
        const merged = { ...(current?.ai_summaries || {}), [segment]: summary };
        await updateSurvey(surveyId, { ai_summaries: merged });
    }
    return summary;
}
