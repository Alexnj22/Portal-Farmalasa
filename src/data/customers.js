// Bloque 6.A — capa de datos, entidad "customers". Extraído de
// WidgetAnnulmentRequest.jsx (ClientChangeForm): búsqueda server-side
// sobre el listado completo de clientes (23K+ filas) por tokens —
// cada token hace OR sobre search_name/nit/dui/phone/erp_id.
import { supabase } from '../supabaseClient';

export function searchCustomersByTokens(tokens) {
    let req = supabase.from('customers')
        .select('id, name, nit, dui, phone, erp_id')
        .order('name')
        .limit(30);
    for (const tok of tokens) {
        const like = `%${tok}%`;
        req = req.or(`search_name.ilike.${like},nit.ilike.${like},dui.ilike.${like},phone.ilike.${like},erp_id.ilike.${like}`);
    }
    return req;
}
