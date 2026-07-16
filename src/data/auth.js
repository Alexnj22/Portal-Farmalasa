// Bloque 6.A — capa de datos, entidad "auth". Extraído de
// AuthContext.jsx (loginWithUsername): 1 llamada supabase.from(),
// crítica para el flujo de login — se preserva exacta (mismo .single(),
// mismo `select('*')`).
import { supabase } from '../supabaseClient';

export function fetchEmployeeSafeByUsername(username) {
    return supabase.from('employees_safe').select('*').eq('username', username).single();
}
