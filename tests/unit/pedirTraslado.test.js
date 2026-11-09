import { describe, it, expect } from 'vitest';
import { avisosDelPedido, claveOrigen } from '@nucleo/utils/pedirTraslado';

const sala = { sala: 'Bodega', unidades: 100, minimo: 109, erp_sucursal_id: 6 };
const base = { pres: { tipo: 'BLISTER', factor: 1 }, cantidad: '1', sala, unidades: 1, opcionesPres: [{}], descartados: new Set() };

describe('claveOrigen', () => {
    it('distingue el área de vencidos de Bodega', () => {
        expect(claveOrigen({ erp_sucursal_id: 6 })).toBe('6');
        expect(claveOrigen({ erp_sucursal_id: 6, vencidos: true })).toBe('6:V');
    });
});

describe('avisosDelPedido', () => {
    it('la existencia tiene tres estados excluyentes', () => {
        expect(avisosDelPedido(base).existencia).toEqual({ tono: 'warning', texto: '1 unidad · Bodega tiene 100 y quedaría en 99, bajo su mínimo de 109.' });
        expect(avisosDelPedido({ ...base, sala: { ...sala, minimo: 0 } }).existencia.tono).toBe('neutral');
        const no = avisosDelPedido({ ...base, cantidad: '2', unidades: 200, opcionesPres: [{}, {}] }).existencia;
        expect(no.tono).toBe('danger');
        expect(no.texto).toBe('No alcanza: pides 200 unidades y Bodega tiene 100. Baja la cantidad o elige otra presentación.');
    });
    it('sin presentación o sin sala no dice nada de la existencia', () => {
        expect(avisosDelPedido({ ...base, pres: null }).existencia).toBeNull();
    });
    it('los lotes: descartados de más, o lotes que no suman', () => {
        expect(avisosDelPedido({ ...base, faltan: 2, descartados: new Set(['a']) }).lotes.texto).toMatch(/dejaste fuera faltan 2 unidades/);
        expect(avisosDelPedido({ ...base, faltan: 1, lotesDeSala: [{ unidades: 0 }] }).lotes.texto).toMatch(/suman 0 unidades, menos que las 1/);
    });
    it('falta el para qué', () => {
        expect(avisosDelPedido({ ...base, faltaElParaQue: true }).paraQue.tono).toBe('warning');
        expect(avisosDelPedido(base).paraQue).toBeNull();
    });
});

describe('el mínimo de envío de Bodega', () => {
    const minimoBodega = { unidades: 10, texto: '1 CAJA' };
    const blister = { tipo: 'BLISTER', factor: 2 };
    it('dice cuánto es lo mínimo en la presentación elegida', () => {
        const a = avisosDelPedido({ ...base, pres: blister, cantidad: '2', unidades: 4, minimoBodega, bajoMinimoBodega: true }).minimoBodega;
        expect(a.tono).toBe('danger');
        expect(a.texto).toBe('Bodega lo envía de a 1 CAJA (10 unidades). Lo mínimo que puedes pedir es 5 BLISTER.');
    });
    it('calla cuando se pide lo suficiente', () => {
        expect(avisosDelPedido({ ...base, minimoBodega, bajoMinimoBodega: false }).minimoBodega).toBeNull();
    });
});
