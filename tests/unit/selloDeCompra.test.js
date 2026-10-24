import { describe, it, expect } from 'vitest';
import { lineasDelLibro, sellosDeLasCompras } from '../../supabase/functions/_shared/selloDeCompra.ts';

/* Casos reales de Bodega (erp_sucursal_id 6). NIT y NRC de `proveedores_maestro`
 * y sellos tal como están hoy en `purchase_receipts`. */
const ANA = { proveedor: 30, identificaciones: ['12171406701039', '1466461', '146646-1'] };
const IMBERTON = { proveedor: 13, identificaciones: ['06140812610145', '1570', '157-0'] };
const LETERAGO = { proveedor: 82, identificaciones: ['06142505071078', '1802273'] };
const COFARSAL = { proveedor: 9, identificaciones: ['06140312700042', '94153'] };

const SELLO_ANA = '20266190E1B85D4E4CA9BAAA548081A3B020QY3V';
const SELLO_IMB = 'A'.repeat(40);
const SELLO_LET = '202618E24BCE84144FEBB01C103AAF77E3E77D7M';

/** Un renglón del CSV del libro: 23 columnas, `;`, número en la 3, NIT en la 4, sello en la 22. */
function renglon(numero, nit, sello) {
    const c = Array(23).fill('');
    c[3] = numero; c[4] = nit; c[5] = 'NOMBRE'; c[22] = sello;
    return c.join(';');
}

describe('el sello de una compra exige número Y emisor', () => {
    it('6186 / 6188 (5-oct): mismo número, proveedores distintos — cada una con el suyo', () => {
        const csv = [
            renglon('32CBC8C1-E72B-4EE5-', '1217-140670-103-9', SELLO_ANA),
            renglon('32CBC8C1-E72B-4EE5- ', '0614-081261-014-5', SELLO_IMB),
        ].join('\n');
        const r = sellosDeLasCompras([
            { id: 6186, numero: '32CBC8C1-E72B-4EE5-', ...ANA },
            { id: 6188, numero: '32CBC8C1-E72B-4EE5- ', ...IMBERTON },
        ], lineasDelLibro(csv));
        expect(r.get(6186)).toEqual({ sello: SELLO_ANA, revisar: null });
        expect(r.get(6188)).toEqual({ sello: SELLO_IMB, revisar: null });
    });

    it('si el libro trae el número sólo con UN emisor, el otro no hereda el sello: va a revisión', () => {
        const csv = renglon('32CBC8C1-E72B-4EE5-', '12171406701039', SELLO_ANA);
        const r = sellosDeLasCompras([
            { id: 6186, numero: '32CBC8C1-E72B-4EE5-', ...ANA },
            { id: 6188, numero: '32CBC8C1-E72B-4EE5-', ...IMBERTON },
        ], lineasDelLibro(csv));
        expect(r.get(6186).sello).toBe(SELLO_ANA);
        expect(r.get(6188)).toEqual({ sello: null, revisar: 'emisor-no-coincide' });
    });

    it('5249 / 5250 (21-jul): el sello de LETERAGO no pasa a COFARSAL', () => {
        const csv = [
            renglon('22C0CAD6-F988-4976-9', '06142505071078', SELLO_LET),
            renglon('0059E8E4-37D6-424C-A', '06140312700042', SELLO_LET),
        ].join('\n');
        const r = sellosDeLasCompras([
            { id: 5249, numero: '22C0CAD6-F988-4976-9', ...LETERAGO },
            { id: 5250, numero: '0059E8E4-37D6-424C-A', ...COFARSAL },
        ], lineasDelLibro(csv));
        // El mismo sello bajo dos documentos: no se sabe de cuál es, ninguno lo lleva.
        expect(r.get(5249)).toEqual({ sello: null, revisar: 'sello-en-varios-documentos' });
        expect(r.get(5250)).toEqual({ sello: null, revisar: 'sello-en-varios-documentos' });
    });

    it('el renglón del emisor de la compra, aunque venga con NRC en vez de NIT', () => {
        const csv = renglon('0059E8E4-37D6-424C-A', '9415-3', 'B'.repeat(40));
        const r = sellosDeLasCompras([{ id: 5250, numero: '0059E8E4-37D6-424C-A', ...COFARSAL }], lineasDelLibro(csv));
        expect(r.get(5250)).toEqual({ sello: 'B'.repeat(40), revisar: null });
    });

    it('un proveedor sin NIT conocido no recibe sello: revisión', () => {
        const csv = renglon('X1', '06140312700042', 'C'.repeat(40));
        const r = sellosDeLasCompras([{ id: 1, numero: 'X1', proveedor: 99, identificaciones: [null, ''] }], lineasDelLibro(csv));
        expect(r.get(1)).toEqual({ sello: null, revisar: 'proveedor-sin-nit' });
    });

    it('dos sellos distintos para el mismo documento: revisión, no se elige', () => {
        const csv = [renglon('X1', '06140312700042', 'C'.repeat(40)), renglon('X1', '06140312700042', 'D'.repeat(40))].join('\n');
        const r = sellosDeLasCompras([{ id: 1, numero: 'X1', ...COFARSAL }], lineasDelLibro(csv));
        expect(r.get(1)).toEqual({ sello: null, revisar: 'varios-sellos' });
    });

    it('el mismo número del mismo proveedor en dos compras: revisión', () => {
        const csv = renglon('X1', '06140312700042', 'C'.repeat(40));
        const r = sellosDeLasCompras([
            { id: 1, numero: 'X1', ...COFARSAL },
            { id: 2, numero: 'X1', ...COFARSAL },
        ], lineasDelLibro(csv));
        expect(r.get(1).revisar).toBe('documento-repetido');
        expect(r.get(2).revisar).toBe('documento-repetido');
    });

    it('un sello contaminado (H19) no se guarda', () => {
        const csv = renglon('X1', '06140312700042', `${'E'.repeat(40)}benicar`);
        const r = sellosDeLasCompras([{ id: 1, numero: 'X1', ...COFARSAL }], lineasDelLibro(csv));
        expect(r.get(1)).toEqual({ sello: null, revisar: 'sello-mal-formado' });
    });

    it('sin renglón en el libro, o sin sello: nada que decidir ni revisar', () => {
        const csv = renglon('X2', '06140312700042', '');
        const r = sellosDeLasCompras([
            { id: 1, numero: 'X1', ...COFARSAL },
            { id: 2, numero: 'X2', ...COFARSAL },
        ], lineasDelLibro(csv));
        expect(r.get(1)).toEqual({ sello: null, revisar: null });
        expect(r.get(2)).toEqual({ sello: null, revisar: null });
    });
});
