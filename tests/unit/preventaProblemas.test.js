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
        expect(p.titulo).toBe('LOSARTAN: sólo hay 25 y pides 30.');
        expect(p.acciones.map((a) => a.id)).toEqual(['ajustar', 'otras', 'apartar', 'quitar']);
        expect(p.acciones[0].valor).toBe(2);
        // Dejando 2 cajas (20 u.) faltan 10 u., y Salud 1 las tiene.
        expect(p.ayuda).toBe('Deja 2 y pide 10 u. a Salud 1 (10 u.), o apártalo para el cliente.');
        expect(p.acciones[1]).toEqual({ id: 'otras', label: 'Pedir a otra sucursal',
            valor: [{ sucursal: 'Salud 1', branch_id: null, erp_sucursal_id: null, unidades: 10 }] });
    });
    it('sin nada aquí dice en qué sucursales hay', () => {
        const [p] = problemasDeVenta({ lineas: [{}], cotizacion: cot([linea({ cantidad: 1, existencia: 0, error: 'Hay 0 unidades y se piden 1.',
            otras: [{ sucursal: 'Salud 2', disponibles: 2 }, { sucursal: 'Salud 3', disponibles: 1 }] })]) });
        expect(p.titulo).toBe('LOSARTAN: no hay en esta sucursal.');
        expect(p.ayuda).toBe('Pide 1 a Salud 2 (1 u.), o apártalo para el cliente.');
    });
    it('sin existencia en ninguna parte no ofrece pedir', () => {
        const [p] = problemasDeVenta({ lineas: [{}], cotizacion: cot([linea({ error: 'Hay 0 unidades y se piden 99.' })]) });
        expect(p.acciones.map((a) => a.id)).toEqual(['apartar', 'quitar']);
    });
    describe('reparte lo que falta entre las otras sucursales (2026-11-23)', () => {
        const otras = [
            { sucursal: 'Salud 2', branch_id: 25, erp_sucursal_id: 2, disponibles: 6 },
            { sucursal: 'Bodega', branch_id: 30, erp_sucursal_id: 6, disponibles: 1 },
            { sucursal: 'Salud 5', branch_id: 29, erp_sucursal_id: 7, disponibles: 4 },
        ];
        const betaserc = (extra) => linea({ nombre: 'BETASERC', cantidad: 10, existencia: 1, error: 'Hay 1 unidades y se piden 10.', ...extra });
        it('alcanza: empieza por la que más tiene y no le pide a nadie más de lo que tiene', () => {
            const [p] = problemasDeVenta({ lineas: [{}], cotizacion: cot([betaserc({ otras })]) });
            expect(p.titulo).toBe('BETASERC: sólo hay 1 y pides 10.');
            expect(p.ayuda).toBe('Deja 1 y pide 9 a Salud 2 (6 u.) y Salud 5 (3 u.), o apártalo para el cliente.');
            const otrasAccion = p.acciones.find((a) => a.id === 'otras');
            expect(otrasAccion.label).toBe('Pedir a otras sucursales');
            expect(otrasAccion.valor.map((r) => [r.erp_sucursal_id, r.unidades])).toEqual([[2, 6], [7, 3]]);
        });
        it('no alcanza: lo dice con cuánto hay y cuánto falta, y el pedido lleva todo lo que hay', () => {
            const pocas = [{ sucursal: 'Salud 2', disponibles: 1 }, { sucursal: 'Salud 5', disponibles: 1 }, { sucursal: 'Bodega', disponibles: 1 }];
            const [p] = problemasDeVenta({ lineas: [{}], cotizacion: cot([betaserc({ otras: pocas })]) });
            expect(p.ayuda).toBe('Sólo hay 1 aquí y 3 en otras sucursales; faltan 6. Pide lo que hay o apártalo como encargo.');
            expect(p.acciones.map((a) => a.id)).toEqual(['ajustar', 'otras', 'apartar', 'quitar']);
            expect(p.acciones[1].valor.map((r) => r.unidades)).toEqual([1, 1, 1]);
        });
        it('no alcanza y aquí no hay nada', () => {
            const [p] = problemasDeVenta({ lineas: [{}], cotizacion: cot([betaserc({ existencia: 0, otras: [{ sucursal: 'Salud 2', disponibles: 3 }] })]) });
            expect(p.titulo).toBe('BETASERC: no hay en esta sucursal.');
            expect(p.ayuda).toBe('No hay aquí y 3 en otras sucursales; faltan 7. Pide lo que hay o apártalo como encargo.');
        });
        it('sin otras sucursales: deja lo que hay, sin ofrecer pedir', () => {
            const [p] = problemasDeVenta({ lineas: [{}], cotizacion: cot([betaserc({ otras: [] })]) });
            expect(p.ayuda).toBe('Deja 1, o apártalo para el cliente.');
            expect(p.acciones.map((a) => a.id)).toEqual(['ajustar', 'apartar', 'quitar']);
        });
        it('una sola sucursal que alcanza', () => {
            const [p] = problemasDeVenta({ lineas: [{}], cotizacion: cot([betaserc({ otras: [{ sucursal: 'Salud 3', erp_sucursal_id: 3, disponibles: 40 }] })]) });
            expect(p.ayuda).toBe('Deja 1 y pide 9 a Salud 3 (9 u.), o apártalo para el cliente.');
            expect(p.acciones[1]).toMatchObject({ id: 'otras', label: 'Pedir a otra sucursal' });
            expect(p.acciones[1].valor).toEqual([{ sucursal: 'Salud 3', branch_id: null, erp_sucursal_id: 3, unidades: 9 }]);
        });
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

