import { describe, it, expect } from 'vitest';
import { indexarPrecios, presentacionesDe, listasDe, precioDe, descuentoSinIva } from '../../src/views/distribucion/precios';
import { filaNueva, montosDePagos, cambioDePagos, problemaDePagos } from '../../src/views/distribucion/pagos';

// Es el gemelo de pantalla de `dist_validar_item`: estos casos son los mismos
// que se corrieron contra el trigger en el entorno de pruebas (2026-09-28).
const listas = [
    { id: 1, nombre: 'Mayoreo', orden: 1 },
    { id: 2, nombre: 'Premium', orden: 2 },
    { id: 3, nombre: 'Vieja', orden: 3, activo: false },
];
const precios = [
    { product_id: 6, presentacion: 'UNIDAD', unidades: 1, lista_id: 1, precio_sin_iva: '2.52' },
    { product_id: 6, presentacion: 'UNIDAD', unidades: 1, lista_id: 2, precio_sin_iva: '2.40' },
    { product_id: 6, presentacion: 'PAQUETE', unidades: 12, lista_id: 1, precio_sin_iva: '30.18' },
    { product_id: 6, presentacion: 'PAQUETE', unidades: 12, lista_id: 3, precio_sin_iva: '1.00' },
];
const idx = indexarPrecios(precios, listas);
const prod = (id, precio = 9.99) => ({ product_id: id, precio_sin_iva: precio });

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

    it('el descuento en $ se escribe en el precio que se ve (con IVA en Factura)', () => {
        expect(descuentoSinIva({ tipo: 'pct', valor: 5, importeSinIva: 60.36, conIva: true })).toBeCloseTo(3.018, 6);
        expect(descuentoSinIva({ tipo: 'monto', valor: 1.13, importeSinIva: 10, conIva: true })).toBeCloseTo(1, 6);
        expect(descuentoSinIva({ tipo: 'monto', valor: 1.13, importeSinIva: 10, conIva: false })).toBeCloseTo(1.13, 6);
        expect(descuentoSinIva({ tipo: 'pct', valor: null, importeSinIva: 10, conIva: false })).toBe(0);
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
