import { describe, expect, it } from 'vitest';
import { datosQueFaltan, nombreDeComprobante, problemasDeVenta } from '@nucleo/utils/preventaDirecta';

const linea = (extra) => ({ producto_id: 7, factor: 1, cantidad: 99, nombre: 'LOSARTAN', subtotal: 10, existencia: 0, ...extra });
const cot = (lineas, cliente = { categoria: 'Consumidor' }) => ({ lineas, cliente, generico: false });

describe('problemasDeVenta', () => {
    it('sin productos dice cómo empezar', () => {
        const [p] = problemasDeVenta({ lineas: [], cotizacion: null });
        expect(p.clave).toBe('vacia');
        expect(p.acciones[0].id).toBe('buscar');
    });
    it('junta TODOS los problemas, no sólo el primero', () => {
        const ps = problemasDeVenta({
            lineas: [{}, {}], hayCliente: false, documento: 'credito_fiscal', pago: 'credito',
            cotizacion: cot([linea({ error: 'Hay 0 unidades y se piden 99.' }), linea({ producto_id: 8, error: 'La cantidad va de 1 a 999.' })], null),
        });
        expect(ps.map((p) => p.clave)).toEqual(['linea-7-1', 'linea-8-1', 'ccf', 'credito']);
    });
    it('sin existencia propone bajar a lo que alcanza y pedir a otra sucursal', () => {
        const [p] = problemasDeVenta({
            lineas: [{}], cotizacion: cot([linea({ factor: 10, cantidad: 3, existencia: 25, error: 'Hay 25 unidades y se piden 30.',
                otras: [{ sucursal: 'Salud 1', disponibles: 40 }] })]),
        });
        expect(p.titulo).toBe('LOSARTAN: hay 25 y pides 30.');
        expect(p.acciones.map((a) => a.id)).toEqual(['ajustar', 'otras', 'apartar', 'quitar']);
        expect(p.acciones[0].valor).toBe(2);
        expect(p.ayuda).toMatch(/Salud 1 \(40\)/);
    });
    it('sin existencia en ninguna parte no ofrece pedir', () => {
        const [p] = problemasDeVenta({ lineas: [{}], cotizacion: cot([linea({ error: 'Hay 0 unidades y se piden 99.' })]) });
        expect(p.acciones.map((a) => a.id)).toEqual(['apartar', 'quitar']);
    });
    it('crédito fiscal con cliente incompleto ofrece completar o cambiar a Factura', () => {
        const [p] = problemasDeVenta({ lineas: [{}], hayCliente: true, documento: 'credito_fiscal', cotizacion: cot([]) });
        expect(p.titulo).toMatch(/NIT/);
        expect(p.acciones.map((a) => a.id)).toEqual(['editar', 'factura']);
    });
    it('puntos de más ofrece el máximo y no canjear', () => {
        const info = { puntos: { puede_canjear: true, disponibles: 220, minimo_canje: 100, tope: 5000, valor: 0.01 }, minimo_a_pagar: 0.05 };
        const ps = problemasDeVenta({ lineas: [{}], puntos: 500, infoCliente: info, hayCliente: true,
            cotizacion: cot([linea({ cantidad: 1, existencia: 5, subtotal: 30 })]) });
        expect(ps).toHaveLength(1);
        expect(ps[0].acciones).toEqual([{ id: 'puntos', label: 'Usar 220', valor: 220 }, { id: 'puntos', label: 'No canjear', valor: 0 }]);
    });
    it('una venta correcta no tiene problemas', () => {
        expect(problemasDeVenta({ lineas: [{}], cotizacion: cot([linea({ cantidad: 1, existencia: 5 })]) })).toEqual([]);
    });
});

describe('datos del cliente', () => {
    it('avisa lo que falta, salvo al cliente de mostrador', () => {
        expect(datosQueFaltan({ phone: '7777', dui: '', nit: '', email: null, direccion: 'x', categoria: 'Contribuyente' })).toEqual(['DUI o NIT', 'Correo']);
        // A un consumidor no se le pide correo ni dirección, igual que al crearlo.
        expect(datosQueFaltan({ phone: '7777', dui: '1', email: null, direccion: '', categoria: 'Consumidor' })).toEqual([]);
        expect(datosQueFaltan({ programa: 'mostrador' })).toEqual([]);
        expect(datosQueFaltan(null)).toEqual([]);
    });
    it('el comprobante se lee como en la sucursal', () => {
        expect(nombreDeComprobante('COF')).toBe('Factura');
        expect(nombreDeComprobante('CCF')).toBe('Crédito fiscal');
    });
});
