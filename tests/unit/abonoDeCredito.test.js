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
    it('dice qué falta, a qué campo lleva, y nunca contradice a `listo` (2026-11-14)', () => {
        const base = { forma: 'Transferencia', montoDoc: '25', reparto: { 1: '20', 2: '5' }, creditos: [A, B], hayArchivo: true, lectura: { veredicto: 'OK' } };
        const casos = [
            [{ ...base, hayArchivo: false, lectura: null }, 'abono-comprobante'],
            [{ ...base, lectura: null }, 'abono-comprobante'],
            [{ ...base, lectura: { veredicto: 'ILEGIBLE' } }, 'abono-comprobante'],
            [{ ...base, montoDoc: '' }, 'abono-monto-doc'],
            [{ ...base, reparto: { 1: '20' } }, 'abona-1'],
            [{ ...base, reparto: { 1: '25' } }, 'abona-1'],
            [{ forma: 'Efectivo', reparto: { 1: '' }, creditos: [A] }, 'abona-1'],
            [{ forma: APROBACION, reparto: { 1: '5' }, creditos: [A], motivo: 'x' }, 'abono-motivo'],
            [base, null],
        ];
        for (const [entrada, campo] of casos) {
            const e = estadoDelCobro(entrada);
            expect(e.falta?.campo ?? null).toBe(campo);
            expect(e.listo).toBe(!e.falta);
        }
        expect(estadoDelCobro({ ...base, reparto: { 1: '20' } }).falta.texto).toBe('Faltan $5.00 por aplicar.');
    });
    it('voucher por más de la deuda: lo que sobra va a otra venta con su número (2026-11-25)', () => {
        const C = { id: 9, credito: 'C9', saldo: 9.35 };
        const base = { forma: 'Tarjeta', montoDoc: '12.35', reparto: { 9: '9.35' }, creditos: [C], hayArchivo: true,
            lectura: { veredicto: 'MONTO_MAYOR_AL_SALDO' }, deuda: 9.35 };
        const sin = estadoDelCobro(base);
        expect([sin.bloqueado, sin.puedeOtraVenta, sin.listo, sin.descuadre]).toEqual([false, true, false, null]);
        expect(sin.falta).toEqual({ texto: 'Sobran $3.00. Elige la otra venta.', campo: 'abono-otra-venta' });
        const con = estadoDelCobro({ ...base, otraVenta: ' 95931 ' });
        expect([con.listo, con.parteOtraVenta, con.numeroOtraVenta, con.falta]).toEqual([true, 3, '95931', null]);
        // Sin pasar de la deuda no se ofrece: faltar por aplicar sigue siendo faltar.
        const corto = estadoDelCobro({ ...base, montoDoc: '9.35', reparto: { 9: '5' }, lectura: { veredicto: 'OK' }, otraVenta: '95931' });
        expect([corto.puedeOtraVenta, corto.parteOtraVenta, corto.listo]).toEqual([false, 0, false]);
        // El efectivo no lleva otra venta.
        expect(estadoDelCobro({ forma: 'Efectivo', reparto: { 9: '9.35' }, creditos: [C], deuda: 9.35, otraVenta: '1' }).puedeOtraVenta).toBe(false);
    });
    it('aplicaciones: sólo las que llevan algo', () => {
        expect(aplicacionesDelPago([A, B], { 1: '20', 2: '' })).toEqual([{ credito: 'C1', monto: 20 }]);
    });
});

describe('la otra venta que se elige sola (2026-11-25)', async () => {
    const { laQueSeElige, rotuloDeCandidata, horaDeCandidata } = await import('@nucleo/hooks/useVentasParaVoucher');
    const ingreso = { clase: 'movimiento', id: 8855, numero: 'P8855', descripcion: 'Aplicacion de inyeccion', coincide_voucher: true, hora: '11:58:03.33634' };
    const venta = { clase: 'venta', id: 1, numero: '95804', descripcion: 'CLIENTE FRECUENTE', coincide_voucher: false, hora: '12:52:15' };
    it('el ingreso del mismo voucher gana aunque haya ventas del mismo monto', () => {
        expect(laQueSeElige([ingreso, venta, { ...venta, id: 2 }])).toBe(ingreso);
    });
    it('sin uno del voucher: sólo si hay una', () => {
        expect(laQueSeElige([venta])).toBe(venta);
        expect(laQueSeElige([venta, { ...venta, id: 2 }])).toBe(null);
        expect(laQueSeElige([ingreso, { ...ingreso, id: 9 }])).toBe(null);
    });
    it('rótulo y hora', () => {
        expect(rotuloDeCandidata(ingreso)).toBe('Ingreso P8855 · Aplicacion de inyeccion · ');
        expect(rotuloDeCandidata(venta)).toBe('Venta 95804 · ');
        expect(horaDeCandidata(ingreso)).toBe('11:58:03');
    });
});
