import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lineaDelSobre, totalesDelSobre, tipoDocDe, costoNeto, factorEnLaDescripcion, leerModelo, preciosDelNuevo, sobreDeProductoNuevo } from '../../supabase/functions/_shared/compraSobre.ts';

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

describe('producto nuevo copiando un modelo', () => {
    /* Pantalla de edición real de CHOCO CONO SARITA (5106), recortada a los
     * controles que se leen. Leída con un GET el 2026-10-29. */
    const html = readFileSync(path.join(process.cwd(), 'tests/fixtures/erp/editar-producto-5106.html'), 'utf8');
    const m = leerModelo(5106, html);

    it('lee categoría, laboratorio, proveedor, casillas y los 7 precios', () => {
        expect(m).toMatchObject({
            categoria: '4', laboratorio: '366', proveedor: '135',
            perecedero: true, exento: false, regulado: false, antibiotico: false,
            precios: [1, 1, 1, 0, 0, 0, 0.01],
        });
    });

    it('los precios guardan la proporción del modelo; ceros y simbólicos quedan', () => {
        expect(preciosDelNuevo([2.5, 2.3, 2.15, 2, 2, 1.8899, 0.01], 5)).toEqual([5, 4.6, 4.3, 4, 4, 3.78, 0.01]);
        expect(preciosDelNuevo(m.precios, 1.25)).toEqual([1.25, 1.25, 1.25, 0, 0, 0, 0.01]);
    });

    it('arma el formulario de alta como el sistema', () => {
        const s = sobreDeProductoNuevo(m, { nombre: 'CONO NUEVO SARITA', barcode: '7401090899999', costo: 0.6, precio: 1 });
        expect(s).toMatchObject({
            process: 'insert', id_producto: '0', descripcion: 'CONO NUEVO SARITA', id_categoria: '4',
            id_laboratorio: '366', proveedor: '135', perecedero: '1', exento: 'undefined', regulado: '0',
            lista: '1,1X1,1,0,0,0.6000,7401090899999,1.0000#1.0000#1.0000#0.0000#0.0000#0.0000#0.0100#;',
        });
    });
});
