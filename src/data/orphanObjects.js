import { supabase } from '../supabaseClient';
import { conBitacora } from './audit';

// OrphanObjectsView.jsx (bloque 7B.7) — registro manual versionado de
// candidatos a código muerto, sembrado por migración. La UI solo lee/marca
// estado, no crea/borra filas (eso se hace vía migración cuando se
// confirma un nuevo caso real).
export function fetchOrphanObjects() {
    return supabase.from('orphan_objects_registry')
        .select('id, kind, ref, title, status, detected_at, resolved_at, notes')
        .order('detected_at', { ascending: false });
}

/**
 * Cambiar el estado de un candidato → `ORPHAN_OBJECT_STATUS_CHANGE`. La entrada
 * la escribe esta función (D3, 2026-09-28); la pantalla sólo pasa el título y
 * el estado anterior, que la base no devuelve.
 */
export function updateOrphanObjectStatus(id, status, contexto = {}) {
    return conBitacora(supabase.from('orphan_objects_registry')
        .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
        .eq('id', id)
        .select('id, status, resolved_at')
        .single(),
        'ORPHAN_OBJECT_STATUS_CHANGE', String(id), { ...contexto, to: status });
}

// Los estados de un candidato y las pestañas del tablero: los mismos rótulos
// en el portal y en la app.
export const ESTADOS_HUERFANO = {
    candidate: 'Candidato',
    confirmed_orphan: 'Confirmado huérfano',
    false_positive: 'Falso positivo',
    resolved: 'Resuelto',
};
export const PESTANAS_HUERFANOS = [
    { key: 'todos', label: 'Todos' },
    { key: 'candidate', label: 'Candidatos' },
    { key: 'confirmed_orphan', label: 'Confirmados' },
    { key: 'resolved', label: 'Resueltos' },
];
/** Las filas de una pestaña («todos» no filtra). */
export const huerfanosDePestana = (filas, pestana) => (pestana === 'todos' ? filas : filas.filter(r => r.status === pestana));
