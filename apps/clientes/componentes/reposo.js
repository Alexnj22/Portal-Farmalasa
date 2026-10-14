// El REPOSO de lo que se anima solo (2026-10-14, «el teléfono se calienta
// después de un rato»). La tarjeta de socio, el cupón y la aurora corrían sin
// parar mientras se vieran: un shader a pantalla de tarjeta 60–120 veces por
// segundo, el giroscopio y resortes que nunca se asentaban. Mirar el saldo un
// minuto sin tocar nada era un minuto de GPU al máximo.
//
// Regla: lo decorativo se mueve mientras la persona interactúa y hasta
// `REPOSO_MS` después. Pasado eso se queda quieto donde está (se ve igual,
// sólo deja de animarse) y despierta al tocar la pantalla o al inclinar el
// teléfono. Los toques los avisa la raíz (app/_layout.js, `onTouchStart`).
import { useEffect, useState } from 'react';

export const REPOSO_MS = 20_000;
const oyentes = new Set();
let ultimo = 0;

/** Hubo interacción: todo lo que estaba en reposo vuelve a moverse. */
export function despertar() {
  const ahora = Date.now();
  // Un dedo que arrastra dispara muchos eventos: con uno por medio segundo alcanza.
  if (ahora - ultimo < 500) return;
  ultimo = ahora;
  oyentes.forEach((f) => f());
}

/** `true` mientras `activa` y hubo interacción en los últimos `ms`. */
export function useDespierta(activa, ms = REPOSO_MS) {
  const [despierta, setDespierta] = useState(true);
  useEffect(() => {
    if (!activa) return undefined;
    let reloj = null;
    const armar = () => {
      setDespierta(true);
      clearTimeout(reloj);
      reloj = setTimeout(() => setDespierta(false), ms);
    };
    armar();
    oyentes.add(armar);
    return () => { oyentes.delete(armar); clearTimeout(reloj); };
  }, [activa, ms]);
  return !!activa && despierta;
}
