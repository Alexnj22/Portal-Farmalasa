// El sonido en el NAVEGADOR (2026-11-14).
//
// En el iPhone, Safari apaga el audio de una página con el interruptor de
// silencio puesto, y no hay forma de que la página sepa que está puesto: los
// juegos y los sonidos de Bienestar sonaban mudos sin avisar. Desde Safari 17,
// `navigator.audioSession.type = 'playback'` le dice que es audio que la
// persona pidió (lo mismo que hace la app con la categoría `playback`): suena
// aunque el teléfono esté en silencio.
//
// Y en el navegador el sonido no sigue de fondo: al cambiar de pestaña o de
// app, o al bloquear, se pausa (`alOcultar`).
import { Platform } from 'react-native';

export const WEB = Platform.OS === 'web' && typeof document !== 'undefined';

export function sonidoAPropositoWeb() {
  if (!WEB) return;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari viejo: respeta el silencio */ }
}

export function alOcultar(fn) {
  if (!WEB) return;
  document.addEventListener('visibilitychange', () => { if (document.hidden) fn(); });
  window.addEventListener('pagehide', fn);
}
