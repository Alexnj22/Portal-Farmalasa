import { describe, expect, it } from 'vitest';
import { hojasEnPdf, pdfDeJpegs } from '@nucleo/utils/hojasEnPdf';

// Un JPEG mínimo: SOI + un SOF0 que dice 300×200 + EOI. `medirJpeg` sólo lee
// el marcador, así que alcanza para medir y para incrustar.
const jpeg = (ancho = 300, alto = 200) => new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xC0, 0x00, 0x11, 0x08, alto >> 8, alto & 0xFF, ancho >> 8, ancho & 0xFF, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xFF, 0xD9,
]);
const comoTexto = (b) => new TextDecoder('latin1').decode(b);

describe('pdfDeJpegs', () => {
    it('arma un PDF con una página por JPEG, del tamaño de la foto', () => {
        const pdf = comoTexto(pdfDeJpegs([jpeg(300, 200), jpeg(200, 300)]));
        expect(pdf.startsWith('%PDF-1.4')).toBe(true);
        expect(pdf).toContain('/Count 2');
        expect(pdf).toContain('/MediaBox [0 0 792 528]');
        expect(pdf).toContain('/MediaBox [0 0 528 792]');
        expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    });

    it('la tabla xref apunta al inicio de cada objeto', () => {
        const bytes = pdfDeJpegs([jpeg()]);
        const pdf = comoTexto(bytes);
        const inicio = Number(pdf.match(/startxref\n(\d+)/)[1]);
        expect(pdf.slice(inicio, inicio + 4)).toBe('xref');
        const filas = pdf.slice(inicio).split('\n').slice(3, 8);
        filas.forEach((fila, i) => {
            const pos = Number(fila.slice(0, 10));
            expect(pdf.slice(pos, pos + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
        });
    });

    it('rechaza lo que no es un JPEG medible', () => {
        expect(() => pdfDeJpegs([new Uint8Array([1, 2, 3])])).toThrow('No se pudo medir');
        expect(() => pdfDeJpegs([])).toThrow('No hay hojas');
    });
});

describe('hojasEnPdf', () => {
    it('devuelve el mismo PDF como archivo', async () => {
        const f = await hojasEnPdf([new File([jpeg()], 'a.jpg', { type: 'image/jpeg' })], 'curriculum.jpg');
        expect(f.name).toBe('curriculum.pdf');
        expect(f.type).toBe('application/pdf');
        expect(new Uint8Array(await f.arrayBuffer())).toEqual(pdfDeJpegs([jpeg()]));
    });
});
