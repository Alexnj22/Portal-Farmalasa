// Bloque 6.A — capa de datos, entidad "pushSubscriptions". Extraído de
// hooks/usePushSubscription.js: 2 llamadas supabase.from().
import { supabase } from '../supabaseClient';

export function upsertPushSubscription(payload) {
    return supabase.from('push_subscriptions').upsert(payload, { onConflict: 'endpoint' });
}

export function deletePushSubscriptionByEndpoint(endpoint) {
    return supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}
