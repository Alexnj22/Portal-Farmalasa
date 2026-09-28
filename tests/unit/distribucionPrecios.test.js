import { describe, it, expect } from 'vitest';
import { indexarPrecios, presentacionesDe, listasDe, precioDe } from '../../src/views/distribucion/precios';
import { calcularVenta, descuentoConIva } from '../../src/views/distribucion/motor';
import { totalAPagar } from '../../supabase/functions/_shared/dte/documentos.ts';
import { filaNueva, montosDePagos, cambioDePagos, problemaDePagos } from '../../src/views/distribucion/pagos';

// Es el gemelo de pantalla de `dist_validar_item`: estos casos son los mismos
// que se corrieron contra el trigger en el entorno de pruebas (2026-09-28).
const listas = [
    { id: 1, nombre: 'Mayoreo', orden: 1 },
    { id: 2, nombre: 'Premium', orden: 2 },
    { id: 3, nombre: 'Vieja', orden: 3, activo: false },
];
const precios = [
    { product_id: 6, presentacion: 'UNIDAD', unidades: 1, lista_id: 1, precio_con_iva: '2.52' },
    { product_id: 6, presentacion: 'UNIDAD', unidades: 1, lista_id: 2, precio_con_iva: '2.40' },
    { product_id: 6, presentacion: 'PAQUETE', unidades: 12, lista_id: 1, precio_con_iva: '30.18' },
    { product_id: 6, presentacion: 'PAQUETE', unidades: 12, lista_id: 3, precio_con_iva: '1.00' },
];
const idx = indexarPrecios(precios, listas);
const prod = (id, precio = 9.99) => ({ product_id: id, precio_con_iva: precio });

describe('precios por presentación y lista', () => {
    it('ordena las presentaciones de la menor a la mayor', () => {
        expect(presentacionesDe(idx, 6).map(p => p.presentacion)).toEqual(['UNIDAD', 'PAQUETE']);
    });

    it('sin precios por presentación, el producto se vende por UNIDAD al precio del catálogo', () => {
        expect(presentacionesDe(idx, 99)).toEqual([{ presentacion: 'UNIDAD', unidades: 1 }]);
        expect(precioDe(idx, prod(99, 4.5), 'UNIDAD', 2)).toEqual({ precio: 4.5, listaId: null, unidades: 1 });
        expect(precioDe(idx, prod(99), 'CAJA', 2)).toBeNull();
    });

    it('usa la lista pedida cuando tiene precio', () => {
        expect(precioDe(idx, prod(6), 'UNIDAD', 2)).toEqual({ precio: 2.4, listaId: 2, unidades: 1 });
    });

    it('si la lista pedida no tiene esa presentación, cae a la base', () => {
        expect(precioDe(idx, prod(6), 'PAQUETE', 2)).toEqual({ precio: 30.18, listaId: 1, unidades: 12 });
    });

    it('una lista desactivada no cuenta ni como respaldo', () => {
        expect(listasDe(idx, 6, 'PAQUETE').map(l => l.id)).toEqual([1]);
        expect(precioDe(idx, prod(6), 'PAQUETE', 3).listaId).toBe(1);
    });

});

describe('la pantalla calcula con el motor del documento', () => {
    // El caso que destapó el centavo: 1 paquete de $34.10 con 5% en Factura.
    // La cuenta vieja de la pantalla daba $32.40; el documento, $32.39.
    it('Factura: el total es el del documento, al centavo', () => {
        const desc = descuentoConIva({ tipo: 'pct', valor: 5, cantidad: 1, precioConIva: 34.10, conIva: true });
        expect(desc).toBe(1.71);
        const v = calcularVenta([{ cantidad: 1, precioConIva: 34.10, descuentoConIva: desc }], { tipoDoc: '01' });
        expect(v.renglones[0].importe).toBe(32.39);
        expect(v.total).toBe(32.39);
    });

    it('el $ se escribe en el precio que se ve: en Crédito Fiscal, sin IVA', () => {
        expect(descuentoConIva({ tipo: 'monto', valor: 1, cantidad: 1, precioConIva: 11.3, conIva: false })).toBeCloseTo(1.13, 8);
        const v = calcularVenta([{ cantidad: 1, precioConIva: 11.3, descuentoConIva: 1.13 }], { tipoDoc: '03' });
        expect(v.renglones[0].descuento).toBe(1);
        expect(v.renglones[0].importe).toBe(9);
        expect(v.total).toBe(10.17);
    });

    it('en 500 ventas al azar, el total de la pantalla es exactamente el de la edge function', () => {
        let semilla = 7;
        const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
        for (let k = 0; k < 500; k++) {
            const tipoDoc = azar() < 0.5 ? '01' : '03';
            const retiene1 = tipoDoc === '03' && azar() < 0.3;
            const lineas = Array.from({ length: 1 + Math.floor(azar() * 6) }, () => {
                const cantidad = 1 + Math.floor(azar() * 40);
                const precioConIva = Math.round(azar() * 5000) / 100 + 0.01;
                const desc = azar() < 0.4
                    ? descuentoConIva({ tipo: 'pct', valor: Math.floor(azar() * 10), cantidad, precioConIva, conIva: tipoDoc === '01' })
                    : 0;
                return { cantidad, precioConIva, descuentoConIva: desc };
            });
            const pantalla = calcularVenta(lineas, { tipoDoc, retiene1 });
            // Así arma los renglones distribucion-dte con los precios guardados con IVA.
            const documento = totalAPagar(tipoDoc, lineas.map(l => ({
                codigo: null, descripcion: 'x', cantidad: String(l.cantidad), precio: String(l.precioConIva),
                precioIncluyeIva: true, descuento: String(l.descuentoConIva),
            })), { retiene1 });
            expect(pantalla.total.toFixed(2)).toBe(documento);
        }
    });
});

describe('formas de pago', () => {
    const efectivo = (extra) => ({ ...filaNueva('01'), ...extra });

    it('la última fila es lo que falta', () => {
        expect(montosDePagos([efectivo({ monto: '2' }), filaNueva('03')], 25.48)).toEqual([2, 23.48]);
    });

    it('el cambio sale de lo que entrega contra lo que paga en efectivo', () => {
        expect(cambioDePagos([efectivo({ recibido: '30' })], 25.48)).toBeCloseTo(4.52, 2);
        expect(cambioDePagos([efectivo({ monto: '5', recibido: '10' }), filaNueva('03')], 25.48)).toBeCloseTo(5, 2);
    });

    it('frena el efectivo que no alcanza', () => {
        expect(problemaDePagos([efectivo({ recibido: '20' })], 25.48, {})).toMatch(/no alcanza/);
        expect(problemaDePagos([efectivo({ recibido: '30' })], 25.48, {})).toBeNull();
    });

    it('frena una última fila sin nada que cobrar', () => {
        expect(problemaDePagos([efectivo({ monto: '30' }), filaNueva('03')], 25.48, {})).toMatch(/Quítala/);
    });
});
