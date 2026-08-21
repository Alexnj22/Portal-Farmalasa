// La franja de aviso del tope del portal — la que se ve en todas las pantallas.
//
// Antes el texto vivía escrito dentro del componente y era PERMANENTE: quitarlo
// o cambiarlo pedía editar, commitear y desplegar. Un aviso que se pone «cuando
// hace falta» no puede depender de un despliegue — cuando hace falta ya es
// tarde. Hoy es una fila en la base que se enciende desde
// Sistema › Mantenimiento y aparece al instante en las pantallas ya abiertas.
//
// No es Anuncios: aquello son mensajes con audiencia y caducidad. Esto es LA
// franja, una sola, para todo el mundo a la vez.
import { supabase } from '../supabaseClient';

// El orden y los rótulos son los que ve quien lo enciende. `obra` va primera
// porque es la que reproduce la franja que el portal venía mostrando.
export const VARIANTES_BANNER = [
    { value: 'obra',     label: 'Obra — rayado naranja' },
    { value: 'aviso',    label: 'Aviso — ámbar' },
    { value: 'problema', label: 'Problema — rojo' },
    { value: 'info',     label: 'Información — verde de marca' },
    { value: 'bien',     label: 'Todo bien — verde' },
];

export function fetchBannerPortal() {
    return supabase
        .from('banner_portal')
        .select('activo, texto, texto_corto, variante, cambiado_at, cambiado_por')
        .eq('id', 1)
        .maybeSingle();
}

// `null` en un campo significa «no lo toques»: apagar la franja no tiene por
// qué reescribir el texto, y así el que estaba queda listo para la próxima vez.
export function setBannerPortal({ activo, texto = null, textoCorto = null, variante = null }) {
    return supabase.rpc('set_banner_portal', {
        p_activo:      activo,
        p_texto:       texto,
        p_texto_corto: textoCorto,
        p_variante:    variante,
    });
}
