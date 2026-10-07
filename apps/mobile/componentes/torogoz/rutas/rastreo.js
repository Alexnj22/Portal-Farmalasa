// El rastreo de la ruta en la APP. La regla (qué es «en ruta», la primera
// posición enseguida y después una por minuto) es la del núcleo
// (`data/distribucionRastreo.js`), la misma del portal; acá sólo se decide
// QUIÉN la mantiene viva.
//
// En el portal la monta el marco de Torogoz. La app no tiene marco: cada
// pantalla es suya. Por eso el rastreo es UNO por teléfono, fuera de React —
// cualquier pantalla de Torogoz que lo pida lo arranca si hace falta, y salir
// de la pantalla no lo detiene. Sólo lo detiene «Terminar ruta» (o el cambio
// de día). Mide en primer plano: con la app cerrada no anota, y se dice así.
import { useEffect, useSyncExternalStore } from 'react';
import { arrancarRastreo, escucharEnRuta, estaEnRuta, marcarEnRuta } from '@nucleo/data/distribucionRastreo';

let activo = null;          // { yo, detener }
let problema = null;        // 'denegado' | 'sin-senal' | 'sin-gps' | null
const oyentes = new Set();
const avisar = () => { for (const f of [...oyentes]) f(); };

function ponerProblema(p) {
  if (p === problema) return;
  problema = p;
  avisar();
}

/** Deja el rastreo como dice el estado guardado: corriendo si está en ruta hoy. */
export function sincronizarRastreo(yo) {
  const debe = !!yo && estaEnRuta(yo);
  if (activo && (!debe || activo.yo !== yo)) {
    activo.detener();
    activo = null;
    ponerProblema(null);
  }
  if (debe && !activo) {
    activo = { yo, detener: arrancarRastreo({ mensaje: 'Ruta de Torogoz activa.', alProblema: ponerProblema }) };
  }
}

export function iniciarRuta(yo) { marcarEnRuta(yo, true); sincronizarRastreo(yo); }
export function terminarRuta(yo) { marcarEnRuta(yo, false); sincronizarRastreo(yo); }

const suscribir = (f) => {
  oyentes.add(f);
  const dejar = escucharEnRuta(f);
  return () => { oyentes.delete(f); dejar(); };
};

/**
 * Lo usa toda pantalla de Torogoz donde se vende o se visita: mantiene vivo el
 * rastreo si el teléfono está en ruta, y dice el estado para pintarlo.
 */
export function useRastreoDeRuta(yo) {
  const enRuta = useSyncExternalStore(suscribir, () => estaEnRuta(yo), () => false);
  const motivo = useSyncExternalStore(suscribir, () => problema, () => null);
  useEffect(() => { sincronizarRastreo(yo); }, [yo, enRuta]);
  return { enRuta, problema: enRuta ? motivo : null };
}
