import { supabase } from '../supabaseClient';

// El enlace de Google Maps o un punto → `{ lat, lng, precision, lugar, address }`.
// Lo resuelve `maps-proxy` (acción `ubicar`): el enlace corto sólo se puede
// abrir desde el servidor, y la dirección sale de OpenStreetMap con un
// User-Agent que el navegador no puede poner. Ver el encabezado de esa función.
//
// Lanza con `codigo` (ENLACE_INVALIDO · NO_ES_DE_MAPS · SIN_COORDENADAS ·
// DOMINIO_NO_PERMITIDO) cuando el enlace no sirve, para que la pantalla diga
// qué pasó en vez de un error genérico.
export async function ubicarEnMapa({ enlace, lat, lng } = {}) {
    const { data, error } = await supabase.functions.invoke('maps-proxy', {
        body: { type: 'ubicar', params: enlace ? { enlace } : { lat, lng } },
    });
    if (error) throw error;
    if (data?.error) {
        const e = new Error(data.error);
        e.codigo = data.error;
        throw e;
    }
    return data;
}
