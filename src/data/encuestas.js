// Bloque 6.A — capa de datos, entidad "encuestas" (clima laboral).
// Extraído de EncuestaAdminView.jsx: 11 llamadas supabase.from().
import { supabase } from '../supabaseClient';

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

export function updateSurvey(surveyId, payload) {
    return supabase.from('surveys').update(payload).eq('id', surveyId);
}

export function insertSurvey(payload) {
    return supabase.from('surveys').insert(payload);
}

export function updateSurveyResponse(responseId, patch) {
    return supabase.from('survey_responses').update(patch).eq('id', responseId);
}

export function insertSurveyResponse(payload) {
    return supabase.from('survey_responses').insert(payload);
}

export function deleteSurveyResponse(responseId) {
    return supabase.from('survey_responses').delete().eq('id', responseId);
}
