import { describe, expect, it } from 'vitest';
import { aplicacionesDelPago, APROBACION, estadoDelCobro, repartoDelMasViejo, repartoDesdeElComprobante, sumaDeSaldos } from '@nucleo/utils/abonoDeCredito';

const A = { id: 1, credito: 'C1', saldo: 20 };
const B = { id: 2, credito: 'C2', saldo: 30 };

describe('abonoDeCredito', () => {
    it('suma de saldos', () => {
        expect(sumaDeSaldos([A, B], A)).toBe(50);
        expect(sumaDeSaldos([], A)).toBe(20);
    });
    it('reparte del más viejo, hasta cada saldo', () => {
        expect(repartoDelMasViejo(35, [A, B])).toEqual({ 1: '20.00', 2: '15.00' });
        expect(repartoDelMasViejo(80, [A, B])).toEqual({ 1: '20.00', 2: '30.00' });
    });
    it('comprobante: lo que sobra va a los otros', () => {
        expect(repartoDesdeElComprobante(25, A, [B])).toEqual({ reparto: { 1: '20.00', 2: '5.00' }, repartir: true });
        expect(repartoDesdeElComprobante(10, A, [B])).toEqual({ reparto: { 1: '10.00' }, repartir: false });
        expect(repartoDesdeElComprobante(25, A, [])).toEqual({ reparto: { 1: '20.00' }, repartir: false });
    });
    it('efectivo: el total es la suma; listo si no excede', () => {
        expect(estadoDelCobro({ forma: 'Efectivo', reparto: { 1: '5' }, creditos: [A] }).listo).toBe(true);
        expect(estadoDelCobro({ forma: 'Efectivo', reparto: { 1: '25' }, creditos: [A] }).listo).toBe(false);
        expect(estadoDelCobro({ forma: 'Efectivo', reparto: { 1: '' }, creditos: [A] }).listo).toBe(false);
    });
    it('con papel: exige comprobante leído, OK, y que cuadre exacto', () => {
        const base = { forma: 'Transferencia', montoDoc: '25', reparto: { 1: '20', 2: '5' }, creditos: [A, B], hayArchivo: true };
        expect(estadoDelCobro({ ...base, lectura: { veredicto: 'OK' } }).listo).toBe(true);
        expect(estadoDelCobro({ ...base, lectura: null }).listo).toBe(false);
        expect(estadoDelCobro({ ...base, lectura: { veredicto: 'ILEGIBLE' } }).bloqueado).toBe(true);
        const corto = estadoDelCobro({ ...base, reparto: { 1: '20' }, lectura: { veredicto: 'OK' } });
        expect([corto.listo, corto.descuadre]).toEqual([false, { faltan: 5 }]);
    });
    it('nombre sin reconocer o aprobación: va a aprobación; aprobación pide motivo', () => {
        expect(estadoDelCobro({ forma: 'Tarjeta', lectura: { veredicto: 'OK', nombreSinReconocer: true } }).iraAprobacion).toBe(true);
        expect(estadoDelCobro({ forma: APROBACION, reparto: { 1: '5' }, creditos: [A], motivo: 'ISSS' }).listo).toBe(false);
        expect(estadoDelCobro({ forma: APROBACION, reparto: { 1: '5' }, creditos: [A], motivo: 'ISSS agosto' }).listo).toBe(true);
    });
    it('aplicaciones: sólo las que llevan algo', () => {
        expect(aplicacionesDelPago([A, B], { 1: '20', 2: '' })).toEqual([{ credito: 'C1', monto: 20 }]);
    });
});
