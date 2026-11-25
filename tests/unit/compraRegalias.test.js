import { describe, it, expect } from 'vitest';
import { repartirNotaDeDescuento, resumenMenosNota, totalDelDocumento, codigoDeRegalia } from '../../supabase/functions/_shared/compraSobre.ts';

/* Vijosa, CCF DTE-03-…17567 y su nota DTE-05-…5617 del 2026-11-24. */
const NOV = [
    { codigo: 'VIDEX001-02', cantidad: 30, precio: 4.29, gravada: 114.20 },
    { codigo: 'VIMES003-02', cantidad: 120, precio: 3.55, gravada: 379.85 },
    { codigo: 'VINOM001-02', cantidad: 120, precio: 4.62, gravada: 494.34 },
    { codigo: 'VIULT014-02', cantidad: 130, precio: 5.32, gravada: 622.28 },
    { codigo: 'VIVER004-02', cantidad: 60, precio: 8.80, gravada: 469.66 },
];
const NIVELES = new Map([
    ['VIDEX001-02', { compra: 26, regalo: 4 }],
    ['VIMES003-02', { compra: 100, regalo: 20 }],
    ['VINOM001-02', { compra: 100, regalo: 20 }],
    ['VIULT014-02', { compra: 100, regalo: 30 }],
    ['VIVER004-02', { compra: 51, regalo: 9 }],
]);
const suma = (a) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;

describe('repartirNotaDeDescuento', () => {
    it('Vijosa 24-nov: cada producto lleva sus regalías y el resto va en proporción', () => {
        const r = repartirNotaDeDescuento(NOV, NIVELES, 463.52);
        expect(r.modo).toBe('regalias');
        expect(r.regalo).toEqual([4, 20, 20, 30, 9]);
        expect(r.sinNivel).toEqual([]);
        expect(suma(r.rebajas)).toBe(463.52);
        // Dexa: 4 × 4.29 = 17.16 + su parte de los 44.16 de más (114.20 / 2080.33).
        expect(r.rebajas[0]).toBeCloseTo(17.16 + 44.16 * 114.20 / 2080.33, 1);
        // Ultra: 30 × 5.32 = 159.60 + su parte.
        expect(r.rebajas[3]).toBeCloseTo(159.60 + 44.16 * 622.28 / 2080.33, 1);
    });

    it('Vijosa 6-oct: la nota es sólo regalías y queda como la cargó Bodega (±0.30)', () => {
        const oct = NOV.slice(1, 3).concat(NOV[4]);
        const r = repartirNotaDeDescuento(oct, NIVELES, 242.61);
        expect(suma(r.rebajas)).toBe(242.61);
        // Bodega: −71.29, −92.38, −78.94.
        [71.29, 92.38, 78.94].forEach((b, i) => expect(Math.abs(r.rebajas[i] - b)).toBeLessThan(0.3));
    });

    it('sin niveles anotados, toda la nota va en proporción', () => {
        const r = repartirNotaDeDescuento(NOV, new Map(), 463.52);
        expect(r.modo).toBe('proporcional');
        expect(r.sinNivel).toEqual([0, 1, 2, 3, 4]);
        expect(suma(r.rebajas)).toBe(463.52);
        expect(r.rebajas[1]).toBeCloseTo(463.52 * 379.85 / 2080.33, 1);
    });

    it('regalías mayores que la nota se escalan a la nota', () => {
        const r = repartirNotaDeDescuento(NOV, NIVELES, 200);
        expect(r.modo).toBe('escalado');
        expect(suma(r.rebajas)).toBe(200);
    });

    it('cantidad que no completa un nivel no lleva regalo', () => {
        const r = repartirNotaDeDescuento([{ codigo: 'VIDEX001-02', cantidad: 29, precio: 4.29, gravada: 100 }], NIVELES, 10);
        expect(r.regalo).toEqual([0]);
        expect(r.rebajas).toEqual([10]);
    });

    it('la clave ignora espacios y mayúsculas', () => {
        expect(codigoDeRegalia(' videx001-02 ')).toBe('VIDEX001-02');
    });
});

describe('resumenMenosNota', () => {
    it('Vijosa 24-nov: el total que se carga es el CCF menos la nota', () => {
        const ccf = {
            totalGravada: 2080.33, subTotalVentas: 2080.33, subTotal: 2080.33,
            tributos: [{ codigo: '20', valor: 270.44 }], ivaPerci1: 20.80,
            montoTotalOperacion: 2350.77, totalPagar: 2371.57,
        };
        const nota = { totalGravada: 463.52, tributos: [{ codigo: '20', valor: 60.26 }], ivaPerci1: 4.64, montoTotalOperacion: 528.42 };
        const neto = resumenMenosNota(ccf, nota);
        expect(neto.totalGravada).toBe(1616.81);
        expect(neto.tributos[0].valor).toBe(210.18);
        expect(neto.ivaPerci1).toBe(16.16);
        expect(totalDelDocumento(neto)).toBe(1843.15);
    });
});
