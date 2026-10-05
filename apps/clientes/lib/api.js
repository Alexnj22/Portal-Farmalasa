// La única puerta de la app: la función `app-clientes`. No hay cliente de
// Supabase acá a propósito — el cliente no tiene cuenta de Auth ni lee tablas;
// todo pasa por el servidor, que decide la ficha a partir de la sesión.
//
// Nunca lanza: devuelve `{ ok:false, mensaje }` con una frase que se puede
// mostrar. Del otro lado hay un cliente, no un técnico.
const URL_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const LLAVE = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export async function llamar(accion, datos = {}) {
  if (!URL_BASE || !LLAVE) {
    return { ok: false, mensaje: 'La app no está configurada.' };
  }
  try {
    const r = await fetch(`${URL_BASE}/functions/v1/app-clientes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: LLAVE },
      body: JSON.stringify({ accion, ...datos }),
    });
    const cuerpo = await r.json().catch(() => null);
    if (r.status === 401 || cuerpo?.motivo === 'sin_sesion') {
      return { ok: false, sinSesion: true, mensaje: 'Tu sesión terminó. Vuelve a entrar.' };
    }
    if (!cuerpo) return { ok: false, mensaje: 'No se pudo consultar. Intenta en un rato.' };
    return cuerpo;
  } catch {
    return { ok: false, mensaje: 'Sin conexión. Revisa tu señal e intenta de nuevo.' };
  }
}
