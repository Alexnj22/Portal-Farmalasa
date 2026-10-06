import { describe, expect, it } from 'vitest';
import {
    actualizarRenglon, mapaDePreciosDeCotizacion, nivelesPermitidos, payloadDeCotizacion,
    renglonDesdeGuardado, renglonNuevo, renglonesParaGuardar,
} from '@nucleo/utils/cotizacion';

const filas = [
    { product_id: 7, id_presentacion: 1, descripcion: '', vineta: '10', descuento_1: '9', vip: '8', presentaciones: { tipo: 'CAJA' } },
    { product_id: 7, id_presentacion: 2, descripcion: 'x10', vineta: '2', vip: '1.5', presentaciones: { tipo: 'blister' } },
];

describe('formulario de cotización (núcleo)', () => {
    it('arma el mapa de precios con el rótulo del portal', () => {
        const m = mapaDePreciosDeCotizacion(filas);
        expect(m['7']).toHaveLength(2);
        expect(m['7'][0].desc).toBe('Caja');
        expect(m['7'][1].desc).toBe('Blister (x10)');
    });
    it('un renglón nuevo toma la primera presentación a viñeta', () => {
        const r = renglonNuevo({ id: 7, nombre: 'X' }, mapaDePreciosDeCotizacion(filas)['7']);
        expect(r).toMatchObject({ productId: '7', presentacionId: '1', priceType: 'vineta', cantidad: 1, precioUnitario: 10, subtotal: 10 });
    });
    it('recalcula al cambiar nivel, presentación y cantidad', () => {
        const pres = mapaDePreciosDeCotizacion(filas)['7'];
        let r = renglonNuevo({ id: 7, nombre: 'X' }, pres);
        r = actualizarRenglon(r, 'priceType', 'vip', pres);
        expect(r.precioUnitario).toBe(8);
        r = actualizarRenglon(r, 'cantidad', '3', pres);
        expect(r.subtotal).toBe(24);
        r = actualizarRenglon(r, 'presentacionId', '2', pres);
        expect(r.precioUnitario).toBe(1.5);
        expect(r.subtotal).toBe(4.5);
    });
    it('limita los niveles al del cargo', () => {
        expect(nivelesPermitidos('vip').map(n => n.key)).toEqual(['vineta', 'descuento_1', 'vip']);
        expect(nivelesPermitidos(null)).toHaveLength(7);
    });
    it('ida y vuelta de los renglones guardados', () => {
        const pres = mapaDePreciosDeCotizacion(filas)['7'];
        const [g] = renglonesParaGuardar([renglonNuevo({ id: 7, nombre: 'X' }, pres)]);
        expect(g).toMatchObject({ product_id: 7, presentacion_id: 1, price_type: 'vineta', sort_order: 0 });
        expect(renglonDesdeGuardado({ ...g, id: 1 })).toMatchObject({ productId: '7', precioUnitario: 10 });
    });
    it('la fila de la cotización: consumidor final sin cliente', () => {
        const p = payloadDeCotizacion({ fecha: '2026-10-06', cliente: null, docType: 'COF', paymentType: 'EFECTIVO', appliesRetention: false, notes: '', items: [{ subtotal: 11.3 }], branchId: '3', user: { id: 'u', name: 'N' } });
        expect(p).toMatchObject({ customer_name: 'Consumidor Final', customer_id: null, branch_id: 3, notes: null, created_by: 'u' });
        expect(p.total).toBeCloseTo(11.3);
        expect(p.subtotal_gravado).toBeCloseTo(10);
    });
});
