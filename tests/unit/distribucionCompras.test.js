import { describe, it, expect } from 'vitest';
import { leerDteDelProveedor, problemasDeCompra, totalesCalculados, cambiarUnidadesPor, totalEsperado, evaluarPrecioRelacionada } from '@nucleo/utils/distribucionCompras';

// Las cuentas de la pantalla son las de `dist_recibir_compra` (borrador 0015):
// los mismos casos (IVA mal, total mal) se corrieron contra la base.

const ccf = {
    identificacion: { tipoDte: '03', numeroControl: 'DTE-03-M001P001-000000000001234', codigoGeneracion: 'A1B2C3D4-0000-4000-8000-000000000001', fecEmi: '2026-09-20' },
    emisor: { nombre: 'DROGUERIA EJEMPLO, S.A. DE C.V.', nit: '0614-010101-101-0', nrc: '123-4' },
    cuerpoDocumento: [
        { codigo: 'AB-1', descripcion: 'ACETAMINOFEN 500 MG CAJA X 100', cantidad: 2, precioUni: 10, montoDescu: 0, ventaGravada: 20, ventaExenta: 0, ventaNoSuj: 0 },
        { codigo: 'ZZ-9', descripcion: 'SUERO ORAL', cantidad: 12, precioUni: 0.5, montoDescu: 1, ventaGravada: 5, ventaExenta: 0, ventaNoSuj: 0 },
    ],
    resumen: { totalGravada: 25, totalExenta: 0, totalNoSuj: 0, descuGravada: 0, tributos: [{ codigo: '20', valor: 3.25 }], ivaPerci1: 0.25, ivaRete1: 0, condicionOperacion: 2 },
};

describe('compras: leer el documento del proveedor', () => {
    it('llena encabezado, montos y renglones', () => {
        const { emisor, compra, items } = leerDteDelProveedor(ccf);
        expect(emisor).toEqual({ nombre: 'DROGUERIA EJEMPLO, S.A. DE C.V.', nit: '06140101011010', nrc: '1234' });
        expect(compra).toMatchObject({ tipo_doc: '03', numero: 'DTE-03-M001P001-000000000001234', fecha: '2026-09-20', condicion: 2,
            gravada: 25, iva: 3.25, percepcion: 0.25, total: 28.5 });
        expect(compra.codigo_generacion).toBe('a1b2c3d4-0000-4000-8000-000000000001');
        // el costo sale de la venta gravada (ya sin descuento), no del precio
        expect(items[1]).toMatchObject({ cantidad: 12, costo_unitario: 0.416667, neto: 5 });
    });
    it('viene envuelto con el sello: lo encuentra igual', () => {
        expect(leerDteDelProveedor({ dteJson: ccf, selloRecibido: 'X' }).compra.numero).toMatch(/1234$/);
    });
    it('la memoria elige el producto y convierte cajas en unidades', () => {
        const { items } = leerDteDelProveedor(ccf, { memoria: { 'AB-1': { product_id: 77, unidades_por: 100 } } });
        expect(items[0]).toMatchObject({ product_id: 77, recordado: true, cantidad: 200, costo_unitario: 0.1 });
        expect(items[1]).toMatchObject({ product_id: null, recordado: false });
    });
    it('un descuento al total se reparte: los renglones suman lo gravado', () => {
        const conDesc = { ...ccf, resumen: { ...ccf.resumen, descuGravada: 5, tributos: [{ codigo: '20', valor: 2.6 }] } };
        const { compra, items } = leerDteDelProveedor(conDesc);
        expect(compra.gravada).toBe(20);
        const { productos } = totalesCalculados(items, '03');
        expect(Math.abs(productos - 20)).toBeLessThanOrEqual(0.02);
    });
    it('rechaza lo que no es un documento, o uno de otro tipo', () => {
        expect(() => leerDteDelProveedor({ hola: 1 })).toThrow(/no es un documento/);
        expect(() => leerDteDelProveedor({ ...ccf, identificacion: { ...ccf.identificacion, tipoDte: '05' } })).toThrow(/tipo 05/);
    });
    it('cambiar las unidades por empaque recalcula sin perder el neto', () => {
        const it0 = leerDteDelProveedor(ccf).items[0];
        const c = cambiarUnidadesPor(it0, 50);
        expect(c).toMatchObject({ cantidad: 100, costo_unitario: 0.2 });
    });
});

describe('compras: lo que impide recibir', () => {
    const base = {
        proveedor_id: 1, tipo_doc: '03', numero: 'CCF-1', fecha: '2026-09-20', condicion: 1,
        gravada: 25, exenta: 0, iva: 3.25, percepcion: 0, retencion: 0, total: 28.25,
        items: [{ product_id: 2, cantidad: 10, costo_unitario: 2.5, lote: 'L1', vence: '2027-12-31' }],
    };
    const hoy = '2026-09-30';
    it('una compra bien hecha no tiene problemas', () => {
        expect(problemasDeCompra(base, { hoy })).toEqual([]);
        expect(totalEsperado(base)).toBe(28.25);
    });
    it('IVA y total: los mismos textos que la base', () => {
        const p = problemasDeCompra({ ...base, iva: 3, total: 28 }, { hoy });
        expect(p.map(x => x.campo)).toEqual(['iva']);
        expect(problemasDeCompra({ ...base, total: 29.25 }, { hoy }).map(x => x.campo)).toEqual(['total']);
    });
    it('renglón sin lote, vencido o con unidades partidas', () => {
        const p = problemasDeCompra({ ...base, items: [{ ...base.items[0], lote: '', cantidad: 2.5 }] }, { hoy });
        expect(p.map(x => x.texto).join(' | ')).toMatch(/entero.*lote o el vencimiento/);
        expect(problemasDeCompra({ ...base, items: [{ ...base.items[0], vence: hoy }] }, { hoy })[0].texto).toMatch(/vencido/);
    });
    it('los productos no suman el documento', () => {
        expect(problemasDeCompra({ ...base, gravada: 30, iva: 3.9, total: 33.9 }, { hoy }).map(x => x.campo)).toEqual(['gravada']);
    });
    it('al crédito exige vencimiento; fecha futura no', () => {
        expect(problemasDeCompra({ ...base, condicion: 2 }, { hoy })[0].campo).toBe('vence');
        expect(problemasDeCompra({ ...base, fecha: '2026-10-05' }, { hoy })[0].campo).toBe('fecha');
    });
    it('en una Factura el IVA no se acredita: el costo es el precio completo', () => {
        expect(totalesCalculados(base.items, '01')).toEqual({ productos: 25, iva: 0 });
    });
});

describe('compras a relacionadas: precio de mercado', () => {
    const ref = { costo_farmalasa: 0.8754, mayoreo_sin_iva: 1.150442, precio_torogoz_sin_iva: 1.548673 };
    it('dentro de lo razonable: sin avisos', () => {
        expect(evaluarPrecioRelacionada(1.10, ref)).toEqual([]);
    });
    it('bajo el costo de Farmalasa: rojo (y no repite el de mayoreo)', () => {
        expect(evaluarPrecioRelacionada(0.80, ref).map(a => a.clave)).toEqual(['bajo_costo']);
    });
    it('más de 10 % bajo el mayoreo a terceros: naranja', () => {
        expect(evaluarPrecioRelacionada(1.00, ref).map(a => a.clave)).toEqual(['bajo_mayoreo']);
    });
    it('al precio de venta de Torogoz o más: sin margen', () => {
        expect(evaluarPrecioRelacionada(1.60, ref).map(a => a.clave)).toEqual(['sin_margen']);
    });
    it('el caso del producto 4: cualquier precio justo deja a una en pérdida', () => {
        const r4 = { costo_farmalasa: 2.1483, mayoreo_sin_iva: 2.787611, precio_torogoz_sin_iva: 1.902655 };
        expect(evaluarPrecioRelacionada(2.20, r4).map(a => a.clave)).toEqual(['bajo_mayoreo', 'sin_margen']);
        expect(evaluarPrecioRelacionada(1.80, r4).map(a => a.clave)).toEqual(['bajo_costo']);
    });
    it('sin referencias o sin precio: no inventa avisos', () => {
        expect(evaluarPrecioRelacionada(1, null)).toEqual([]);
        expect(evaluarPrecioRelacionada(0, ref)).toEqual([]);
    });
});
