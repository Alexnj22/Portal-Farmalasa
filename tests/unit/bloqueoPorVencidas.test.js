import { describe, expect, it } from 'vitest';
import { bloqueoPorVencidas } from '../../supabase/functions/_shared/reservasBloqueo.ts';

const v = (fecha, pedido = null, id = Math.random()) => ({ cerrada_at: `${fecha}T18:00:00Z`, pedido, id });
const en = (fecha) => Date.parse(`${fecha}T18:00:00Z`);

describe('bloqueo por reservas vencidas (reglamento de reservas 3.7)', () => {
  it('dura 30 días desde la TERCERA, no mientras queden tres en la ventana', () => {
    const tres = [v('2026-11-16'), v('2026-11-17'), v('2026-12-14')];
    // con la regla vieja caía el 16-dic; hoy dura hasta el 13-ene
    expect(bloqueoPorVencidas(tres, true, en('2026-12-20'))?.toISOString().slice(0, 10)).toBe('2027-01-13');
    expect(bloqueoPorVencidas(tres, true, en('2027-01-14'))).toBeNull();
  });

  it('tres seguidas bloquean 30 días desde la última', () => {
    const tres = [v('2026-11-16'), v('2026-11-17'), v('2026-11-18')];
    expect(bloqueoPorVencidas(tres, true, en('2026-12-17'))?.toISOString().slice(0, 10)).toBe('2026-12-18');
  });

  it('tres que no caben en 30 días no bloquean', () => {
    expect(bloqueoPorVencidas([v('2026-11-16'), v('2026-11-30'), v('2026-12-17')], true, en('2026-12-18'))).toBeNull();
  });

  it('un pedido de varios productos cuenta como una sola', () => {
    const p = [v('2026-11-16', 'P-A'), v('2026-11-16', 'P-A'), v('2026-11-17', 'P-A')];
    expect(bloqueoPorVencidas(p, true, en('2026-11-18'))).toBeNull();
    expect(bloqueoPorVencidas([...p, v('2026-11-18'), v('2026-11-19')], true, en('2026-11-20'))).not.toBeNull();
  });

  it('antes del v2 sigue la regla vieja: tres en los últimos 30 días', () => {
    const tres = [v('2026-10-01'), v('2026-10-02'), v('2026-10-29')];
    expect(bloqueoPorVencidas(tres, false, en('2026-10-30'))).not.toBeNull();
    expect(bloqueoPorVencidas(tres, false, en('2026-11-01'))).toBeNull();
  });
});
