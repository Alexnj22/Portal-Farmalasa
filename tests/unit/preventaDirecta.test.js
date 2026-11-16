import { describe, expect, it } from 'vitest';
import {
    agregarLinea, estadoDePreventa, faltaParaEnviar, lineasDeVenta, lineasParaCotizar, nombreDeLista,
    porQueEsaLista, sePuedeAnular, opcionesDePrecio, sePuedeCorregir, totalesDe, MAX_PRODUCTOS,
} from '@nucleo/utils/preventaDirecta.js';

const losartan = { id: 2750, nombre: 'LOSARTAN' };

describe('agregarLinea', () => {
    it('suma 1 si el producto ya está en esa presentación', () => {
        const a = agregarLinea([], losartan);
        const b = agregarLinea(a, losartan);
        expect(b).toHaveLength(1);
        expect(b[0].cantidad).toBe(2);
    });
    it('otra presentación es otra línea', () => {
        expect(agregarLinea(agregarLinea([], losartan, 1), losartan, 10)).toHaveLength(2);
    });
    it('no pasa del máximo', () => {
        const llenas = Array.from({ length: MAX_PRODUCTOS }, (_, i) => ({ producto_id: i + 1, factor: 1, cantidad: 1 }));
        expect(agregarLinea(llenas, { id: 9999 })).toHaveLength(MAX_PRODUCTOS);
    });
});

describe('lineasParaCotizar', () => {
    it('sólo manda la lista cuando se pidió otro precio', () => {
        expect(lineasParaCotizar([{ producto_id: 1, factor: 1, cantidad: '3', lista: null, nombre: 'x' }]))
            .toEqual([{ producto_id: 1, factor: 1, cantidad: 3 }]);
        expect(lineasParaCotizar([{ producto_id: 1, factor: 1, cantidad: 1, lista: 'mayoreo' }])[0].lista).toBe('mayoreo');
    });
});

describe('totalesDe', () => {
    it('total, regular y ahorro al centavo', () => {
        const t = totalesDe({ lineas: [
            { subtotal: 20, precio_regular: 30, cantidad: 1, factor: 10 },
            { subtotal: 6, precio_regular: 3, cantidad: 3, factor: 1 },
        ] });
        expect(t).toMatchObject({ total: 26, regular: 39, ahorro: 13, productos: 2, unidades: 13 });
    });
});

describe('faltaParaEnviar', () => {
    const base = { lineas: [{ producto_id: 1, factor: 1, cantidad: 1 }], cotizando: false, documento: 'consumidor_final', motivoPrecio: '' };
    it('pide productos primero', () => {
        expect(faltaParaEnviar({ ...base, lineas: [] }).campo).toBe('buscarProducto');
    });
    it('espera la cotización', () => {
        expect(faltaParaEnviar({ ...base, cotizacion: null }).texto).toMatch(/Revisando/);
    });
    it('señala el producto con error', () => {
        const f = faltaParaEnviar({ ...base, cotizacion: { lineas: [{ producto_id: 1, factor: 1, nombre: 'X', error: 'sin existencia' }] } });
        expect(f).toEqual({ texto: 'X: sin existencia', campo: 'linea-1-1' });
    });
    it('crédito fiscal dice qué datos le faltan al cliente', () => {
        const f = faltaParaEnviar({ ...base, documento: 'credito_fiscal', cotizacion: { lineas: [], cliente: { categoria: 'Consumidor', nit: '1' } } });
        expect(f.campo).toBe('cliente');
        expect(f.texto).toMatch(/Categoría contribuyente, NRC, Giro, Dirección/);
        const listo = { categoria: 'Contribuyente', nit: '1', nrc: '2', giro: 'x', direccion: 'y' };
        expect(faltaParaEnviar({ ...base, documento: 'credito_fiscal', cotizacion: { lineas: [], cliente: listo } })).toBeNull();
    });
    it('el crédito exige un cliente con datos; otro precio ya no pide motivo', () => {
        expect(faltaParaEnviar({ ...base, pago: 'credito', cotizacion: { lineas: [], generico: true } }).campo).toBe('cliente');
        const lineas = [{ producto_id: 1, factor: 1, cantidad: 1, lista: 'mayoreo' }];
        expect(faltaParaEnviar({ ...base, lineas, cotizacion: { lineas: [] } })).toBeNull();
    });
    it('las opciones de precio van de la más alta a la más baja, sin las vacías', () => {
        expect(opcionesDePrecio({ vineta: 3, descuento_1: 2.5, vip: 2, clinica: 0, mayoreo: 1.65 }).map((o) => o.nombre))
            .toEqual(['Regular', 'Público', 'Preferente', 'Mayoreo Plus']);
    });
});

describe('estados y nombres', () => {
    it('sólo se corrige lo que está en caja; se anula también lo que no llegó', () => {
        expect(sePuedeCorregir({ estado: 'viva' })).toBe(true);
        expect(sePuedeCorregir({ estado: 'facturada' })).toBe(false);
        expect(sePuedeAnular({ estado: 'fallida' })).toBe(true);
        expect(sePuedeAnular({ estado: 'facturada' })).toBe(false);
        expect(estadoDePreventa({ estado: 'descartada' }).texto).toBe('Anulada');
    });
    it('los nombres de lista son los del portal', () => {
        expect(nombreDeLista('descuento_1')).toBe('Público');
        expect(nombreDeLista('vip')).toBe('Preferente');
        expect(nombreDeLista('mayoreo')).toBe('Mayoreo Plus');
        expect(porQueEsaLista('descuento_1', true)).toMatch(/Público/);
    });
    it('una preventa guardada vuelve al editor sin precio autorizado', () => {
        expect(lineasDeVenta({ renglones: [{ producto_id: '5', nombre: 'A', factor: 10, cantidad: 2 }] }))
            .toEqual([{ producto_id: 5, nombre: 'A', factor: 10, cantidad: 2, lista: null }]);
    });
});
