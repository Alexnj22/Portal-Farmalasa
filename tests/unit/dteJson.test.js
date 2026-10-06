import { describe, expect, it } from 'vitest';
import { renglonesDelDte, totalesDelDte } from '@nucleo/utils/dteJson';

describe('dteJson', () => {
    const doc = {
        cuerpoDocumento: [
            { numItem: 1, codigo: 'A1', descripcion: '  LORATADINA  10MG ', cantidad: 2, uniMedida: 59, precioUni: 1.5, ventaGravada: 3, ventaExenta: 0, ventaNoSuj: 0, montoDescu: 0 },
            { descripcion: '', cantidad: '1', ventaExenta: '4.10' },
        ],
        resumen: { totalGravada: 3, totalExenta: 4.1, tributos: [{ codigo: '20', valor: 0.39 }], totalPagar: 7.49 },
    };
    it('lee los renglones, limpia la descripción y suma la venta', () => {
        expect(renglonesDelDte(doc)).toEqual([
            { numero: 1, codigo: 'A1', descripcion: 'LORATADINA 10MG', cantidad: 2, unidad: 59, precio: 1.5, descuento: 0, total: 3 },
            { numero: 2, codigo: null, descripcion: 'Sin descripción', cantidad: 1, unidad: null, precio: null, descuento: 0, total: 4.1 },
        ]);
    });
    it('el IVA sale del tributo 20 si no viene totalIva', () => {
        expect(totalesDelDte(doc)).toMatchObject({ gravado: 3, exento: 4.1, iva: 0.39, total: 7.49 });
    });
    it('un JSON raro no lanza', () => {
        expect(renglonesDelDte(null)).toEqual([]);
        expect(totalesDelDte({}).total).toBeNull();
    });
});
