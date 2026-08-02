import { describe, it, expect } from 'vitest';
import { compararPorConjunto, normalizar, crudo }
    from '../../supabase/functions/_shared/compararLibros.ts';

// B1 / H10 del PLAN-CONTABILIDAD-2026-08-02.
//
// El verificador de libros comparaba en una sola dirección: comprobaba que cada
// línea del ERP existiera en el portal, y nunca lo inverso. Con eso, un libro
// INFLADO pasaba con veredicto IDENTICO — que es exactamente el modo de fallo de
// un `supplier_id` duplicado (H1): sobre junio 2026 el libro pasaba de 389 a 503
// líneas y de $203,947 a $295,805, y las 389 del ERP se encontraban igual.
//
// La red de seguridad tenía el mismo punto ciego que el bug que debía atrapar.
//
// En producción ese caso ya no se puede reproducir: el índice único de A1 lo
// impide. Por eso el candado vive acá.

const linea = (n, monto) => `01/06/2026;4;;DOC-${n};06140312700042;PROVEEDOR ${n};0.00;0.00;0.00;${monto};0.00`;

describe('compararPorConjunto — el veredicto mira los dos lados', () => {
    it('un libro inflado NO puede salir IDENTICO (H10)', () => {
        // 389 líneas en el origen; el portal emite las mismas 389 y además 114
        // duplicadas, que es lo que produce una ficha de proveedor repetida.
        const erp = Array.from({ length: 389 }, (_, i) => linea(i, '100.00'));
        const portal = [...erp, ...erp.slice(0, 114)];

        const r = compararPorConjunto(erp, portal, new Set());

        expect(r.faltan_en_el_portal).toBe(0);      // todo el ERP está
        expect(r.sobran_en_el_portal).toBe(114);    // …y además sobra
        expect(r.veredicto).toBe('DIFIERE');        // antes decía IDENTICO
    });

    it('nombra las líneas que sobran, no solo las que faltan', () => {
        const erp = [linea(1, '10.00')];
        const portal = [linea(1, '10.00'), linea(2, '20.00')];

        const r = compararPorConjunto(erp, portal, new Set());

        expect(r.veredicto).toBe('DIFIERE');
        expect(r.diferencias).toHaveLength(1);
        expect(r.diferencias[0].donde).toBe('solo en el portal');
        expect(r.diferencias[0].portal).toContain('DOC-2');
    });

    it('sigue detectando lo que falta', () => {
        const erp = [linea(1, '10.00'), linea(2, '20.00')];
        const portal = [linea(1, '10.00')];

        const r = compararPorConjunto(erp, portal, new Set());

        expect(r.faltan_en_el_portal).toBe(1);
        expect(r.sobran_en_el_portal).toBe(0);
        expect(r.veredicto).toBe('DIFIERE');
        expect(r.diferencias[0].donde).toBe('solo en el ERP');
    });

    it('iguales de verdad dan IDENTICO', () => {
        const filas = [linea(1, '10.00'), linea(2, '20.00')];
        const r = compararPorConjunto(filas, [...filas].reverse(), new Set());

        expect(r.veredicto).toBe('IDENTICO');
        expect(r.distintas).toBe(0);
    });

    it('dos vacíos son AMBOS VACIOS, y solo si los dos lo están', () => {
        expect(compararPorConjunto([], [], new Set()).veredicto).toBe('AMBOS VACIOS');
        // El origen vacío y el portal con líneas es el caso peligroso: antes
        // caía en 'AMBOS VACIOS' porque solo se miraba el largo del ERP.
        expect(compararPorConjunto([], [linea(1, '10.00')], new Set()).veredicto).toBe('DIFIERE');
    });

    it('una columna omitida no puede tapar una línea de más', () => {
        const erp = [linea(1, '10.00')];
        const portal = [linea(1, '10.00'), linea(1, '10.00')];
        // Aunque se ignoren columnas, el sobrante sigue contando.
        const r = compararPorConjunto(erp, portal, new Set([4, 5]));

        expect(r.sobran_en_el_portal).toBe(1);
        expect(r.veredicto).toBe('DIFIERE');
    });
});

describe('normalizar / crudo — el formato decimal se ve, no se tapa (H21)', () => {
    it('normalizar iguala 1166 y 1166.00, que es el mismo valor', () => {
        expect(normalizar('a;1166;b')).toBe(normalizar('a;1166.00;b'));
    });

    it('crudo NO los iguala, y por eso se pueden contar aparte', () => {
        expect(crudo('a;1166;b')).not.toBe(crudo('a;1166.00;b'));
    });

    it('no toca códigos ni textos que parezcan números', () => {
        expect(normalizar('DTE-03-M001;ABC123')).toBe('DTE-03-M001;ABC123');
    });
});
