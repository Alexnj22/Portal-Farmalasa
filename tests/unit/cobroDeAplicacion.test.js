import { describe, it, expect } from 'vitest';
import { aplicacionDelCobro, cuentaDelCobro, esClienteGenerico, gruposDePendientes, itemsDelCobro, seleccionDeVenta } from '@nucleo/utils/cobroDeAplicacion';

const precios = { COMPRADA: 1, TRAIDA: 2 };

describe('cobro de aplicación', () => {
    it('el nombre de mostrador no cuenta como cliente', () => {
        expect(esClienteGenerico('CLIENTES VARIOS')).toBe(true);
        expect(esClienteGenerico('Ana López')).toBe(false);
        expect(seleccionDeVenta({ cliente: 'CONSUMIDOR FINAL', renglones: [{ linea_num: 1, disponibles: 2 }] }))
            .toMatchObject({ cuantas: { 1: 1 }, aNombreDe: '' });
    });
    it('comprada: el monto sale de las aplicaciones por el precio', () => {
        const renglonDe = () => ({ linea_num: 1 });
        const items = itemsDelCobro({ mezcla: false, enMezcla: new Set(), veces: 0, cuantas: { 1: 3 }, ventaId: 9, dosis: {}, renglonDe });
        const c = cuentaDelCobro({ modo: 'COMPRADA', precios, items, mezcla: false, veces: 0, cantidad: 1, aplicarAhora: 1, aNombreDe: '', venta: { id: 9 }, producto: '', sala: 3 });
        expect(c).toMatchObject({ total: 3, monto: 3, quedan: 2, valido: false });
        expect(cuentaDelCobro({ modo: 'COMPRADA', precios, items, mezcla: false, veces: 0, cantidad: 1, aplicarAhora: 3, aNombreDe: '', venta: { id: 9 }, producto: '', sala: 3 }).valido).toBe(true);
    });
    it('mezcladas: una aplicación por vez', () => {
        const renglonDe = () => ({});
        const items = itemsDelCobro({ mezcla: true, enMezcla: new Set([2, 1]), veces: 2, cuantas: {}, ventaId: 9, dosis: {}, renglonDe });
        expect(items.map((i) => i.linea_num)).toEqual([1, 2]);
        expect(cuentaDelCobro({ modo: 'COMPRADA', precios, items, mezcla: true, veces: 2, cantidad: 1, aplicarAhora: 2, aNombreDe: '', venta: {}, producto: '', sala: 1 }).total).toBe(2);
    });
    it('traída: vale distinto y lleva la ficha si se eligió', () => {
        const c = cuentaDelCobro({ modo: 'TRAIDA', precios, items: [], mezcla: false, veces: 0, cantidad: 2, aplicarAhora: 2, aNombreDe: '', venta: null, producto: 'Neurobion', sala: 1 });
        expect(c).toMatchObject({ origen: 'TRAIDA', monto: 4, valido: true });
        expect(aplicacionDelCobro({ ...c, items: [], producto: ' Neurobion ', cantidad: 2, aNombreDe: '', ficha: { id: 7, name: 'Ana' } }))
            .toEqual({ origen: 'TRAIDA', producto: 'Neurobion', cantidad: 2, aplicar_ahora: 2, cliente: 'Ana', customer_id: 7 });
    });
    it('agrupa las pendientes por cobro, producto y dosis', () => {
        const g = gruposDePendientes([{ id: 1, cobro_id: 5, producto: 'A' }, { id: 2, cobro_id: 5, producto: 'A' }, { id: 3, cobro_id: 6, producto: 'A' }]);
        expect(g.map((x) => x.ids)).toEqual([[1, 2], [3]]);
    });
});
