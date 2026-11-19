import { useEffect, useState } from 'react';
import { boda, fechaBoda } from '../config';
import { ahora as reloj, faseFingida } from './reloj';

export const FASES = ['save-the-date', 'invitacion', 'boda', 'recuerdos'];
const TZ = boda.zonaHoraria || 'America/El_Salvador';

// ── Horas del LUGAR de la boda ──────────────────────────────────────────────
// Los cambios de fase son a medianoche de El Salvador, no del teléfono: un
// invitado en Madrid no puede ver «Hoy nos casamos» siete horas antes.
const partesEn = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
}).formatToParts(d).map((p) => [p.type, p.value]));
/** Minutos que el lugar va por delante de UTC en ese instante (El Salvador: −360). */
function desfaseMin(d) {
  const p = partesEn(d);
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(d.getTime() / 1000) * 1000) / 6e4;
}
/** 'AAAA-MM-DD' + días → la medianoche de ese día en el lugar, como Date. */
export function medianocheLugar(aaaammdd, mas = 0) {
  const [y, m, d] = aaaammdd.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d + mas));
  return new Date(guess.getTime() - desfaseMin(guess) * 6e4);
}
/** Hora (0–23) en el lugar de la boda. */
export const horaLugar = (d = reloj()) => +partesEn(d).hour % 24;
const diaBoda = fechaBoda.toLocaleDateString('en-CA', { timeZone: TZ });

// `?fase=` se recuerda en la pestaña: al pasar de /?fase=boda a /hoy la
// previsualización sigue siendo la misma.
const K_Q = 'boda-fase-q';
function faseDeLaDireccion() {
  try {
    const q = new URLSearchParams(window.location.search).get('fase');
    if (FASES.includes(q)) { sessionStorage.setItem(K_Q, q); return q; }
    if (q === 'auto') { sessionStorage.removeItem(K_Q); return ''; }
    const s = sessionStorage.getItem(K_Q);
    return FASES.includes(s) ? s : '';
  } catch { return ''; }
}

const limites = () => [
  ['invitacion', medianocheLugar(boda.invitacionesDesde)],
  ['boda', medianocheLugar(diaBoda)],
  ['recuerdos', medianocheLugar(diaBoda, 2)],
];

/** Fase vigente. `?fase=` en la dirección gana (para previsualizar); después, la del panel de pruebas. */
export function faseActual(ahora = reloj()) {
  const q = faseDeLaDireccion();
  if (q) return q;
  if (FASES.includes(faseFingida())) return faseFingida();
  if (boda.fase !== 'auto') return boda.fase;
  let fase = 'save-the-date';
  for (const [f, desde] of limites()) if (ahora >= desde) fase = f;
  return fase;
}

export const faseAlMenos = (fase, minima) => FASES.indexOf(fase) >= FASES.indexOf(minima);

/** ¿Va el tema nocturno? El día de la boda desde las 6 p. m. del lugar (o si el teléfono está en modo oscuro). */
export function esNoche(fase = faseActual(), ahora = reloj()) {
  if (fase !== 'boda') return false;
  const h = horaLugar(ahora);
  const oscuro = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return h >= 18 || h < 6 || !!oscuro;
}

/** Milisegundos hasta el próximo cambio que importa (fase o las 6 p. m. del día de la boda). */
function msAlProximoCambio(ahora = reloj()) {
  const marcas = limites().map(([, d]) => d.getTime());
  marcas.push(medianocheLugar(diaBoda).getTime() + 18 * 36e5, medianocheLugar(diaBoda, 1).getTime() + 6 * 36e5, medianocheLugar(diaBoda, 1).getTime() + 18 * 36e5);
  const futuras = marcas.filter((m) => m > ahora.getTime());
  return futuras.length ? Math.min(...futuras) - ahora.getTime() + 1000 : null;
}

/**
 * La fase (y el tema) que se recalculan solos si la página queda abierta:
 * un temporizador al próximo cambio, y otra revisión al volver a la pestaña
 * (el teléfono congela los temporizadores con la pantalla apagada).
 */
export function useFase() {
  const [estado, setEstado] = useState(() => ({ fase: faseActual(), noche: esNoche() }));
  useEffect(() => {
    let reloj1 = 0;
    const revisar = () => {
      const fase = faseActual();
      const noche = esNoche(fase);
      setEstado((e) => (e.fase === fase && e.noche === noche ? e : { fase, noche }));
      clearTimeout(reloj1);
      const ms = msAlProximoCambio();
      // setTimeout no acepta más de ~24 días: se revisa de nuevo antes.
      if (ms != null) reloj1 = setTimeout(revisar, Math.min(ms, 2 ** 31 - 1));
    };
    revisar();
    const alVolver = () => { if (document.visibilityState === 'visible') revisar(); };
    document.addEventListener('visibilitychange', alVolver);
    const oscuro = window.matchMedia?.('(prefers-color-scheme: dark)');
    oscuro?.addEventListener?.('change', revisar);
    return () => { clearTimeout(reloj1); document.removeEventListener('visibilitychange', alVolver); oscuro?.removeEventListener?.('change', revisar); };
  }, []);
  return estado;
}
