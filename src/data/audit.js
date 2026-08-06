// Bloque 6.A — capa de datos, entidad "audit". Extraído de
// auditSlice.js: 2 llamadas supabase.from() (appendAuditLog/fetchAuditLogs).
import { supabase } from '../supabaseClient';

// La autoría del log tiene que salir de la SESIÓN, no de `sb_user` en
// localStorage — que lo escribe el navegador y por lo tanto se puede editar.
// Desde la migración 20260806000957 la policy de INSERT exige
// `user_id = auth.uid()`, así que mandar otra cosa no es sólo incorrecto: la
// fila se rechaza y `appendAuditLog` se traga el error (bitácora muda).
// `getSession()` lee del storage local, no viaja a la red.
export async function getSessionUserId() {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data?.session?.user?.id ?? null;
}

export function insertAuditLog(logData) {
    return supabase.from('audit_logs')
        .insert([logData])
        .select('id,user_id,user_name,action,target_id,details,source,severity,branch_id,branch_name,device_name,input_method,created_at')
        .single();
}

export function fetchAuditLogs(limit) {
    return supabase.from('audit_logs')
        .select('id,user_id,user_name,action,target_id,details,source,severity,branch_id,branch_name,device_name,input_method,created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
}
