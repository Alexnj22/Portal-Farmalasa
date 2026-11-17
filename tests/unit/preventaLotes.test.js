import { describe, it, expect } from 'vitest';
import { lotesQueSalen, mesDeVencimiento, vencePronto } from '@nucleo/utils/preventaDirecta';

describe('lotesQueSalen', () => {
    const lotes = [{ lote: 'GENERICO', unidades: 5 }, { lote: 'A1', unidades: 10 }, { lote: 'B2', unidades: 3 }];
    it('toma del primero y sigue con el siguiente', () => {
        expect(lotesQueSalen(lotes, 8).map((l) => l.toma)).toEqual([5, 3, 0]);
    });
    it('sin pedir nada, no toma', () => {
        expect(lotesQueSalen(lotes, 0).map((l) => l.toma)).toEqual([0, 0, 0]);
    });
    it('si no alcanza, toma todo', () => {
        expect(lotesQueSalen(lotes, 99).map((l) => l.toma)).toEqual([5, 10, 3]);
    });
});

describe('vencimiento', () => {
    it('mes y año', () => { expect(mesDeVencimiento('2026-08-01')).toBe('08/2026'); expect(mesDeVencimiento(null)).toBe('—'); });
    it('pronto = menos de 90 días', () => {
        expect(vencePronto('2026-12-01', '2026-11-16')).toBe(true);
        expect(vencePronto('2027-06-01', '2026-11-16')).toBe(false);
    });
});

import { planDeLotes, queCompletar } from '@nucleo/utils/preventaDirecta';

describe('planDeLotes', () => {
    const lotes = [{ lote: 'GENERICO', vence: null, unidades: 6 }, { lote: 'A1', vence: '2028-03-01', unidades: 14 }];
    it('cajas enteras de cada lote, en orden', () => {
        const p = planDeLotes(lotes, 1, 10);
        expect(p.lotes.map((l) => [l.enteras, l.sueltas])).toEqual([[0, 0], [1, 0]]);
        expect(p.armada).toBe(false);
    });
    it('la caja que ningún lote completa se arma con dos', () => {
        const p = planDeLotes(lotes, 2, 10);
        expect(p.lotes.map((l) => [l.enteras, l.sueltas])).toEqual([[0, 6], [1, 4]]);
        expect(p.armada).toBe(true);
        expect(p.faltan).toBe(0);
    });
    it('el lote elegido va primero', () => {
        const p = planDeLotes(lotes, 3, 1, { lote: 'A1', vence: '2028-03-01' });
        expect(p.lotes[0].lote).toBe('A1');
        expect(p.lotes[0].enteras).toBe(3);
    });
    it('si no alcanza, dice cuánto falta', () => {
        expect(planDeLotes(lotes, 3, 10).faltan).toBe(2);  // como caja: no arma a medias
    });
});

describe('queCompletar', () => {
    it('crédito fiscal pide la categoría si no es contribuyente', () => {
        const q = queCompletar('credito_fiscal', { categoria: 'Consumidor' });
        expect(q.categoria).toBe('Contribuyente');
        expect(q.campos).toEqual([]);
    });
    it('factura pide DUI sólo si no tiene ni DUI ni NIT', () => {
        expect(queCompletar('consumidor_final', { nit: '0614' }).campos).not.toContain('dui');
        expect(queCompletar('consumidor_final', { categoria: 'Consumidor', dui: '1' }).campos).toEqual(['phone']);
    });
});

import { opcionesDePresentacion, lineasParaCotizar } from '@nucleo/utils/preventaDirecta';

describe('opcionesDePresentacion', () => {
    const fila = { id_presentacion: 227, presentaciones: [
        { factor: 10, tipo: 'BLISTER', id_presentacion: 36, vineta: 1.06 },
        { factor: 100, tipo: 'CAJA', id_presentacion: 227, vineta: 10.65 },
        { factor: 100, tipo: 'CAJA', id_presentacion: 9, vineta: 10.61 },
    ] };
    it('dos viñetas del mismo empaque salen las dos', () => {
        const o = opcionesDePresentacion(fila, { factor: 100 });
        expect(o.options.map((x) => x.label)).toEqual(['BLISTER', 'CAJA $10.65', 'CAJA $10.61']);
        expect(o.value).toBe('100:227');
    });
    it('elegir la otra viñeta la pide a la base', () => {
        const o = opcionesDePresentacion(fila, { factor: 100 });
        const c = o.leer('100:9');
        expect(c).toEqual({ factor: 100, presentacion: 9 });
        expect(lineasParaCotizar([{ producto_id: 1, cantidad: 1, ...c }])[0].presentacion).toBe(9);
    });
    it('una sola por empaque no lleva id', () => {
        expect(opcionesDePresentacion(fila, { factor: 10 }).leer('10')).toEqual({ factor: 10, presentacion: null });
    });
});

describe('opcionesDePresentacion con viñetas iguales', () => {
    it('la misma viñeta dos veces sale una sola vez', () => {
        const fila = { presentaciones: [
            { factor: 30, tipo: 'CAJA', id_presentacion: 9, vineta: 33 },
            { factor: 30, tipo: 'CAJA', id_presentacion: 227, vineta: 33 },
        ] };
        const o = opcionesDePresentacion(fila, { factor: 30 });
        expect(o.options).toEqual([{ value: '30', label: 'CAJA' }]);
        expect(o.leer('30')).toEqual({ factor: 30, presentacion: null });
    });
});

import { montoDelCorreo } from '@nucleo/utils/preventaDirecta';

describe('montoDelCorreo', () => {
    it('suma neto e IVA del correo pegado', () => {
        const t = 'El Valor Neto es: $345.29\n\nEl IVA es: $44.89\n\nLa Retención de IVA es: $3.46\n\nPor un monto total de: $386.72';
        expect(montoDelCorreo(t)).toEqual({ monto: '390.18', neto: 345.29, iva: 44.89 });
    });
    it('un número solo', () => {
        expect(montoDelCorreo('$1,390.5').monto).toBe('1390.50');
    });
    it('otra cosa: nada', () => {
        expect(montoDelCorreo('hola')).toBeNull();
    });
    it('va a la base con el monto', () => {
        expect(lineasParaCotizar([{ producto_id: 4239, factor: 1, cantidad: 1, monto: '390.18' }])[0].monto).toBe(390.18);
    });
});
