import { describe, it, expect } from 'vitest';
import { contadoDeBolsas, faltasDelDeposito, repartoDelDeposito } from '@nucleo/utils/depositoDeEfectivo';

describe('repartoDelDeposito', () => {
    it('todo al banco deja remanente cero', () => {
        const r = repartoDelDeposito({ contado: 22350.35, aporte: 49.65, escritoBanco: '22400', escritoEfectivo: '' });
        expect(r.disponible).toBe(22400);
        expect(r.nMonto).toBe(22400);
        expect(r.remanente).toBe(0);
        expect(r.bancoRecortado).toBe(false);
    });

    it('DEP-261005-1: el aporte anotado DESPUÉS completa el monto escrito', () => {
        const antes = repartoDelDeposito({ contado: 24720, aporte: '', escritoBanco: '25145', escritoEfectivo: '' });
        expect(antes.nMonto).toBe(24720);
        expect(antes.bancoRecortado).toBe(true);
        const despues = repartoDelDeposito({ contado: 24720, aporte: '425', escritoBanco: '25145', escritoEfectivo: '' });
        expect(despues.nMonto).toBe(25145);
        expect(despues.remanente).toBe(0);
    });

    it('cuando no caben las dos partes cede la última que se tocó', () => {
        const base = { contado: 100, aporte: 0, escritoBanco: '80', escritoEfectivo: '50' };
        expect(repartoDelDeposito({ ...base, ultimo: 'efectivo' })).toMatchObject({ nMonto: 80, nEfectivo: 20 });
        expect(repartoDelDeposito({ ...base, ultimo: 'banco' })).toMatchObject({ nMonto: 50, nEfectivo: 50 });
    });

    it('acepta coma decimal', () => {
        expect(repartoDelDeposito({ contado: 10, aporte: '0,50', escritoBanco: '10,5', escritoEfectivo: '' }).nMonto).toBe(10.5);
    });
});

describe('faltasDelDeposito y contadoDeBolsas', () => {
    it('cada parte pide lo suyo sólo si lleva monto', () => {
        expect(faltasDelDeposito({ nMonto: 10, nEfectivo: 0, nAporte: 0, banco: '', entregadoA: '' }))
            .toEqual({ faltaNota: false, faltaBanco: true, faltaQuien: false });
        expect(faltasDelDeposito({ nMonto: 0, nEfectivo: 5, nAporte: 3, banco: '', entregadoA: '', aporteNota: ' ' }))
            .toEqual({ faltaNota: true, faltaBanco: false, faltaQuien: true });
    });
    it('suma lo contado', () => {
        expect(contadoDeBolsas([{ contado: '10.5' }, { contado: 2 }, {}])).toBe(12.5);
    });
});
