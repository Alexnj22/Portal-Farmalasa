import { describe, it, expect } from 'vitest';
import { antiguedadDePersona } from '@nucleo/utils/alertasDePersona';

const hoy = '2026-10-26';
const de = (hire_date) => antiguedadDePersona({ hire_date }, hoy);

describe('antiguedadDePersona', () => {
  it('sin fecha o con menos de un año no hay tramo', () => {
    expect(antiguedadDePersona({}, hoy)).toBeNull();
    expect(de('2026-01-10')).toBeNull();
    expect(de('2025-10-27')).toBeNull(); // le falta un día
  });
  it('cuenta años CUMPLIDOS, no la resta de los años', () => {
    expect(de('2025-10-26').anios).toBe(1);
    expect(de('2020-11-01').anios).toBe(5);
    expect(de('2020-10-26').anios).toBe(6);
  });
  it('los cuatro tramos y sus bordes', () => {
    expect(de('2021-10-26').tramo).toBe('bronce');  // 5
    expect(de('2020-10-26').tramo).toBe('plata');   // 6
    expect(de('2016-10-26').tramo).toBe('plata');   // 10
    expect(de('2015-10-26').tramo).toBe('oro');     // 11
    expect(de('2011-10-26').tramo).toBe('oro');     // 15
    expect(de('2010-10-26').tramo).toBe('platino'); // 16
  });
  it('acepta un timestamp como fecha de ingreso', () => {
    expect(de('2015-03-02T00:00:00+00:00')).toEqual({ anios: 11, tramo: 'oro', desde: '2015-03-02' });
  });
});
