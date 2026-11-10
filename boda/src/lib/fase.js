import { boda, fechaBoda } from '../config';
import { ahora as reloj, faseFingida } from './reloj';

export const FASES = ['save-the-date', 'invitacion', 'boda', 'recuerdos'];

/** Fase vigente. `?fase=` en la dirección gana (para previsualizar); después, la del panel de pruebas. */
export function faseActual(ahora = reloj()) {
  const q = new URLSearchParams(window.location.search).get('fase');
  if (FASES.includes(q)) return q;
  if (FASES.includes(faseFingida())) return faseFingida();
  if (boda.fase !== 'auto') return boda.fase;
  const desde = new Date(`${boda.invitacionesDesde}T00:00:00`);
  const inicioDia = new Date(fechaBoda); inicioDia.setHours(0, 0, 0, 0);
  const finFiesta = new Date(inicioDia); finFiesta.setDate(finFiesta.getDate() + 2);
  if (ahora < desde) return 'save-the-date';
  if (ahora < inicioDia) return 'invitacion';
  if (ahora < finFiesta) return 'boda';
  return 'recuerdos';
}

export const faseAlMenos = (fase, minima) => FASES.indexOf(fase) >= FASES.indexOf(minima);
