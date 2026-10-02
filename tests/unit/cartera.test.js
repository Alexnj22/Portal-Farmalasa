import { describe, expect, it } from 'vitest';
import { abonosDelCredito, carteraFiltrada, desdeLaLectura, pagadoPct } from '@nucleo/utils/cartera';

describe('cartera', () => {
    it('pagado en %, acotado', () => {
        expect(pagadoPct({ total: 100, saldo: 25 })).toBe(75);
        expect(pagadoPct({ total: 0, saldo: 5 })).toBe(0);
        expect(pagadoPct({ total: 10, saldo: -5 })).toBe(100);
    });
    it('al día o leído hace', () => {
        const ahora = Date.parse('2026-10-02T12:00:00Z');
        expect(desdeLaLectura('2026-10-02T11:59:30Z', ahora)).toBe('Al día');
        expect(desdeLaLectura('2026-10-02T11:30:00Z', ahora)).toBe('Leído hace 30 min');
        expect(desdeLaLectura('2026-10-02T09:00:00Z', ahora)).toBe('Leído hace 3 h');
    });
    it('filtra por saldo y plazo, el más viejo primero', () => {
        const lista = [
            { cliente: 'ANA', saldo: 10, dias: 5, vencido: false },
            { cliente: 'LUIS', saldo: 0, dias: 90, vencido: false },
            { cliente: 'EVA', saldo: 3, dias: 40, vencido: true },
        ];
        expect(carteraFiltrada(lista).map(c => c.cliente)).toEqual(['EVA', 'ANA']);
        expect(carteraFiltrada(lista, { ver: 'VENCIDOS' }).map(c => c.cliente)).toEqual(['EVA']);
        expect(carteraFiltrada(lista, { ver: 'TODOS', busqueda: 'luis' }).map(c => c.cliente)).toEqual(['LUIS']);
    });
    it('abonos: la caja manda, el portal pone quién cobró', () => {
        const caja = [{ erp_id: 9, monto: 5, fecha: '2026-10-01' }, { erp_id: 10, monto: 5, fecha: '2026-10-02' }];
        const portal = [{ monto: 5, created_at: '2026-10-02T15:00:00Z', abonado_por: 'e1', cobrado_por: 'Ana' }];
        const r = abonosDelCredito(caja, portal);
        expect(r.map(a => [a.id, a.origen, a.cobrado_por])).toEqual([[9, 'caja', null], [10, 'portal', 'Ana']]);
        expect(abonosDelCredito(null, portal)[0].origen).toBe('portal');
    });
});
