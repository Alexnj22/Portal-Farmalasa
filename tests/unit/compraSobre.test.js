import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lineaDelSobre, totalesDelSobre, tipoDocDe, costoNeto, factorEnLaDescripcion, leerModelo, preciosDelNuevo, sobreDeProductoNuevo, repartirRegalos, totalDelDocumento } from '../../supabase/functions/_shared/compraSobre.ts';

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

describe('producto de regalo', () => {
    /* Steiner, compra 6372 cargada a mano por Bodega: 1,200 Electrolit a
     * $1.7699 y 108 «PROMOCIONAL» a $0. Bodega los dejó TODOS a
     * $1.6237/$1.6238 (= 2,123.87 ÷ 1,308). */
    const linea = (id, cant, compra) => ({
        id_producto: id, compra: compra.toFixed(4), compra_fin: compra.toFixed(4), venta: '2.5000', cant: String(cant),
        unidad: '1', vence: '', id_presentacion: '1', exento: 0, bandera: 'PRODUCTO', descripcion_ser: '-', numero_lote: '',
    });
    const cants = [[2812, 108, 0], [2811, 240, 424.78], [2813, 60, 106.19], [2806, 180, 318.58],
        [2805, 360, 637.16], [2818, 180, 318.58], [2807, 120, 212.39], [2809, 60, 106.19]];
    const lineas = cants.map(([id, c, sub]) => linea(String(id), c, sub > 0 ? Math.round(sub / c * 1e4) / 1e4 : 0));
    const cobrado = cants.map(([, , sub]) => sub);

    it('reparte el costo entre todas las unidades y el total no se mueve', () => {
        expect(repartirRegalos(lineas, cobrado)).toBe(1);
        for (const l of lineas) expect(['1.6237', '1.6238']).toContain(l.compra);
        expect(lineas.every(l => l.compra === l.compra_fin)).toBe(true);
        const t = totalesDelSobre(lineas, 'CCF', 0.01);
        expect(Number(t.total)).toBeCloseTo(2421.21, 2);
    });

    it('sin regalo no toca nada', () => {
        const sin = [linea('1', 10, 2), linea('2', 5, 3)];
        expect(repartirRegalos(sin)).toBe(0);
        expect(sin.map(l => l.compra)).toEqual(['2.0000', '3.0000']);
    });
});

describe('totalDelDocumento', () => {
    it('suma la percepción cuando el documento la deja fuera de la operación (Imberton)', () => {
        expect(totalDelDocumento({ montoTotalOperacion: 753.39, ivaPerci1: 6.67, totalPagar: 760.06 })).toBe(760.06);
    });
    it('no la suma dos veces cuando ya viene adentro', () => {
        expect(totalDelDocumento({ montoTotalOperacion: 760.06, ivaPerci1: 6.67, totalPagar: 760.06 })).toBe(760.06);
    });
    it('sin `ivaPerci1` pero con la percepción en lo que se paga (GAMMA)', () => {
        expect(totalDelDocumento({ montoTotalOperacion: 342.45, totalPagar: 345.48 })).toBe(345.48);
    });
    it('devuelve la retención: la descuenta el que paga, no cambia la compra', () => {
        expect(totalDelDocumento({ montoTotalOperacion: 113, ivaRete1: 1, totalPagar: 112 })).toBe(113);
    });
    it('sin percepción, la operación', () => {
        expect(totalDelDocumento({ montoTotalOperacion: 66.54, ivaPerci1: 0, totalPagar: 66.54 })).toBe(66.54);
        expect(totalDelDocumento({ totalPagar: 10 })).toBe(10);
        expect(totalDelDocumento(null)).toBe(null);
    });
});

/* 2026-10-30: la carga mandó `destino: "3"` escrito a mano —la ubicación de
 * Salud 1— y la compra 6472 dejó 150 unidades donde ningún inventario las ve.
 * La ubicación sale de `erp_sucursal_map`; ningún número fijo puede volver. */
describe('cargar-compra-erp · ubicación de destino', () => {
    const fuente = readFileSync(path.resolve(__dirname, '../../supabase/functions/cargar-compra-erp/index.ts'), 'utf8');
    it('no escribe la ubicación a mano', () => {
        // `id_ubicacion_destino: "0"` del traslado es otra cosa: el formulario
        // manda cero y la ubicación se elige al recibir.
        expect(fuente).not.toMatch(/[^_\w]destino:\s*["'`]\d+["'`]/);
        expect(fuente).toMatch(/destino:\s*String\(estanteBodega/);
    });
    it('compara contra la ubicación viva antes de mandar y comprueba el estante después', () => {
        expect(fuente).toMatch(/String\(x\.sobre\.destino\) !== String\(estante\)/);
        expect(fuente).toMatch(/existenciasDeUbicacion\(x\.cookie, ERP_BODEGA, estante\)/);
    });
});
