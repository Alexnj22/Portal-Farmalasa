import { describe, it, expect } from 'vitest';
import { ordenarBandeja } from '@nucleo/utils/bandejaDeAvisos';
import { avisoEsperaDecision, claveDeDecision } from '@nucleo/utils/accionesDeAviso';

const puede = () => true;
const mm = (id, extra = {}) => ({ id: `n${id}`, type: 'MINMAX_PENDING', metadata: { request_id: id, request_type: 'MINMAX' }, ...extra });
const sol = (id, extra = {}) => ({ id: `s${id}`, type: 'REQUEST_PENDING', metadata: { request_id: id, request_type: 'ANNULMENT_REQUEST' }, ...extra });

describe('bandeja de avisos', () => {
    it('un aviso cuya decisión ya está en «Por decidir» no se repite', () => {
        const r = ordenarBandeja([mm(7), mm(8)], [{ clave: 'minmax:7' }], (n) => avisoEsperaDecision(n, puede));
        expect(r.pendientes.map((n) => n.id)).toEqual(['n8']);
        expect(r.sinLeer).toEqual([]);
        expect(r.totalPorDecidir).toBe(2);
    });
    it('lo resuelto ya no espera: queda abajo como decidido', () => {
        const r = ordenarBandeja([sol('a', { read_at: 'x', metadata: { request_id: 'a', resuelta: 'APPROVED' } })], [], (n) => avisoEsperaDecision(n, puede));
        expect(r.pendientes).toEqual([]);
        expect(r.decididos.map((n) => n.id)).toEqual(['sa']);
    });
    it('sin permiso para decidir, la solicitud es un aviso más', () => {
        const r = ordenarBandeja([sol('b')], [], (n) => avisoEsperaDecision(n, () => false));
        expect(r.sinLeer.map((n) => n.id)).toEqual(['sb']);
    });
    it('la clave de Mín·Máx coincide con la de «Por decidir»', () => {
        expect(claveDeDecision(mm(5))).toBe('minmax:5');
        expect(claveDeDecision(sol('z'))).toBe('z');
    });
    it('un envío por recibir espera decisión aunque no tenga Aprobar', () => {
        const envio = { id: 'e', type: 'REQUEST_PENDING', metadata: { request_id: 'q', request_type: 'INVENTORY_TRANSFER_PUSH' } };
        expect(avisoEsperaDecision(envio, (m) => m === 'traslados')).toBe(true);
        expect(avisoEsperaDecision({ ...envio, metadata: { ...envio.metadata, resuelta: 'APPROVED' } }, puede)).toBe(false);
    });
});
