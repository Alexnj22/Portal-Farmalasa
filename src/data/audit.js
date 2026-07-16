// Bloque 6.A — capa de datos, entidad "audit". Extraído de
// auditSlice.js: 2 llamadas supabase.from() (appendAuditLog/fetchAuditLogs).
import { supabase } from '../supabaseClient';

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
