// App de clientes — «Lo tomé» y la replanificación de avisos (2026-11-04).
// lib/tomas.js vive en apps/clientes; acá se prueba con un Notifications falso.
import { existsSync } from 'node:fs';
import { beforeEach, describe as describir, expect, it, vi } from 'vitest';

// Necesita las dependencias de la app (`npm install` en apps/clientes). El CI
// del portal no las instala: ahí se saltea en vez de fallar por un import.
const HAY_APP = existsSync(`${process.cwd()}/apps/clientes/node_modules/expo-notifications/build/index.js`);
const describe = describir.skipIf(!HAY_APP);

const programadas = [];
let siguiente = 1;
vi.mock('../../apps/clientes/node_modules/react-native/index.js', () => ({ Platform: { OS: 'ios' }, AppState: { addEventListener: () => {} } }));
vi.mock('../../apps/clientes/node_modules/expo-file-system/src/legacy/index.ts', () => ({ documentDirectory: null }));
vi.mock('../../apps/clientes/lib/avisos', () => ({ pedirPermisoDeAvisos: async () => true }));
vi.mock('../../apps/clientes/node_modules/expo-notifications/build/index.js', () => ({
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date', TIME_INTERVAL: 'interval' },
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { SECRET: -1 },
  getAllScheduledNotificationsAsync: async () => programadas.map((p) => ({ ...p })),
  cancelScheduledNotificationAsync: async (id) => { const i = programadas.findIndex((p) => p.identifier === id); if (i >= 0) programadas.splice(i, 1); },
  scheduleNotificationAsync: async ({ content, trigger }) => { const identifier = String(siguiente++); programadas.push({ identifier, content, trigger }); return identifier; },
  getPermissionsAsync: async () => ({ status: 'granted' }),
  setNotificationChannelAsync: async () => {},
  setNotificationCategoryAsync: async () => {},
}));

const tomas = HAY_APP ? await import('../../apps/clientes/lib/tomas.js') : {};
const { useTomas, guardarRecordatorio, marcarTomado, tomasDeHoy, replanificar } = tomas;

const base = { product_id: '7', nombre: 'LOSARTAN 50 MG TABLETA', horas: ['08:00', '20:00'], nota: '', modo: 'cada', n: 12, inicio: '08:00', cantidad: 1 };
const fechas = () => programadas.filter((p) => p.trigger.type === 'date').map((p) => p.trigger.date.getHours() + '@' + p.trigger.date.getDate());

beforeEach(() => {
  if (!HAY_APP) return;
  programadas.length = 0;
  useTomas.setState({ config: {}, registro: [], listo: true });
});

describe('«Lo tomé» antes de que suene', () => {
  it('con fin: el aviso de esa toma ya no suena, el siguiente sí', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 7, 15)); // 7:15, la toma es a las 8:00
    await guardarRecordatorio({ ...base, duracion: '3', hasta: '2026-11-06', empieza: '2026-11-04' });
    expect(fechas()).toContain('8@4');
    await marcarTomado('7');
    expect(fechas()).not.toContain('8@4');
    expect(fechas()).toContain('20@4');
    expect(tomasDeHoy(useTomas.getState().registro, '7')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('demasiado temprano cuenta como la toma anterior, no como la próxima', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 5, 0)); // 3 h antes de las 8:00
    await guardarRecordatorio({ ...base, duracion: '3', hasta: '2026-11-06', empieza: '2026-11-03' });
    await marcarTomado('7');
    expect(useTomas.getState().registro[0].t).toBe('2026-11-03 20:00');
    expect(fechas()).toContain('8@4');
    vi.useRealTimers();
  });

  it('dos toques sobre la misma toma cuentan una', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 8, 30));
    await guardarRecordatorio({ ...base, duracion: '3', hasta: '2026-11-06', empieza: '2026-11-04' });
    await marcarTomado('7');
    await marcarTomado('7');
    expect(tomasDeHoy(useTomas.getState().registro, '7')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('uso continuo: salta la de hoy con avisos de fecha y el último pide abrir la app', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 19, 0));
    await guardarRecordatorio({ ...base, duracion: 'continuo', hasta: null });
    expect(programadas.every((p) => p.trigger.type === 'daily')).toBe(true);
    await marcarTomado('7'); // la de las 20:00, adelantada
    expect(programadas.some((p) => p.trigger.type === 'daily')).toBe(false);
    expect(fechas()).not.toContain('20@4');
    expect(fechas()).toContain('8@5');
    const ultima = programadas.filter((p) => p.trigger.type === 'date').sort((a, b) => a.trigger.date - b.trigger.date).at(-1);
    expect(ultima.content.body).toMatch(/Abre Puntos Salud/);
    // Pasada la hora, vuelve a diario.
    vi.setSystemTime(new Date(2026, 10, 4, 21, 0));
    await replanificar();
    expect(programadas.every((p) => p.trigger.type === 'daily')).toBe(true);
    vi.useRealTimers();
  });
});

describe('«Te quedan pocas»', () => {
  it('un diario nunca lo lleva; cerca de acabarse va con fechas, día por día', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 7, 0));
    await guardarRecordatorio({ ...base, duracion: 'continuo', hasta: null, se_acaba: '2026-11-30' });
    expect(programadas.every((p) => p.trigger.type === 'daily' && !/pocas/.test(p.content.body))).toBe(true);
    await guardarRecordatorio({ ...base, duracion: 'continuo', hasta: null, se_acaba: '2026-11-06' });
    expect(programadas.some((p) => p.trigger.type === 'daily')).toBe(false);
    expect(programadas.some((p) => /pocas/.test(p.content.body))).toBe(true);
    vi.useRealTimers();
  });
});

describe('la unidad sale del producto', () => {
  it('cápsula, sobre, tableta', async () => {
    const { cantidadDe } = await import('../../apps/clientes/lib/dosis.js');
    expect(cantidadDe(1, 'OMEPRAZOL 20 MG CAPSULA X 30')).toBe('1 cápsula');
    expect(cantidadDe(2, 'SUERO ORAL SOBRES')).toBe('2 sobres');
    expect(cantidadDe(0.5, 'LOSARTAN 50 MG TAB')).toBe('½ tableta');
  });
});
