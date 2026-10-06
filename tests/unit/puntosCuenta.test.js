import { describe, expect, it } from 'vitest';
import { cambioContraAnterior, mesesDeCuenta, movimientoPasaFiltro, partesDelReparto, repartoDeCuenta, serieDeVencimientos } from '@nucleo/utils/puntosCuenta';

const movs = [
    { tipo: 'compra', puntos: 300, fecha: '2026-08-03' },
    { tipo: 'canje', puntos: -100, fecha: '2026-08-20' },
    { tipo: 'compra', puntos: 200, fecha: '2026-09-02' },
    { tipo: 'vencimiento', puntos: -50, fecha: '2026-09-30' },
    { tipo: 'anulacion', puntos: -20, fecha: '2026-09-30' },
];

describe('puntosCuenta', () => {
    it('reparte lo usado por tipo', () => {
        expect(repartoDeCuenta(movs)).toEqual({ canjeado: 100, vencido: 50, anulado: 20 });
    });
    it('las partes del reparto suman sobre lo ganado y omiten los ceros', () => {
        const p = partesDelReparto({ ganados: 500, saldo: 330, canjeado: 100, vencido: 50, anulado: 20 });
        expect(p.map((x) => x.clave)).toEqual(['saldo', 'canjeado', 'vencido', 'anulado']);
        expect(p[0].pct).toBe(66);
        expect(partesDelReparto({ ganados: 0, saldo: 0, canjeado: 0, vencido: 0, anulado: 0 })).toEqual([]);
    });
    it('reconstruye el saldo de cada mes hacia atrás desde el de hoy', () => {
        const m = mesesDeCuenta(movs, 330);
        expect(m.map((x) => x.mes)).toEqual(['2026-08', '2026-09']);
        expect(m[1].saldo).toBe(330);
        expect(m[0].saldo).toBe(200);          // 330 − (200 − 50 − 20)
        expect(m[0]).toMatchObject({ acumulado: 300, canjeado: 100 });
    });
    it('filtra por tipo y por mes', () => {
        expect(movs.filter((x) => movimientoPasaFiltro(x, 'entran')).length).toBe(2);
        expect(movs.filter((x) => movimientoPasaFiltro(x, 'salen')).length).toBe(1);
        expect(movs.filter((x) => movimientoPasaFiltro(x, 'todos', '2026-09')).length).toBe(3);
    });
    it('los vencimientos rellenan los meses vacíos hasta el último', () => {
        const s = serieDeVencimientos([{ mes: '2026-12-01', puntos: 80, clientes: 2 }], '2026-10-06');
        expect(s.map((x) => x.clave)).toEqual(['2026-10', '2026-11', '2026-12']);
        expect(s[2]).toMatchObject({ puntos: 80, clientes: 2 });
        expect(s[0].puntos).toBe(0);
    });
    it('el cambio contra el mes anterior', () => {
        expect(cambioContraAnterior(110, 100, 'sep')).toBe('+10% vs. sep');
        expect(cambioContraAnterior(90, 100, 'sep')).toBe('−10% vs. sep');
        expect(cambioContraAnterior(90, 0, 'sep')).toBeNull();
    });
});
