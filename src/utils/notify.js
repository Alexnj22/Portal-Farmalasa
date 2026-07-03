import { supabase } from '../supabaseClient';

// ============================================================================
// 🔔 Canal de notificaciones — wrappers de los RPC SECURITY DEFINER.
// Regla de ruido: push=true SOLO para eventos accionables (solicitud pendiente,
// solicitud decidida, llegada física / reenvío de pedido). El resto solo
// enciende la campana. Los AVISOS (announcements) siguen pusheando vía trigger.
// ============================================================================

/**
 * Notifica a empleados específicos. Fire-and-forget: nunca lanza.
 * @param {string[]} recipientIds  UUIDs de empleados
 * @param {{type:string, title:string, body?:string, link?:string, metadata?:object, push?:boolean, branchId?:number}} opts
 */
export const notifyEmployees = async (recipientIds, { type, title, body = '', link = null, metadata = {}, push = false, branchId = null }) => {
    const ids = (recipientIds || []).filter(Boolean).map(String);
    if (!ids.length) return 0;
    try {
        const { data, error } = await supabase.rpc('notify_employees', {
            p_recipients: ids,
            p_type: type,
            p_title: title,
            p_body: body,
            p_link: link,
            p_metadata: metadata,
            p_push: push,
            p_branch_id: branchId,
        });
        if (error) throw error;
        return data ?? 0;
    } catch (err) {
        console.error('notifyEmployees error:', err);
        return 0;
    }
};

/**
 * Notifica a todos los empleados activos de una sucursal. Fire-and-forget.
 * @param {number} branchId
 * @param {{type:string, title:string, body?:string, link?:string, metadata?:object, push?:boolean}} opts
 */
export const notifyBranch = async (branchId, { type, title, body = '', link = null, metadata = {}, push = false }) => {
    if (branchId == null) return 0;
    try {
        const { data, error } = await supabase.rpc('notify_branch', {
            p_branch_id: Number(branchId),
            p_type: type,
            p_title: title,
            p_body: body,
            p_link: link,
            p_metadata: metadata,
            p_push: push,
        });
        if (error) throw error;
        return data ?? 0;
    } catch (err) {
        console.error('notifyBranch error:', err);
        return 0;
    }
};
