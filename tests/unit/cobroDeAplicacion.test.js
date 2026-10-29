import { describe, it, expect } from 'vitest';
import { aplicacionDelCobro, cuentaDelCobro, esClienteGenerico, gruposDePendientes, itemsDelCobro, motivoDelLote, seleccionDeVenta, venceNormal } from '@nucleo/utils/cobroDeAplicacion';

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
    it('traída: vale distinto, exige la ficha y la lleva', () => {
        const base = { modo: 'TRAIDA', precios, items: [], mezcla: false, veces: 0, cantidad: 2, aplicarAhora: 2, aNombreDe: '', venta: null, producto: 'Neurobion', sala: 1 };
        const loteTraida = { lote: ' ab12 ', vence: '05/2099' };
        expect(cuentaDelCobro({ ...base, loteTraida })).toMatchObject({ valido: false, faltaFicha: true });
        // Sin el lote de la ampolla no se cobra, aunque tenga ficha.
        expect(cuentaDelCobro({ ...base, ficha: { id: 7, name: 'Ana' } })).toMatchObject({ valido: false, faltaLote: true });
        const c = cuentaDelCobro({ ...base, ficha: { id: 7, name: 'Ana' }, loteTraida });
        expect(c).toMatchObject({ origen: 'TRAIDA', monto: 4, valido: true, faltaFicha: false, faltaLote: false });
        expect(aplicacionDelCobro({ ...c, items: [], producto: ' Neurobion ', cantidad: 2, aNombreDe: '', ficha: { id: 7, name: 'Ana' }, loteTraida }))
            .toEqual({ origen: 'TRAIDA', producto: 'Neurobion', cantidad: 2, lote: 'AB12', vence: '2099-05', aplicar_ahora: 2, cliente: 'Ana', customer_id: 7 });
    });
    it('agrupa las pendientes por cobro, producto y dosis', () => {
        const g = gruposDePendientes([{ id: 1, cobro_id: 5, producto: 'A' }, { id: 2, cobro_id: 5, producto: 'A' }, { id: 3, cobro_id: 6, producto: 'A' }]);
        expect(g.map((x) => x.ids)).toEqual([[1, 2], [3]]);
    });
});

describe('lote de la ampolla (PENDIENTES 20)', () => {
    const HOY = '2026-10-28';
    it('las mismas reglas que inyeccion_lote_valido', () => {
        expect(motivoDelLote({ lote: '', vence: '2027-05' }, HOY)).toMatch(/Falta el lote/);
        expect(motivoDelLote({ lote: 'generico', vence: '2027-05' }, HOY)).toMatch(/Falta el lote/);
        expect(motivoDelLote({ lote: 'L123', vence: '' }, HOY)).toMatch(/vencimiento/);
        expect(motivoDelLote({ lote: 'L123', vence: '09/2026' }, HOY)).toMatch(/vencida/);
        // Un mes vale hasta su último día: octubre todavía sirve el 28.
        expect(motivoDelLote({ lote: 'L123', vence: '10/2026' }, HOY)).toBeNull();
        expect(motivoDelLote({ lote: 'L123', vence: '2027-05-10' }, HOY)).toBeNull();
    });
    it('el vencimiento como se lee en la ampolla', () => {
        expect(venceNormal('5/2027')).toBe('2027-05');
        expect(venceNormal('05-2027')).toBe('2027-05');
        expect(venceNormal('2027-05')).toBe('2027-05');
    });
    it('sólo el renglón cuya factura no identifica la ampolla lleva lote, y sin él no se cobra', () => {
        const renglones = { 1: { linea_num: 1, pide_lote: true }, 2: { linea_num: 2, pide_lote: false } };
        const renglonDe = (l) => renglones[l];
        const base = { mezcla: false, enMezcla: new Set(), veces: 0, cuantas: { 1: 1, 2: 1 }, ventaId: 9, dosis: {}, renglonDe };
        const sin = itemsDelCobro(base);
        expect(sin.find((i) => i.linea_num === 2)).not.toHaveProperty('lote');
        const cuenta = (items) => cuentaDelCobro({ modo: 'COMPRADA', precios, items, mezcla: false, veces: 0, cantidad: 1, aplicarAhora: 2, aNombreDe: '', venta: { id: 9 }, producto: '', sala: 3 });
        expect(cuenta(sin)).toMatchObject({ valido: false, faltaLote: true });
        const con = itemsDelCobro({ ...base, lotes: { 1: { lote: 'x9', vence: '12/2099' } } });
        expect(con.find((i) => i.linea_num === 1)).toMatchObject({ lote: 'X9', vence: '2099-12' });
        expect(cuenta(con)).toMatchObject({ valido: true, faltaLote: false });
    });
});
