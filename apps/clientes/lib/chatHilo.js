// El último hilo del chat, en MEMORIA y por sesión (2026-10-14).
//
// «Aún tarda un poco al abrir, no se siente inmediato como WhatsApp,
// iMessage». La espera de la PRIMERA apertura era la red: la pantalla nacía
// sin nada, pintaba el esqueleto y esperaba `chat_mensajes` (300–900 ms con
// buena señal, varios segundos con mala) antes del primer globo. Las
// siguientes ya salían de memoria, pero la primera —la que el cliente nota—
// siempre esperaba.
//
// Ahora el hilo se PRECARGA antes de que el cliente lo pida: cuando la burbuja
// del chat aparece (componentes/BurbujaChat, después de las interacciones) y
// cada vez que llega una respuesta nueva. Al tocar la burbuja, la pantalla
// pinta el hilo en el PRIMER cuadro, sin esperar nada; lo nuevo se pide
// después de la transición.
//
// No va al disco: son conversaciones. Precargar NO marca leído (eso lo hace la
// pantalla al abrir, con `chat_leido`), así que `sinLeer` viaja con el hilo
// para poner la franja «N mensajes nuevos» en su lugar.
import { useSesion } from './sesion';

const DIAS_PRIMERA = 3;
export const desdeFechaPrimera = () => new Date(Date.now() - DIAS_PRIMERA * 86400_000).toISOString();

// { token, mensajes, hayMas, fuera, horario, conversacion, sinLeer, vivo, en }
let HILO = null;
let enCurso = null;
// Con la pantalla del chat abierta, ella es la dueña del hilo: la precarga no lo pisa.
let abierto = false;

export const leerHilo = (token) => (HILO && token && HILO.token === token ? HILO : null);
export const guardarHilo = (h) => { HILO = h; };
export const chatAbierto = (v) => { abierto = !!v; };

/** La respuesta de una carga completa, como hilo en memoria. */
export function hiloDeRespuesta(token, r) {
  return {
    token, mensajes: r.mensajes ?? [], hayMas: !!r.hay_mas, fuera: !!r.fuera_de_horario, horario: r.horario ?? null,
    conversacion: r.conversacion ?? null, sinLeer: Number(r.sin_leer) || 0, vivo: r.vivo ?? null, en: Date.now(),
  };
}

/**
 * Trae el hilo a memoria si no está, o lo renueva si el resumen dice que hay
 * más respuestas sin leer que las que el hilo conoce (`sinLeer`). Nunca lanza
 * y nunca hay dos a la vez.
 */
export function precargarChat({ sinLeer = 0 } = {}) {
  const { token, pedir } = useSesion.getState();
  if (!token || abierto || enCurso) return enCurso;
  const h = leerHilo(token);
  if (h && !(sinLeer > h.sinLeer)) return null;
  enCurso = pedir('chat_mensajes', { desde_fecha: desdeFechaPrimera() })
    .then((r) => {
      // Mientras tanto se abrió el chat o cambió la sesión: no se pisa nada.
      if (!r?.ok || r.pendiente || abierto || useSesion.getState().token !== token) return;
      HILO = hiloDeRespuesta(token, r);
    })
    .catch(() => {})
    .finally(() => { enCurso = null; });
  return enCurso;
}
