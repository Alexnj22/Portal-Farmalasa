import { describe, it, expect } from 'vitest';
import {
    aMesYAnio, loteValido, loteSinRotulo, deTextoLibre, loteYVence,
    nombreLimpio,
} from '../../supabase/functions/_shared/loteVencimiento.ts';

// Lote y vencimiento de una compra, leídos del texto del proveedor.
//
// **Estas pruebas existen porque lo que produce este código entra al inventario
// como fecha de vencimiento de un medicamento.** Un mes corrido o un lote
// inventado no dan error: se descubren contando, o no se descubren.
//
// Las cadenas de abajo son LITERALES de producción —`items_text` y el texto de
// los PDF, leídos el 2026-08-16—, no ejemplos redactados. Ese es el punto: un
// caso inventado prueba la regex contra sí misma.
//
// El año de referencia va fijo en 2026 para que la ventana de fechas creíbles
// no dependa de cuándo se corran las pruebas.
const A = 2026;

describe('aMesYAnio — el día del proveedor es ruido', () => {
    it('descarta el día en dd/mm/aaaa', () => {
        expect(aMesYAnio('01/01/2030', A)).toBe('2030-01-01');   // COFARSAL
        expect(aMesYAnio('31/10/2027', A)).toBe('2027-10-01');   // RONASA
        expect(aMesYAnio('30/11/2027', A)).toBe('2027-11-01');   // AMERICANA
        expect(aMesYAnio('18-07-2027', A)).toBe('2027-07-01');   // IMBERTON
    });

    it('acepta mes/año a secas', () => {
        expect(aMesYAnio('04/2028', A)).toBe('2028-04-01');      // GAMMA
        expect(aMesYAnio('12-27', A)).toBe('2027-12-01');        // VIJOSA
    });

    it('rechaza el precio que parece fecha', () => {
        // El caso real: `12.00` de LETERAGO se leía como diciembre del 2000 y
        // corría el ancla del lote un campo entero.
        expect(aMesYAnio('12.00', A)).toBeNull();
        expect(aMesYAnio('5.00', A)).toBeNull();
        expect(aMesYAnio('7.000000', A)).toBeNull();
    });

    it('rechaza el mes imposible y el año fuera de ventana', () => {
        expect(aMesYAnio('13/2028', A)).toBeNull();
        expect(aMesYAnio('00/2028', A)).toBeNull();
        expect(aMesYAnio('01/1999', A)).toBeNull();
        expect(aMesYAnio('01/2099', A)).toBeNull();
        expect(aMesYAnio('30112027', A)).toBeNull();   // sin separadores: no se adivina
        expect(aMesYAnio(null, A)).toBeNull();
        expect(aMesYAnio('', A)).toBeNull();
    });

    it('un vencimiento recién vencido sigue siendo creíble', () => {
        // Se compra stock por vencer y se recibe con fecha pasada; lo que no
        // existe es un vencimiento de hace 26 años.
        expect(aMesYAnio('01/2024', A)).toBe('2024-01-01');
    });
});

describe('loteValido — un lote inventado es peor que ninguno', () => {
    it('rechaza el guion del rótulo de IMBERTON', () => {
        expect(loteValido('-')).toBeNull();
        expect(loteValido('--')).toBeNull();
        expect(loteValido('')).toBeNull();
        expect(loteValido(null)).toBeNull();
    });
    it('acepta un lote de verdad', () => {
        expect(loteValido('D26017')).toBe('D26017');
        expect(loteValido('8168')).toBe('8168');
    });
});

describe('deTextoLibre — el formato de cada proveedor', () => {
    const casos = [
        ['COFARSAL',
         'FARDEL|LORATADINA FARDEL 5.0mg/5ml x 60 ml Lote: 6165 Cant.: 4. Fecha Exp.: 01/05/2029',
         '6165', '2029-05-01'],
        ['RONASA',
         '012111 TOTALVIT KID JARABE X 120 ML LOTE: 251082 VENCE: 31/10/2027',
         '251082', '2027-10-01'],
        ['NUEVA SAN CARLOS',
         'SA010079 BRONCATOX JBE X 120 ML LOTE: 118655 VENCE: 30/11/2027',
         '118655', '2027-11-01'],
        ['VIJOSA (mes y año, sin día)',
         'VIDOL011-02 DOLO RELAFLEX T 10 TABLETAS RECUBIERTAS LOTE: 2509096 (V-12-27) CANT: 1',
         '2509096', '2027-12-01'],
        ['AMERICANA (posicional entre pipes)',
         'OVESTIN CREMA 1MG. X 15GR.|B22625K|30/11/2027|7.000000',
         'B22625K', '2027-11-01'],
        ['SANTA LUCIA (posicional, con código de barras en el nombre)',
         'NEUFIL JARABE X 200 ML 5600360210054|250887|31/01/2031|FCO|0.00',
         '250887', '2031-01-01'],
        ['MONTREAL (token antes del rótulo)',
         'SUVIAR 5 MG X 45 TAB L60640 V. 01-04-2029 2',
         'L60640', '2029-04-01'],
        ['IMBERTON (la fila entera rotulada)',
         'SIMILAC RICE 400GX6IT cantidad - lote - fecha caducidad 2 - 790748N11 - 18-07-2027',
         '790748N11', '2027-07-01'],
    ];

    for (const [quien, texto, lote, vence] of casos) {
        it(`${quien}`, () => {
            expect(deTextoLibre(texto, A)).toEqual({ lote, vence });
        });
    }

    it('LETERAGO: el precio no es la fecha, y `false` no es el lote', () => {
        // Sin la ventana de años, esto devolvía { lote: 'false', vence: '2000-12-01' }.
        const r = deTextoLibre('false|12.00|02197|01/12/2027|5.00|', A);
        expect(r.vence).toBe('2027-12-01');
        expect(r.lote).not.toBe('false');
        expect(r.lote).toBe('02197');
    });

    it('no inventa nada cuando el proveedor no lo manda', () => {
        // CONGELADOS y STEINER: nombre|código de barras|unidades|empaque.
        expect(deTextoLibre('Choco Cono Sarita|7401090803022|15.000 |Caja', A))
            .toEqual({ lote: null, vence: null });
        expect(deTextoLibre('ELECTROLIT MORA AZUL 625ML | 7501125184277', A))
            .toEqual({ lote: null, vence: null });
        // SAVONA: sólo el nombre.
        expect(deTextoLibre('PALETA SANDIA CJA 25U', A))
            .toEqual({ lote: null, vence: null });
    });

    it('no confunde el gramaje con un lote', () => {
        expect(loteSinRotulo('AGUA FRIA 500ML 30/09/2027', A)).toBeNull();
        expect(loteSinRotulo('TAB. X 30 V. 01-04-2029', A)).toBeNull();
    });
});

describe('loteYVence — la descripción primero, el PDF después', () => {
    const pdfGamma =
        'CUERPO DEL DOCUMENTO Código Descripción Lote Vence Cant. Precio unitario $ ' +
        'Ventas no sujetas $ Ventas exentas $ Ventas afectas $ ' +
        '21AG ADEMIN GOT. PED. F X 15ml. D26017 04/2028 4.00 2.548673 10.19 ' +
        '18AG AZTHOMAC 200mg/5ml. Polv. P/S. F X 30ml. E26078 05/2028 2.00 5.141593 10.28';

    it('GAMMA: columnas del PDF, ancladas entre la descripción y la cantidad', () => {
        expect(loteYVence(pdfGamma, {
            descripcion: 'ADEMIN GOT. PED. F X 15ml.', cantidad: 4,
        }, A)).toEqual({ lote: 'D26017', vence: '2028-04-01', de: 'pdf/columnas' });
    });

    it('GAMMA: el segundo renglón no se lleva el lote del primero', () => {
        expect(loteYVence(pdfGamma, {
            descripcion: 'AZTHOMAC 200mg/5ml. Polv. P/S. F X 30ml.', cantidad: 2,
        }, A)).toEqual({ lote: 'E26078', vence: '2028-05-01', de: 'pdf/columnas' });
    });

    it('MENFAR: rótulos en el PDF, y el vencimiento que el proveedor NO manda', () => {
        const pdf = '1 11502 6 MONOCINQUE 40MG 30COMP. Lote: 12007A Vencimiento: ? Cantidad: 6 12.88';
        expect(loteYVence(pdf, { descripcion: 'MONOCINQUE 40MG 30COMP.', cantidad: 6 }, A))
            .toEqual({ lote: '12007A', vence: null, de: 'pdf/rotulos' });
    });

    it('cuando está en la descripción, ni mira el PDF', () => {
        const r = loteYVence('un pdf que no dice nada de esto', {
            descripcion: 'X LOTE: 251082 VENCE: 31/10/2027', cantidad: 3,
        }, A);
        expect(r).toEqual({ lote: '251082', vence: '2027-10-01', de: 'descripcion' });
    });

    it('sin ancla devuelve nulo — no adivina', () => {
        expect(loteYVence('otro documento entero', { descripcion: 'PALETA SANDIA CJA 25U', cantidad: 1 }, A))
            .toEqual({ lote: null, vence: null, de: 'no encontrado' });
        expect(loteYVence('', { descripcion: '', cantidad: 1 }, A).lote).toBeNull();
    });
});

describe('nombreLimpio — lo que se busca en el catálogo', () => {
    const casos = [
        // COFARSAL: `LAB|NOMBRE …cola…`, el nombre va DESPUÉS del pipe
        ['FARDEL|LORATADINA FARDEL 5.0mg/5ml x 60 ml Lote: 6165 Cant.: 4. Fecha Exp.: 01/05/2029',
         'LORATADINA FARDEL 5.0mg/5ml x 60 ml'],
        // AMERICANA: `NOMBRE|lote|fecha|cant`, el nombre va ANTES
        ['OVESTIN CREMA 1MG. X 15GR.|B22625K|30/11/2027|7.000000',
         'OVESTIN CREMA 1MG. X 15GR.'],
        ['RONASA sin pipes: TOTALVIT KID JARABE X 120 ML LOTE: 251082 VENCE: 31/10/2027'
            .replace('RONASA sin pipes: ', ''),
         'TOTALVIT KID JARABE X 120 ML'],
        ['SUVIAR 5 MG X 45 TAB L60640 V. 01-04-2029 2', 'SUVIAR 5 MG X 45 TAB L60640'],
        ['VIDOL011-02 DOLO RELAFLEX T 10 TABLETAS RECUBIERTAS LOTE: 2509096 (V-12-27) CANT: 1',
         'VIDOL011-02 DOLO RELAFLEX T 10 TABLETAS RECUBIERTAS'],
        ['SIMILAC RICE 400GX6IT cantidad - lote - fecha caducidad 2 - 790748N11 - 18-07-2027',
         'SIMILAC RICE 400GX6IT'],
        ['Choco Cono Sarita|7401090803022|15.000 |Caja', 'Choco Cono Sarita'],
        ['ADEMIN GOT. PED. F X 15ml.', 'ADEMIN GOT. PED. F X 15ml.'],
    ];
    for (const [entra, sale] of casos) {
        it(`«${entra.slice(0, 42)}…»`, () => expect(nombreLimpio(entra)).toBe(sale));
    }
    it('no se queda vacío ni con basura', () => {
        expect(nombreLimpio('')).toBe('');
        expect(nombreLimpio(null)).toBe('');
    });
});
