import { describe, it, expect } from 'vitest';
import SPEC from '../../supabase/functions/_shared/anexo-spec.json';
import { construirLibro } from '../../src/views/contabilidad/LibrosIvaView.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// El candado que faltaba: contar las columnas.
//
// El 2026-08-11 se descubrió, con un día de diferencia, que **dos** de los
// anexos que se presentan a Hacienda salían con una columna de menos. Y en los
// dos casos la que sobraba estaba EN EL MEDIO, así que no era «faltan columnas
// al final»: corría toda la fila y los montos caían en casillas equivocadas.
//
//   · Consumidor final: con $1,164.98 de ventas de un día, la casilla de
//     ventas gravadas quedaba en CERO y el monto se declaraba como
//     **exportación dentro del área centroamericana**.
//   · Contribuyentes: las gravadas caían en el débito fiscal, el débito en
//     "venta a cuenta de terceros", y **el total terminaba dentro de la
//     casilla del DUI del cliente**.
//
// Los dos pasaron meses así. Ni el verificador contra el archivo del origen
// —que compara contra un archivo con la MISMA forma vieja— ni ninguna otra
// prueba miraban el número de columnas. Nadie las contaba.
//
// Este test las cuenta, sobre la función real que arma el archivo, y falla el
// commit. Es deliberadamente tonto: no valida montos ni reglas fiscales, sólo
// la forma. La forma es lo que se rompió.
//
// La fuente de verdad es `supabase/functions/_shared/anexo-spec.json`, que es
// la misma que usan los dos verificadores.
// ─────────────────────────────────────────────────────────────────────────────

// Una fila de datos por reporte, con los campos que `construirLibro` consulta.
// Los valores no importan —esto mide la forma— pero se ponen realistas para que
// una falla se lea de un vistazo.
const FILA = {
    consumidor: {
        fecha: '2026-06-01', numero_control_del: 'DTE-01-S001P005-000000000019619',
        sello_del: '2026AA43242435C245638DB8C75FE0E931207KW8',
        erp_id_del: '297361', erp_id_al: '298111',
        codigo_gen_del: 'a8aee366-35e0-44b1-be80-ce99bbc8daaf',
        codigo_gen_al: 'e0ca8b8c-90b8-4340-ae83-f3b2957e724e',
        ventas_exentas: 0, ventas_gravadas: 1164.98, total_diario: 1164.98,
    },
    contribuyente: {
        fecha: '2026-06-01', numero_control: 'DTE-03-S001P005-000000000000018',
        sello_recepcion: '2026E04860E4392D4765A249FFD16527CF845ZVU',
        codigo_generacion: '6a197736-1c13-4042-bd59-4f683b45f098',
        erp_invoice_id: '297463', nrc: '250887-5', nit: '0614-010203-101-2',
        dui: '01777948-2', cliente: 'WALTER AMILCAR MANCIA ( 5 )',
        ventas_exentas: 0, ventas_gravadas: 7.69, debito_fiscal: 1.00,
        retencion_iva: 0, total: 8.69,
    },
    anulados: {
        fecha: '2026-06-25', numero_control: 'DTE-01-S005P002-000000000023648',
        sello_recepcion: '2026B232D1E76ECB4DB5815CC96137FEB5B6NKRZ',
        codigo_generacion: 'e27c75d7-d280-468e-9f08-20b201c3f88e',
        tipo_documento: 'COF', cliente: '', total: 6.45,
    },
    compras: {
        fecha: '2026-06-02', documento_numero: 'C7980C1F-7494-4A20-B',
        documento_tipo: 'CCF', nit: '0614-010203-101-2', nrc: '1234567',
        proveedor: 'LETERAGO S.A. DE C.V.', subtotal: 571.99, iva: 74.36,
        percepcion_iva: 5.72, total: 651.42, sello_recibido: null,
    },
    percepcion: {
        fecha: '2026-06-02', proveedor: 'LETERAGO S.A. DE C.V.',
        nit: '0614-010203-101-2', documento_tipo: 'CCF',
        documento_numero: 'C7980C1F-7494-4A20-B',
        subtotal: 577.71, percepcion_iva: 5.72, sello_recibido: null,
    },
};

// `construirLibro(tab, d, tot)` lee `d[tab]`; los totales no intervienen en la
// forma de las filas.
const armar = (tab) => construirLibro(tab, { [tab]: [FILA[tab]] }, {});

describe('la forma de los anexos que se presentan a Hacienda', () => {
    for (const [tab, espec] of Object.entries(SPEC.reportes)) {
        describe(tab, () => {
            it(`emite exactamente ${espec.columnas_hoy} columnas`, () => {
                const { rows } = armar(tab);
                expect(rows.length).toBeGreaterThan(0);
                for (const fila of rows) expect(fila).toHaveLength(espec.columnas_hoy);
            });

            it('las etiquetas de la spec cubren lo que pide Hacienda', () => {
                expect(espec.etiquetas).toHaveLength(espec.columnas);
            });

            // Si el número no coincide con lo que pide Hacienda, la deuda tiene
            // que estar escrita. Un número que no cuadra sin explicación es
            // justamente lo que dejó pasar estos dos errores.
            //
            // Al revés NO vale: que la cantidad coincida no significa que el
            // archivo esté bien. `percepcion` tiene 9 de los dos lados y **no
            // son las mismas nueve** — su deuda es de contenido. Esta prueba se
            // escribió al revés en el primer intento y la falla lo destapó.
            it('si la cantidad difiere de lo que pide Hacienda, la deuda está escrita', () => {
                if (espec.columnas_hoy !== espec.columnas) {
                    expect(espec.deuda, `${tab}: emite ${espec.columnas_hoy} y Hacienda pide ${espec.columnas}`)
                        .toBeTruthy();
                }
            });

            it('el mapa contra el archivo del origen cubre todas nuestras columnas', () => {
                expect(espec.origen.mapa).toHaveLength(espec.columnas_hoy);
                const destinos = espec.origen.mapa.filter(x => x !== null);
                expect(new Set(destinos).size, 'dos columnas nuestras no pueden apuntar a la misma del origen')
                    .toBe(destinos.length);
                for (const d of destinos) expect(d).toBeLessThan(espec.origen.columnas);
                expect(espec.origen.motivo).toBeTruthy();
            });
        });
    }

    // Los tres que ya están al día no pueden retroceder sin que alguien lo vea:
    // ni en la cantidad, ni apareciendo una deuda nueva.
    it('consumidor, contribuyentes y anulados cumplen lo que pide Hacienda', () => {
        for (const tab of ['consumidor', 'contribuyente', 'anulados']) {
            const e = SPEC.reportes[tab];
            expect(e.columnas_hoy, `${tab} dejó de cumplir`).toBe(e.columnas);
            expect(e.deuda, `${tab} tiene deuda nueva escrita`).toBeUndefined();
        }
    });

    // Las dos columnas de Renta de enero 2025 van al final y son constantes
    // para una farmacia. Que estén ahí es la mitad del arreglo del 2026-08-11.
    it('los dos anexos de ventas cierran con tipo de operación, tipo de ingreso y número de anexo', () => {
        const cons = armar('consumidor').rows[0];
        expect(cons.slice(-3)).toEqual(['1', '3', '2']);
        const contrib = armar('contribuyente').rows[0];
        expect(contrib.slice(-3)).toEqual(['1', '3', '1']);
    });

    // El defecto exacto que se corrigió: el monto de la venta tiene que caer en
    // "ventas gravadas locales" y no una casilla más allá, que es
    // "exportaciones dentro del área centroamericana".
    it('las ventas gravadas del día caen en su casilla, no en exportaciones', () => {
        const fila = armar('consumidor').rows[0];
        const i = SPEC.reportes.consumidor.etiquetas.indexOf('VENTAS GRAVADAS LOCALES');
        const exp = SPEC.reportes.consumidor.etiquetas.indexOf('EXPORTACIONES DENTRO DEL AREA CENTROAMERICANA');
        expect(fila[i]).toBe('1164.98');
        expect(Number(fila[exp])).toBe(0);
    });

    // Y el remate del de contribuyentes: un monto dentro de la casilla del DUI.
    it('la casilla del DUI no lleva un monto', () => {
        const fila = armar('contribuyente').rows[0];
        const i = SPEC.reportes.contribuyente.etiquetas.indexOf('DUI DEL CLIENTE');
        expect(fila[i]).not.toMatch(/^\d+\.\d{2}$/);
        const g = SPEC.reportes.contribuyente.etiquetas.indexOf('VENTAS GRAVADAS LOCALES');
        expect(fila[g]).toBe('7.69');
    });
});
