import { describe, expect, it } from 'vitest';
import { construirComprobanteDeMovimiento } from '@nucleo/utils/movimientoTicket';

const base = { tipo: 'ENTRADA', id: 4857, fecha: '2026-10-19', monto: 1 };
const armar = (m) => construirComprobanteDeMovimiento({ movimiento: { ...base, ...m }, etiqueta: 'Aplicacion de inyeccion', sala: 'Salud 3', hechoPor: 'X', hechoAt: '2026-10-19T18:20:00Z' });

describe('comprobante de un ingreso según cómo se pagó', () => {
    it('en efectivo sigue diciendo que entra a la caja', () => {
        const t = armar({ forma_pago: 'EFECTIVO' });
        expect(t.titulo).toBe('INGRESO A CAJA');
        expect(t.totales[0][0]).toBe('Entra a la caja');
        expect(t.datos).toContainEqual(['Pago', 'Efectivo']);
    });
    it('sin forma de pago (filas viejas) es efectivo', () => {
        expect(armar({}).totales[0][0]).toBe('Entra a la caja');
    });
    it('con tarjeta NO dice que entra a la caja y muestra el voucher', () => {
        const t = armar({ forma_pago: 'TARJETA', numero_boleta: '4792', comprobante_total: 8.4 });
        expect(t.titulo).toBe('INGRESO CON TARJETA');
        expect(t.totales[0][0]).toBe('Cobrado con tarjeta');
        expect(t.datos).toContainEqual(['Voucher', '4792']);
        expect(t.datos.some(([k]) => k === 'Total voucher')).toBe(true);
        expect(t.bloques.some((b) => b.titulo === 'No entra al cajon')).toBe(true);
    });
    it('sin comprobante avisa que queda pendiente de autorización', () => {
        const t = armar({ forma_pago: 'TRANSFERENCIA', autorizacion: 'PENDIENTE' });
        expect(t.titulo).toBe('INGRESO CON TRANSFERENCIA');
        expect(t.bloques.some((b) => b.titulo === 'Pendiente')).toBe(true);
    });
    it('una salida no cambia', () => {
        const t = construirComprobanteDeMovimiento({ movimiento: { ...base, tipo: 'SALIDA' }, etiqueta: 'Vale', sala: 'S', hechoPor: 'X', hechoAt: '2026-10-19T18:20:00Z' });
        expect(t.titulo).toBe('VALE DE CAJA');
        expect(t.datos.some(([k]) => k === 'Pago')).toBe(false);
    });
});
