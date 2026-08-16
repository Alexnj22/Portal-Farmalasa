import { describe, it, expect } from 'vitest';
import { resumenRenglones } from '../../src/data/facturasSala';

// El renglón que ve la sala en «Facturas de mi sala». Las cadenas de abajo son
// LITERALES de producción (`purchase_dte_documents.items_text`, leídas el
// 2026-08-16), no ejemplos inventados: es lo único que prueba que el separador
// y el código del proveedor se leen como son.
//
// El caso que lo destapó es el documento 5213 — COFARSAL, 10/08/26, $662.25 —
// que en pantalla decía:
//
//   2218 GRUPO DE TELEFONIAS · RECARGA TIGO $ 25.00 · Cant.: 8. · 2218 GRUPO DE
//   TELEFONIAS · RECARGA TIGO $ 25.00 · Cant.: 8. · 2226 GRUPO DE TELEFONIAS ·
//   RECARGA CLARO $1.00 · Cant.: 300.
//
// …cuando lo que compró la sala fueron 16 recargas Tigo de $25 y 300 de Claro
// de $1 (400 × 0.96307 + 300 × 0.9234 = 662.25, el total exacto de la factura).

const DOC_5213 = '2218 GRUPO DE TELEFONIAS|RECARGA TIGO $ 25.00 \rLote: 8168 Cant.: 8. Fecha Exp.: 01/01/2030 | 2218 GRUPO DE TELEFONIAS|RECARGA TIGO $ 25.00 \rLote: 8253 Cant.: 8. Fecha Exp.: 01/01/2030 | 2226 GRUPO DE TELEFONIAS|RECARGA CLARO $1.00 \rLote: 8252 Cant.: 300. Fecha Exp.: 01/01/2030';
const DOC_5135 = '2218 GRUPO DE TELEFONIAS|RECARGA TIGO $ 25.00 \rLote: 8168 Cant.: 16. Fecha Exp.: 01/01/2030';
const DOC_5395 = '3 AGUA FRIA 500ML | 4 GARRAFA DE AGUA';
const DOC_5178 = 'Artículo: RECARGA ELECTRONICA. Núm. Teléfono: 77097722';

describe('resumenRenglones', () => {
    it('separa los renglones por ` | ` y no por el `|` que el proveedor escribe adentro', () => {
        expect(resumenRenglones(DOC_5135)).toBe('RECARGA TIGO $ 25.00 × 16');
        // Lo que NO puede volver a pasar: el grupo del proveedor pintado como
        // si fuera un producto de la factura.
        expect(resumenRenglones(DOC_5135)).not.toContain('GRUPO DE TELEFONIAS');
    });

    it('suma los lotes del mismo producto en vez de repetir el renglón', () => {
        expect(resumenRenglones(DOC_5213))
            .toBe('RECARGA TIGO $ 25.00 × 16  ·  RECARGA CLARO $1.00 × 300');
    });

    it('no se lleva el punto que cierra la oración dentro de la cantidad', () => {
        expect(resumenRenglones(DOC_5135)).not.toContain('16.');
        expect(resumenRenglones('X|PRODUCTO \rLote: 1 Cant.: 8. Fecha Exp.: 01/01/2030'))
            .toBe('PRODUCTO × 8');
    });

    it('trata el número de adelante como código del proveedor, nunca como cantidad', () => {
        // «4 GARRAFA DE AGUA» aparece igual en facturas de $4.00, $6.00 y
        // $10.00: si fuera la cantidad, las tres valdrían lo mismo.
        expect(resumenRenglones(DOC_5395)).toBe('AGUA FRIA 500ML  ·  GARRAFA DE AGUA');
    });

    it('deja intacto el renglón que no trae ni código ni cola administrativa', () => {
        expect(resumenRenglones(DOC_5178)).toBe(DOC_5178);
    });

    it('avisa cuando recorta, en vez de recortar en silencio', () => {
        const muchos = Array.from({ length: 9 }, (_, i) => `9${i} PRODUCTO ${i}`).join(' | ');
        const salida = resumenRenglones(muchos, { max: 6 });
        expect(salida).toContain('PRODUCTO 5');
        expect(salida).not.toContain('PRODUCTO 6');
        expect(salida.endsWith('y 3 más')).toBe(true);
    });

    it('sin detalle es «Sin detalle», no una cadena vacía', () => {
        expect(resumenRenglones(null)).toBe('Sin detalle');
        expect(resumenRenglones('')).toBe('Sin detalle');
        expect(resumenRenglones('   |   ')).toBe('Sin detalle');
    });

    it('una cantidad decimal se conserva y se suma sin arrastrar coma flotante', () => {
        expect(resumenRenglones('1 CAJA \rLote: A Cant.: 2,5. | 1 CAJA \rLote: B Cant.: 0.1.'))
            .toBe('CAJA × 2.6');
    });

    it('un renglón sin cantidad no se suma con otro que sí la tiene', () => {
        expect(resumenRenglones('1 CAJA | 1 CAJA \rLote: B Cant.: 3.')).toBe('CAJA');
    });
});
