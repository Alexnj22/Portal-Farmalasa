// Bloque 6.A — capa de datos, entidad "conteoInventario". Extraído de
// conteoInventarioSlice.js: 3 llamadas supabase.from() (el resto del
// slice son RPCs, ya server-side y fuera de alcance de 6.A).
import { supabase } from '../supabaseClient';

export function fetchConteosInventario() {
    return supabase.from('conteos_inventario').select('*, branches(name)').order('created_at', { ascending: false });
}

export function fetchConteoDetalle(conteoId) {
    return supabase.from('conteos_inventario').select('*, branches(name)').eq('id', conteoId).single();
}

export function insertConteoItemManual(payload) {
    return supabase.from('conteo_inventario_items').insert([payload]).select().single();
}
