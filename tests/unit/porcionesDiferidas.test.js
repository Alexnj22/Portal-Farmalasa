// Las listas de `porcionesDiferidas.js` tienen que coincidir con la porción
// real: una acción que falte allá quedaría `undefined` en el store.
import { describe, it, expect } from 'vitest';
import { SOLICITUDES, PLANILLA, PLAN_VACACIONES, CONTEO_INVENTARIO, PRACTICANTES, porcionDiferida } from '@nucleo/store/porcionesDiferidas';
import { createPayrollSlice } from '@nucleo/store/slices/payrollSlice';
import { createVacationPlanSlice } from '@nucleo/store/slices/vacationPlanSlice';
import { createConteoInventarioSlice } from '@nucleo/store/slices/conteoInventarioSlice';
import { createPracticantesSlice } from '@nucleo/store/slices/practicantesSlice';
import { createRequestsSlice } from '@nucleo/store/slices/requestsAcciones';

const partes = (porcion) => {
  const estado = {}; const acciones = [];
  for (const [k, v] of Object.entries(porcion)) (typeof v === 'function' ? acciones.push(k) : (estado[k] = v));
  return { estado, acciones: acciones.sort() };
};

describe.each([
  ['planilla', PLANILLA, createPayrollSlice],
  ['plan de vacaciones', PLAN_VACACIONES, createVacationPlanSlice],
  ['conteo de inventario', CONTEO_INVENTARIO, createConteoInventarioSlice],
  ['practicantes', PRACTICANTES, createPracticantesSlice],
  ['solicitudes', SOLICITUDES, createRequestsSlice],
])('porción diferida: %s', (_, declarada, crear) => {
  const real = partes(crear(() => {}, () => ({})));
  it('declara las mismas acciones que la porción real', () => {
    expect([...declarada.acciones, ...(declarada.internas ?? [])].sort()).toEqual(real.acciones);
  });
  it('nace con el mismo estado inicial', () => {
    expect(declarada.estado).toEqual(real.estado);
  });
});

describe('porcionDiferida', () => {
  it('carga la porción real una sola vez y le pasa la llamada', async () => {
    let cargas = 0;
    const crear = () => ({ sumar: async (a, b) => a + b, doble: async (x) => x * 2 });
    const porcion = porcionDiferida(async () => { cargas += 1; return crear; }, { n: 0 }, ['sumar', 'doble'])(() => {}, () => ({}));
    expect(porcion.n).toBe(0);
    expect(await porcion.sumar(2, 3)).toBe(5);
    expect(await porcion.doble(4)).toBe(8);
    expect(cargas).toBe(1);
  });
  it('instala las internas en el store al cargar', async () => {
    let estado = {};
    const set = (parcial) => { estado = { ...estado, ...parcial }; };
    const crear = (_s, get) => ({ _ayuda: (x) => x + 1, usar: async (x) => get()._ayuda(x) });
    const porcion = porcionDiferida(async () => crear, {}, ['usar'], ['_ayuda'])(set, () => estado);
    expect(await porcion.usar(1)).toBe(2);
    expect(typeof estado._ayuda).toBe('function');
  });
  it('si la carga falla, la próxima llamada vuelve a intentar', async () => {
    let intento = 0;
    const porcion = porcionDiferida(async () => {
      intento += 1;
      if (intento === 1) throw new Error('sin red');
      return () => ({ uno: async () => 1 });
    }, {}, ['uno'])(() => {}, () => ({}));
    await expect(porcion.uno()).rejects.toThrow('sin red');
    expect(await porcion.uno()).toBe(1);
  });
});
