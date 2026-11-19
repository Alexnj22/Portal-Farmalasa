import { describe, expect, it } from 'vitest';
import {
    agregarConCantidad, agregarLinea, desgloseDeVenta, estadoDePreventa, faltaParaEnviar, lineasDeVenta, lineasParaCotizar, nombreDeLista,
    diferenciasDelCobro, porQueEsaLista, sePuedeAnular, opcionesDePrecio, faltaEnPuntos, maximoDePuntos, descuentoDePuntos, sePuedeCorregir, totalesDe, MAX_PRODUCTOS,
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
    it('con la lista del cliente, sólo esa y las más altas', () => {
        const precios = { vineta: 3, descuento_1: 2.5, vip: 2, clinica: 1.8, mayoreo: 1.65 };
        expect(opcionesDePrecio(precios, 'vip').map((o) => o.lista)).toEqual(['vineta', 'descuento_1', 'vip']);
        expect(opcionesDePrecio(precios, 'mayoreo').map((o) => o.lista)).toEqual(['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo']);
        expect(opcionesDePrecio(precios, 'descuento_1').map((o) => o.lista)).toEqual(['vineta', 'descuento_1']);
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
            .toEqual([{ producto_id: 5, nombre: 'A', factor: 10, cantidad: 2, lista: null, lote: null }]);
    });
});

describe('puntos', () => {
    const info = { minimo_a_pagar: 0.05, puntos: { puede_canjear: true, saldo: 220, disponibles: 220, minimo_canje: 100, tope: 10000, valor: 0.01 } };
    it('$0.01 por punto', () => { expect(descuentoDePuntos(120)).toBe(1.2); });
    it('revisa mínimo, saldo y mínimo a pagar', () => {
        expect(faltaEnPuntos({ puntos: 0, info, total: 5 })).toBeNull();
        expect(faltaEnPuntos({ puntos: 50, info, total: 5 })).toMatch(/mínimo 100/);
        expect(faltaEnPuntos({ puntos: 300, info, total: 5 })).toMatch(/220 puntos/);
        expect(faltaEnPuntos({ puntos: 200, info, total: 2 })).toMatch(/mínimo a pagar/);
        expect(faltaEnPuntos({ puntos: 150, info, total: 5 })).toBeNull();
        expect(faltaEnPuntos({ puntos: 150, info: { ...info, puntos: { ...info.puntos, puede_canjear: false } }, total: 5 })).toMatch(/no puede/);
    });
    it('el máximo lo pone el saldo o el total', () => {
        expect(maximoDePuntos(info, 10)).toBe(220);
        expect(maximoDePuntos(info, 1.5)).toBe(145);
        expect(maximoDePuntos(null, 10)).toBe(0);
    });
});

describe('diferenciasDelCobro', () => {
    it('la reserva #12: precio prometido y cobrado; lo agregado no alarma', () => {
        const d = diferenciasDelCobro({ productos: [
            { tipo: 'precio', nombre: 'IRBESARTAN', prometido: 27.15, cobrado: 28.4 },
            { tipo: 'agregado', nombre: 'PULMO GRIP', cobrado: 9.6 },
            { tipo: 'cantidad', nombre: 'X', unidades_prometidas: 2, unidades_cobradas: 1 },
        ] });
        expect(d.map((x) => x.texto)).toEqual([
            'se prometió a $27.15 y se cobró $28.40', 'se agregó en caja ($9.60)', 'se prometieron 2 unidades y se cobraron 1 unidad',
        ]);
        expect(d.map((x) => x.alerta)).toEqual([true, false, true]);
        expect(diferenciasDelCobro(null)).toEqual([]);
    });
});

describe('agregar de una compra pasada y desglose (2026-11-19)', () => {
    it('entra con su cantidad y su presentación, y suma si ya estaba', () => {
        const a = agregarConCantidad([], { id: 2129, nombre: 'ENANTYUM' }, 1, 50);
        expect(a).toHaveLength(1);
        expect(a[0]).toMatchObject({ producto_id: 2129, factor: 1, cantidad: 50 });
        expect(agregarConCantidad(a, { id: 2129 }, 1, 2)[0].cantidad).toBe(52);
        expect(agregarConCantidad(a, { id: 2129 }, 100, 1)).toHaveLength(2);
    });
    it('crédito fiscal como la caja: 50 × $1.90 = $95 → sumas $84.07, IVA $10.93', () => {
        expect(desgloseDeVenta({ lineas: [{ subtotal: 95 }], documento: 'credito_fiscal' })).toMatchObject({ sumas: 84.07, iva: 10.93, total: 95 });
        expect(desgloseDeVenta({ lineas: [{ subtotal: 95 }], documento: 'consumidor_final' })).toBeNull();
        // Retiene 1 % desde $100 de sumas: CCF 410964 (sumas 345.29 → IVA 44.89, retención 3.45, total 386.73).
        expect(desgloseDeVenta({ lineas: [{ subtotal: 390.18 }], documento: 'credito_fiscal', retencionPct: 1 }))
            .toMatchObject({ sumas: 345.29, iva: 44.89, retencion: 3.45, total: 386.73 });
    });
});
