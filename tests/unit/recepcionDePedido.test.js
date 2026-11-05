import { describe, expect, it } from 'vitest';
import { cantidadEnOtraPresentacion, esperadoEnDespacho, excesoGrande, renglonContado, renglonTodoOk, toDispatch } from '@nucleo/utils/recepcionDePedido';
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

// ── Cantidades muy grandes (bicarbonato del pedido 240, 2026-11-05) ──────────

describe('excesoGrande', () => {
    it('frena 25 «bolsas de 50» sobre 25 enviados', () => {
        expect(excesoGrande(1250, 25)).toBe(true);
    });
    it('no frena un sobrante real chico', () => {
        expect(excesoGrande(50, 25)).toBe(false);   // la bolsa entera que mandó bodega
        expect(excesoGrande(3, 1)).toBe(false);     // triple pero sólo 2 de más
        expect(excesoGrande(25, 25)).toBe(false);
        expect(excesoGrande(10, 25)).toBe(false);
    });
    it('frena desde cero enviado con 10 o más', () => {
        expect(excesoGrande(10, 0)).toBe(true);
        expect(excesoGrande(9, 0)).toBe(false);
    });
});

describe('cantidadEnOtraPresentacion', () => {
    it('25 sobres pasan a 1 bolsa de 50, no a 25 bolsas', () => {
        expect(cantidadEnOtraPresentacion(25, 1, 50)).toBe(1);
    });
    it('2 bolsas de 50 pasan a 100 unidades', () => {
        expect(cantidadEnOtraPresentacion(2, 50, 1)).toBe(100);
    });
    it('cero se queda en cero', () => {
        expect(cantidadEnOtraPresentacion(0, 1, 50)).toBe(0);
    });
});
