import { describe, expect, it } from 'vitest';
import { esperadoEnDespacho, renglonContado, renglonTodoOk, toDispatch } from '@nucleo/utils/recepcionDePedido';
import { tipoDeLlegada } from '@nucleo/data/llegadaDePedido';

// 24 unidades enviadas, se despachan en cajas de 12.
const r = { id: 7, factor: 1, dispatch_factor: 12, cantidad_enviada: 24 };

describe('recepción de pedido', () => {
    it('convierte a la presentación de despacho', () => {
        expect(toDispatch(24, 1, 12)).toBe(2);
        expect(esperadoEnDespacho(r)).toBe(2);
    });
    it('todo OK guarda lo enviado sin diferencia', () => {
        expect(renglonTodoOk(r)).toEqual({ pedido_item_id: 7, cantidad_recibida: 24, nota_diferencia: null, error_tipo: null, cantidad_problema: null });
    });
    it('una caja menos es faltante', () => {
        expect(renglonContado(r, { fQty: 1 })).toMatchObject({ cantidad_recibida: 12, error_tipo: 'faltante' });
    });
    it('de más es sobrante', () => {
        expect(renglonContado(r, { fQty: 3 })).toMatchObject({ cantidad_recibida: 36, error_tipo: 'sobrante' });
    });
    it('dañado con la cantidad completa conserva el tipo y su cantidad', () => {
        expect(renglonContado(r, { fQty: 2, problema: 'danado', cantProblema: 3 })).toMatchObject({ error_tipo: 'danado', cantidad_problema: 3 });
    });
    it('«otro» con cantidad distinta se nombra por la cuenta', () => {
        expect(renglonContado(r, { fQty: 1, problema: 'otro' })).toMatchObject({ error_tipo: 'faltante' });
    });
    it('el tipo de llegada cuenta también el Electrolit y las especiales', () => {
        expect(tipoDeLlegada({})).toBe('completa');
        expect(tipoDeLlegada({ electrolitFaltantes: 2 })).toBe('falta_caja');
        expect(tipoDeLlegada({ especialesLlegadas: { E1: 'faltante' }, cajasDanadas: [3] })).toBe('mixto');
        expect(tipoDeLlegada({ cajasDanadas: [1] })).toBe('caja_danada');
    });
});
