import { describe, it, expect } from 'vitest';
import { ticketDeLiquidacion } from '@nucleo/utils/distribucionDocumento.js';

const liq = {
    fecha: '2026-09-30', vendedor: { name: 'Carlos Mejía' },
    ventas: { total: 339.65, documentos: 2, lista: [
        { numero_control: 'DTE-01-B001P001-000000000000019', cliente: 'TIENDA LA ESQUINA', total: 329.65 },
        { numero_control: 'DTE-01-B001P001-000000000000020', cliente: 'FARMACIA', total: 10 },
    ] },
    por_forma: [{ forma: '01', monto: 329.65, origen: 'ventas' }, { forma: '05', monto: 10, origen: 'ventas' }, { forma: '01', monto: 20, origen: 'cobros' }],
    cobros: { total: 20, lista: [] }, devoluciones: { total: 0, a_favor: 0, lista: [] },
    cheques: [], efectivo: { ventas: 329.65, cobros: 20, esperado: 349.65 }, credito: 0, cierre: null,
};

describe('ticket de la liquidación', () => {
    it('sin cerrar: dice cuánto entregar y no inventa diferencia', () => {
        const t = ticketDeLiquidacion(liq);
        expect(t.titulo).toBe('LIQUIDACION (SIN CERRAR)');
        expect(t.totales.find(x => x[0] === 'EFECTIVO A ENTREGAR')[1]).toBe('$349.65');
        expect(t.totales.some(x => /FALTANTE|SOBRANTE/.test(x[0]))).toBe(false);
        // El efectivo no se repite como "otra forma": sólo la transferencia.
        expect(t.totales.map(x => x[0])).toContain('Transferencia');
        expect(t.items.filas).toHaveLength(2);
    });
    it('cerrada con faltante', () => {
        const t = ticketDeLiquidacion({ ...liq, cierre: { contado: 340, diferencia: -9.65, nota: 'se devolvió cambio', cerrada_por: 'Ana López' } });
        expect(t.titulo).toBe('LIQUIDACION CERRADA');
        expect(t.totales.find(x => x[0] === 'FALTANTE')[1]).toBe('$9.65');
        expect(t.pie.join(' ')).toMatch(/Nota: se devolvió cambio.*Recibio: Ana/);
    });
});
