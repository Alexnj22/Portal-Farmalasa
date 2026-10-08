import { describe, expect, it } from 'vitest';
import {
    conteoInicial, enPresentacion, mapaDePresentaciones, presentacionesDeRenglones,
    quedaTodoListo, renglonContado, renglonTodoOk,
} from '@nucleo/utils/recepcionDePedido';

// Blíster de 10, contado en unidades del sistema (factor 1).
const blister = (enviado) => ({ id: 1, factor: 1, dispatch_factor: 10, cantidad_asignada: enviado });

describe('«Todo OK» guarda lo enviado al número', () => {
    it('25 con blíster ×10 guarda 25, no 30', () => {
        expect(renglonTodoOk(blister(25))).toMatchObject({ cantidad_recibida: 25, error_tipo: null });
    });
    it('24 con blíster ×10 guarda 24, no 20', () => {
        expect(renglonTodoOk(blister(24))).toMatchObject({ cantidad_recibida: 24, error_tipo: null });
    });
    it('20 con blíster ×10 guarda 20', () => {
        expect(renglonTodoOk(blister(20))).toMatchObject({ cantidad_recibida: 20, error_tipo: null });
    });
    it('usa lo enviado cuando bodega ajustó la cantidad', () => {
        expect(renglonTodoOk({ ...blister(30), cantidad_enviada: 25 }).cantidad_recibida).toBe(25);
    });
});

describe('el conteo arranca sin inventar diferencia', () => {
    it('múltiplo exacto: en la presentación de despacho', () => {
        expect(conteoInicial(blister(20))).toEqual({ fQty: 2, fPres: 10 });
    });
    it('no múltiplo: en la unidad del sistema, con lo enviado al número', () => {
        expect(conteoInicial(blister(25))).toEqual({ fQty: 25, fPres: 1 });
        expect(conteoInicial(blister(24))).toEqual({ fQty: 24, fPres: 1 });
    });
    it('sin tocar nada, el renglón contado no tiene diferencia', () => {
        for (const n of [20, 24, 25]) {
            const ini = conteoInicial(blister(n));
            expect(renglonContado(blister(n), ini)).toMatchObject({ cantidad_recibida: n, error_tipo: null });
            expect(renglonContado(blister(n))).toMatchObject({ cantidad_recibida: n, error_tipo: null });
        }
    });
    it('una cantidad sin presentación se lee en la de despacho (la app)', () => {
        expect(renglonContado(blister(20), { fQty: 1 })).toMatchObject({ cantidad_recibida: 10, error_tipo: 'faltante' });
    });
    it('el sistema contando en cajas: factor 12, despacho 12', () => {
        expect(enPresentacion(5, { factor: 12, dispatch_factor: 12 })).toEqual({ fQty: 5, fPres: 12 });
    });
});

describe('quedaTodoListo — «Terminé» dice lo mismo en los cinco caminos', () => {
    it('todo contado y nada en reenvío: terminado', () => {
        expect(quedaTodoListo({})).toBe(true);
        expect(quedaTodoListo({ hojasPorContar: 0, especialesPorContar: 0, cajasQueNoLlegaron: [] })).toBe(true);
    });
    it('una caja que no llegó NO deja la sala terminada', () => {
        expect(quedaTodoListo({ cajasQueNoLlegaron: [3] })).toBe(false);
    });
    it('renglones en reenvío (Electrolit, especial) tampoco', () => {
        expect(quedaTodoListo({ hayRenglonesEnReenvio: true })).toBe(false);
    });
    it('quedan hojas, especiales o hojas por revisar: no', () => {
        expect(quedaTodoListo({ hojasPorContar: 1 })).toBe(false);
        expect(quedaTodoListo({ especialesPorContar: 1 })).toBe(false);
        expect(quedaTodoListo({ hojasPorRevisar: 2 })).toBe(false);
    });
});

describe('presentaciones desde los renglones', () => {
    const row = (pid, precios) => ({ id: pid, erp_product_id: pid, products: { product_precios: precios } });
    it('arma el mapa con el mismo rótulo que la consulta aparte', () => {
        const m = presentacionesDeRenglones([row(5, [
            { factor: 10, activo: true, descripcion: 'X 10', presentaciones: { tipo: 'BLISTER' } },
            { factor: 1, activo: true, descripcion: '', presentaciones: { tipo: 'UNIDAD' } },
            { factor: 100, activo: false, descripcion: 'X 100', presentaciones: { tipo: 'CAJA' } },
        ])]);
        expect(m).toEqual({ 5: [{ factor: 1, label: 'UNIDAD' }, { factor: 10, label: 'BLISTER X 10' }] });
    });
    it('sin `descripcion` en el select devuelve null (hay que consultar aparte)', () => {
        expect(presentacionesDeRenglones([row(5, [{ factor: 10, activo: true, presentaciones: { tipo: 'BLISTER' } }])])).toBeNull();
    });
    it('el mapa de la consulta aparte salta inactivas y repetidas', () => {
        expect(mapaDePresentaciones([
            { product_id: 1, factor: 1, descripcion: null, presentaciones: null },
            { product_id: 1, factor: 1, descripcion: 'otra', presentaciones: null },
        ])).toEqual({ 1: [{ factor: 1, label: 'Unidad' }] });
    });
});
