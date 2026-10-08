// La única puerta de la app: la función `app-clientes`. No hay cliente de
// Supabase acá a propósito — el cliente no tiene cuenta de Auth ni lee tablas;
// todo pasa por el servidor, que decide la ficha a partir de la sesión.
//
// Nunca lanza: devuelve `{ ok:false, mensaje }` con una frase que se puede
// mostrar. Del otro lado hay un cliente, no un técnico.
import { LECTURAS, guardar, leer, useConexion } from './sinConexion';

const URL_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const LLAVE = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export async function llamar(accion, datos = {}) {
  if (!URL_BASE || !LLAVE) {
    return { ok: false, mensaje: 'La app no está configurada.' };
  }
  const esLectura = LECTURAS.has(accion);
  try {
    // Una lectura con señal mala no puede colgar la pantalla: a los 12 s se
    // corta y se muestra lo guardado.
    const control = esLectura && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const reloj = control ? setTimeout(() => control.abort(), 12_000) : null;
    const r = await fetch(`${URL_BASE}/functions/v1/app-clientes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: LLAVE },
      body: JSON.stringify({ accion, ...datos }),
      signal: control?.signal,
    }).finally(() => { if (reloj) clearTimeout(reloj); });
    const cuerpo = await r.json().catch(() => null);
    // La sesión se da por terminada SÓLO si la función lo dice. Un 401 a secas
    // puede venir del gateway (una llave rotada, un redeploy con JWT) y no
    // significa que este cliente perdió su sesión: tratarlo así borraba el
    // token de TODOS los teléfonos a la vez.
    if (cuerpo?.motivo === 'sin_sesion') {
      return { ok: false, sinSesion: true, mensaje: 'Tu sesión terminó. Vuelve a entrar.' };
    }
    if (!cuerpo) return { ok: false, mensaje: 'No se pudo consultar. Intenta en un rato.' };
    useConexion.getState().marcar(false);
    guardar(accion, datos, cuerpo);
    return cuerpo;
  } catch {
    // Sin red: lo último que se vio, marcado como guardado.
    const guardado = await leer(accion, datos);
    useConexion.getState().marcar(true, guardado?.guardadoEn ?? null);
    return guardado ?? { ok: false, sinConexion: true, mensaje: 'Sin conexión. Revisa tu señal e intenta de nuevo.' };
  }
}
