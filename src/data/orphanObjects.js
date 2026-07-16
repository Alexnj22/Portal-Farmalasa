import { supabase } from '../supabaseClient';

// OrphanObjectsView.jsx (bloque 7B.7) — registro manual versionado de
// candidatos a código muerto, sembrado por migración. La UI solo lee/marca
// estado, no crea/borra filas (eso se hace vía migración cuando se
// confirma un nuevo caso real).
export function fetchOrphanObjects() {
    return supabase.from('orphan_objects_registry')
        .select('id, kind, ref, title, status, detected_at, resolved_at, notes')
        .order('detected_at', { ascending: false });
}

export function updateOrphanObjectStatus(id, status) {
    return supabase.from('orphan_objects_registry')
        .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
        .eq('id', id)
        .select('id, status, resolved_at')
        .single();
}
