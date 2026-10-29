import { describe, it, expect } from 'vitest';
import { lineaDelSobre, totalesDelSobre, tipoDocDe, costoNeto, factorEnLaDescripcion } from '../../supabase/functions/_shared/compraSobre.ts';

/* Presentaciones reales de Bodega, leídas el 2026-10-29 con `consultar_stock`
 * + `getpresentacion` (sólo lectura). */
const BOLSA_AGUA = {
    id: 3827, nombre: 'BOLSA DE AGUA X 500 ML', perecedero: true, regulado: false,
    presentaciones: [
        { id: '4700', unidad: 25, costo: 0.9219, precio: 1.25 },
        { id: '7988', unidad: 24, costo: 0.885, precio: 1.25 },
        { id: '5273', unidad: 2, costo: 0.0738, precio: 0.25 },
        { id: '8437', unidad: 1, costo: 0.0369, precio: 0.15 },
    ],
};
const CONO = {
    id: 3980, nombre: 'CONO CAPUCHINO SORBETE', perecedero: true, regulado: false,
    presentaciones: [{ id: '9001', unidad: 1, costo: 0.665, precio: 1 }],
};

describe('lineaDelSobre', () => {
    it('usa la presentación del mismo tamaño que la unidad del proveedor', () => {
        const { linea, problemas } = lineaDelSobre(0,
            { descripcion: 'FARDO AGUA', cantidad: 10, precio: 0.9, descuento: 0, exento: false },
            { tipo: 'producto', producto: BOLSA_AGUA, factor: 25, lote: null, vence: '2026-12-15' });
        expect(problemas).toEqual([]);
        expect(linea).toMatchObject({ id_presentacion: '4700', unidad: '25', cant: '10', compra: '0.9000', vence: '2026-12-01' });
    });

    it('sin presentación de ese tamaño, carga en la de 1 multiplicando — no 10 veces corta', () => {
        const { linea, detalle } = lineaDelSobre(0,
            { descripcion: 'CONO CAPUCHINO CJA 10 U', cantidad: 2, precio: 6.65, descuento: 0, exento: false },
            { tipo: 'producto', producto: CONO, factor: 10, lote: null, vence: '2027-01' });
        expect(linea).toMatchObject({ id_presentacion: '9001', unidad: '1', cant: '20', compra: '0.6650' });
        expect(detalle.existencias).toBe(20);
    });

    it('perecedero sin vencimiento entra vacío y queda pendiente para la sala', () => {
        const { linea, problemas, detalle } = lineaDelSobre(3,
            { descripcion: 'X', cantidad: 1, precio: 1, descuento: 0, exento: false },
            { tipo: 'producto', producto: CONO, factor: 1, lote: null, vence: null });
        expect(problemas).toEqual([]);
        expect(linea.vence).toBe('');
        expect(detalle.vence_pendiente).toBe(true);
    });

    it('regulado sin vencimiento SÍ frena', () => {
        const { problemas } = lineaDelSobre(3,
            { descripcion: 'X', cantidad: 1, precio: 1, descuento: 0, exento: false },
            { tipo: 'producto', producto: { ...CONO, regulado: true }, factor: 1, lote: 'L1', vence: null });
        expect(problemas).toHaveLength(1);
        expect(problemas[0].renglon).toBe(3);
    });

    it('el descuento del renglón baja el costo unitario', () => {
        expect(costoNeto({ cantidad: 4, precio: 10, descuento: 2 })).toBe(9.5);
    });

    it('consumo va como servicio y no toca existencias', () => {
        const { linea } = lineaDelSobre(0,
            { descripcion: 'AGUA PARA EL PERSONAL', cantidad: 3, precio: 2, descuento: 0, exento: false },
            { tipo: 'consumo' });
        expect(linea).toMatchObject({ id_producto: 'SERV', bandera: 'SERVICIO', unidad: '1', vence: 'NULL', descripcion_ser: 'AGUA PARA EL PERSONAL' });
    });
});

describe('totalesDelSobre', () => {
    const l = (compra, cant, exento = 0) => ({ compra_fin: compra, cant, exento });
    it('CCF: IVA 13 % y percepción sólo desde $100', () => {
        expect(totalesDelSobre([l('10', '5')], 'CCF', 0.01)).toMatchObject({ iva: '6.5000', total_percepcion: '0.00', total: '56.50' });
        expect(totalesDelSobre([l('10', '10')], 'CCF', 0.01)).toMatchObject({ iva: '13.0000', total_percepcion: '1.00', total: '114.00' });
    });
    it('factura: sin IVA aparte', () => {
        expect(totalesDelSobre([l('1.13', '10')], 'COF', 0)).toMatchObject({ iva: '0.0000', total: '11.30' });
    });
});

it('tipoDocDe', () => {
    expect([tipoDocDe('03'), tipoDocDe('01'), tipoDocDe('14'), tipoDocDe('05')]).toEqual(['CCF', 'COF', 'FSE', null]);
});

describe('factorEnLaDescripcion', () => {
    it.each([
        ['Barrita Fresa Sarita|7401090800083|25.000 |Caja', 25],
        ['Choco Cono Sarita|7401090803022|30.000 |Caja', 30],
        ['PALETA FROZEN MIXTA CJA 25 UND', 25],
        ['SANDWICH QUESO FRESA CJA 18 U', 18],
        ['COPA MIA QUESO FRESA', null],
        ['ELECTROLIT MARACUYA 625 ML', null],
        ['BOLSA DE AGUA X 500 ML', null],
    ])('%s → %s', (t, n) => expect(factorEnLaDescripcion(t)).toBe(n));
});
