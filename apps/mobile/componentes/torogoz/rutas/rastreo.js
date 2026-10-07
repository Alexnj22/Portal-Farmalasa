// El rastreo de la ruta en la APP. La regla (qué es «en ruta», la primera
// posición enseguida y después una por minuto) es la del núcleo
// (`data/distribucionRastreo.js`), la misma del portal; acá sólo se decide
// QUIÉN la mantiene viva.
//
// Desde el 2026-10-07 la mide la tarea de FONDO (`plataforma/rastreoDeFondo.js`):
// con el permiso «siempre», «Iniciar ruta» la deja corriendo aunque la app se
// cierre o el teléfono se bloquee, hasta «Terminar ruta» o el cambio de día. Si
// la persona sólo da «mientras se usa», queda el rastreo de antes —uno por
// teléfono, fuera de React, mientras la app está abierta— como respaldo. Nunca
// los dos a la vez: con el fondo corriendo, la pantalla no escribe.
import { useEffect, useSyncExternalStore } from 'react';
import { arrancarRastreo, escucharEnRuta, estaEnRuta, marcarEnRuta } from '@nucleo/data/distribucionRastreo';
import { activarRutaDeFondo, escucharFondo, fondoActivo, quitarRutaDeFondo } from '../../../plataforma/rastreoDeFondo';

let activo = null;          // { yo, detener }
let problema = null;        // 'denegado' | 'sin-senal' | 'sin-gps' | null
let sinFondo = null;        // por qué no corre con la app cerrada: 'en-uso' | 'denegado' | 'sin-fondo' | null
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
  // Con la tarea de fondo corriendo, la de primer plano no escribe (sin duplicados).
  const fondo = debe && fondoActivo('torogoz');
  if (activo && (!debe || activo.yo !== yo || activo.fondo !== fondo)) {
    activo.detener();
    activo = null;
    ponerProblema(null);
  }
  if (!debe && fondoActivo('torogoz')) Promise.resolve(quitarRutaDeFondo('torogoz')).catch(() => {});
  if (debe && !activo) {
    activo = fondo
      ? { yo, fondo: true, detener: () => {} }
      : { yo, fondo: false, detener: arrancarRastreo({ mensaje: 'Ruta de Torogoz activa.', alProblema: ponerProblema }) };
  }
}

/**
 * Inicia la ruta: pide la ubicación «siempre» y arranca el rastreo de fondo.
 * Devuelve 'fondo' o el motivo por el que sólo mide con la app abierta.
 */
export async function iniciarRuta(yo) {
  marcarEnRuta(yo, true);
  const r = await activarRutaDeFondo('torogoz', { yo });
  sinFondo = r === 'fondo' ? null : r;
  sincronizarRastreo(yo);
  avisar();
  return r;
}

export async function terminarRuta(yo) {
  marcarEnRuta(yo, false);
  sinFondo = null;
  await quitarRutaDeFondo('torogoz');
  sincronizarRastreo(yo);
  avisar();
}

const suscribir = (f) => {
  oyentes.add(f);
  const dejar = escucharEnRuta(f);
  const dejarFondo = escucharFondo(f);
  return () => { oyentes.delete(f); dejar(); dejarFondo(); };
};

/**
 * Lo usa toda pantalla de Torogoz donde se vende o se visita: mantiene vivo el
 * rastreo si el teléfono está en ruta, y dice el estado para pintarlo.
 */
export function useRastreoDeRuta(yo) {
  const enRuta = useSyncExternalStore(suscribir, () => estaEnRuta(yo), () => false);
  const motivo = useSyncExternalStore(suscribir, () => problema, () => null);
  const fondo = useSyncExternalStore(suscribir, () => fondoActivo('torogoz'), () => false);
  const motivoSinFondo = useSyncExternalStore(suscribir, () => sinFondo, () => null);
  useEffect(() => { sincronizarRastreo(yo); }, [yo, enRuta, fondo]);
  return { enRuta, fondo: enRuta && fondo, sinFondo: enRuta && !fondo ? (motivoSinFondo ?? 'en-uso') : null, problema: enRuta ? motivo : null };
}
