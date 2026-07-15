// Bloque 6.A — capa de datos, entidad "practicantes". Extraído de
// practicantesSlice.js: 5 llamadas supabase.from().
import { supabase } from '../supabaseClient';

const PRACTICANTE_SELECT = '*, branches(name), supervisor:supervisor_employee_id(id, first_names, last_names)';

export function upsertInstitucionCatalogEntry(institucion) {
    return supabase.from('education_catalog_entries')
        .upsert([{ category: 'INSTITUCION_EDUCATIVA', value: institucion }], { onConflict: 'category,value', ignoreDuplicates: true });
}

export function fetchPracticantes() {
    return supabase.from('practicantes').select(PRACTICANTE_SELECT).order('created_at', { ascending: false });
}

export function insertPracticante(payload) {
    return supabase.from('practicantes').insert([payload]).select(PRACTICANTE_SELECT).single();
}

export function updatePracticante(id, payload) {
    return supabase.from('practicantes').update(payload).eq('id', id).select(PRACTICANTE_SELECT).single();
}

export function deletePracticante(id) {
    return supabase.from('practicantes').delete().eq('id', id);
}
