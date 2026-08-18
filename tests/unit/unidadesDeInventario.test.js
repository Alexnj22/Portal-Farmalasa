import { describe, it, expect } from 'vitest';
import {
    factorDe,
    factorDeFila,
    unidadesDe,
    sumaUnidades,
    lotesEnUnidades,
} from '../../src/utils/unidadesInventario';

// Cuántas unidades hay en una fila de inventario.
//
// **Estas pruebas existen porque este número decide si un producto se puede
// pedir.** No es una etiqueta: la guarda del formulario de traslado y el
// trigger `validar_solicitud_traslado` comparan contra él, así que contarlo de
// menos no muestra un número feo — **bloquea el pedido**.
//
// El caso que las motivó es real y está medido. El 2026-08-18 la Consulta de
// Inventario decía «Bodega · 3 uds» de CLOPRIM X 3 AMPOLLAS y el formulario
// abierto desde esa misma fila decía «Bodega — 1 unidad». Bodega tenía 1 caja
// de 3 ampollas. La lista multiplicaba por el `detalle` de la fila (`1X3`); la
// base lo buscaba en el catálogo cruzando la etiqueta, y el sistema de origen
// manda `'CAJA '` con un espacio al final contra el `'CAJA'` del catálogo — no
// calzaba, caía al factor 1, y la caja no se podía pedir.
//
// Hoy el factor lo resuelve la base (`factor_de_inventario`) y viaja en la
// fila. Lo que se prueba acá es que el navegador USE ese número y no lo vuelva
// a deducir.

describe('factorDe — leer el factor del texto de la fila', () => {
    it('lee el formato limpio, que son 24,031 de las 24,181 filas', () => {
        expect(factorDe('1x30')).toBe(30);
        expect(factorDe('1X3')).toBe(3);
    });

    it('tolera las variantes de espaciado medidas en producción', () => {
        expect(factorDe('1 X 1')).toBe(1);
        expect(factorDe('1X 16')).toBe(16);
        expect(factorDe('X 25')).toBe(25);
    });

    it('sin número después de la x, es una presentación suelta', () => {
        expect(factorDe('1')).toBe(1);
        expect(factorDe('')).toBe(1);
        expect(factorDe(null)).toBe(1);
        expect(factorDe(undefined)).toBe(1);
    });

    it('NUNCA devuelve 0 — borraría la existencia en silencio', () => {
        expect(factorDe('1x0')).toBe(1);
    });
});

describe('factorDeFila — manda el que resolvió la base', () => {
    it('usa el `factor` de la fila cuando vino', () => {
        // ELEQUINE 750 X 20: el sistema de origen manda `detalle = '1'` dentro
        // de una CAJA X 20. Sólo el catálogo sabe que son 20, y por eso el
        // número lo resuelve la base.
        expect(factorDeFila({ factor: 20, detalle: '1', presentacion: 'CAJA X 20' })).toBe(20);
    });

    it('cae a `detalle` cuando la fila no trae factor', () => {
        expect(factorDeFila({ detalle: '1X3' })).toBe(3);
        expect(factorDeFila({ factor: null, detalle: '1x30' })).toBe(30);
    });

    it('un factor 0 o basura no se usa: se lee `detalle`', () => {
        // Las recargas de saldo tienen factor 0 activo en el catálogo. Un 0 que
        // pasara acá dejaría 453 recargas en cero unidades.
        expect(factorDeFila({ factor: 0, detalle: '1X1' })).toBe(1);
        expect(factorDeFila({ factor: 'ocho', detalle: '1X3' })).toBe(3);
    });
});

describe('CLOPRIM X 3 AMPOLLAS en Bodega — el caso que lo destapó', () => {
    // La fila tal como está en producción: presentación con el espacio al final
    // que rompía el cruce contra el catálogo.
    const CAJA_EN_BODEGA = {
        erp_product_id: 187,
        erp_sucursal_id: 6,
        presentacion: 'CAJA ',
        detalle: '1X3',
        factor: 3,
        cantidad: 1,
        lote: '1014425',
        fecha_vencimiento: '2028-10-01',
    };

    it('1 caja de 3 ampollas son 3 unidades, no 1', () => {
        expect(unidadesDe(CAJA_EN_BODEGA)).toBe(3);
    });

    it('el lote suma lo mismo que la fila — es el número que se reparte', () => {
        const [lote] = lotesEnUnidades([CAJA_EN_BODEGA]);
        expect(lote.unidades).toBe(3);
        expect(lote.lote).toBe('1014425');
    });

    it('las filas en cero del mismo lote no cambian el total', () => {
        // El mismo lote llega partido en CAJA, CAJA X 3 y UNIDAD; en Bodega
        // sólo la primera tiene existencia.
        const filas = [
            CAJA_EN_BODEGA,
            { ...CAJA_EN_BODEGA, presentacion: 'CAJA X 3', factor: 3, cantidad: 0 },
            { ...CAJA_EN_BODEGA, presentacion: 'UNIDAD', factor: 1, cantidad: 0 },
        ];
        expect(sumaUnidades(filas)).toBe(3);
        expect(lotesEnUnidades(filas)).toHaveLength(1);
    });
});

describe('sumaUnidades — el mismo lote partido en varias presentaciones', () => {
    it('convierte antes de sumar (amoxicilina 500 en La Popular)', () => {
        // Medido el 2026-08-07: lote L5M5137 son 24 CAJA (1x30), 1 BLISTER
        // (1x10) y 3 UNIDAD (1x1) = 733 unidades, no 28.
        const filas = [
            { presentacion: 'CAJA', factor: 30, cantidad: 24 },
            { presentacion: 'BLISTER', factor: 10, cantidad: 1 },
            { presentacion: 'UNIDAD', factor: 1, cantidad: 3 },
        ];
        expect(sumaUnidades(filas)).toBe(733);
    });
});
