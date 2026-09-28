// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { partirPorLote, colaDeLote } from '../../supabase/functions/_shared/dte/lotes.ts';
import { armarFactura, totalAPagar } from '../../supabase/functions/_shared/dte/documentos.ts';
import { separarLote, definicionPdf, ticketDeVenta } from '@nucleo/utils/distribucionDocumento.js';

// «Si se vende de dos lotes se separa»: un renglón del pedido se vuelve un
// renglón del documento por lote. Lo que tiene que cumplirse SIEMPRE es que
// partir no cambie el total — los pagos se registran antes de facturar y se
// validan contra él al centavo.

const item = { codigo: '63', cantidad: '3.0000', precio: '4.867257', precioIncluyeIva: false, descuento: '1.000000', descripcion: 'ENSURE ADVANCE LIQ FRESA X 220ML' };
// Como lo arma `facturar`, pero sin fijar si el precio lleva IVA: el partidor no lo sabe.
const renglonesPorLote = (r, asignadas) => partirPorLote(r, 7, asignadas);
const dosLotes = [
    { item_id: 7, lote: 'B2611', vence: '2026-12-31', cantidad: '1.0000' },
    { item_id: 7, lote: 'A2703', vence: '2027-03-31', cantidad: '2.0000' },
];

describe('renglones por lote', () => {
    it('parte el renglón en uno por lote, con la cola en la descripción', () => {
        const r = renglonesPorLote(item, dosLotes);
        expect(r).toHaveLength(2);
        expect(r[0].descripcion).toBe('ENSURE ADVANCE LIQ FRESA X 220ML LOTE: B2611 VENCE: 31/12/2026');
        expect(r.map(x => x.cantidad)).toEqual(['1.0000', '2.0000']);
    });
    it('el descuento se reparte y suma exacto', () => {
        const r = renglonesPorLote(item, dosLotes);
        const suma = r.reduce((t, x) => t + Math.round(Number(x.descuento) * 1e6), 0);
        expect(suma).toBe(1e6);
    });
    it('partir no cambia el total: Crédito Fiscal y Factura, precio con y sin IVA', () => {
        for (const tipo of ['03', '01']) {
            for (const r of [item, { ...item, precio: '5.50', precioIncluyeIva: true, descuento: '1.13' }]) {
                expect(totalAPagar(tipo, renglonesPorLote(r, dosLotes))).toBe(totalAPagar(tipo, renglonesPorLote(r, [])));
            }
        }
    });
    it('un tercio de presentación: la cantidad del último lote cierra exacto', () => {
        const r = renglonesPorLote({ ...item, cantidad: '1.0000', descuento: '0' }, [
            { item_id: 7, lote: 'X', vence: null, cantidad: '0.3333' },
            { item_id: 7, lote: 'Y', vence: null, cantidad: '0.6667' },
        ]);
        expect(r.reduce((t, x) => t + Math.round(Number(x.cantidad) * 1e4), 0)).toBe(1e4);
        expect(r[0].descripcion.endsWith(' LOTE: X')).toBe(true);
    });
    it('sin asignación, el renglón queda como estaba', () => {
        expect(renglonesPorLote(item, [])[0].descripcion).toBe(item.descripcion);
    });
});

describe('el papel lee lo que escribe el motor', () => {
    it('separarLote devuelve la descripción, el lote y el vencimiento', () => {
        const d = `SUERO ORAL 500 ML${colaDeLote('25110130', '2028-12-03')}`;
        expect(separarLote(d)).toEqual({ descripcion: 'SUERO ORAL 500 ML', lote: '25110130', vence: '03/12/2028' });
        expect(separarLote(`SUERO${colaDeLote('L 12', null)}`)).toEqual({ descripcion: 'SUERO', lote: 'L 12', vence: null });
        expect(separarLote('SIN LOTE')).toEqual({ descripcion: 'SIN LOTE', lote: null, vence: null });
    });
    it('el PDF muestra las columnas Lote y Vence sólo si hay lotes, y el ticket pega el lote', () => {
        const DIR = { departamento: '04', municipio: '36', distrito: '07', complemento: 'Centro' };
        const EMISOR = { nit: '04070101261015', nrc: '3456789', nombre: 'X, S.A.S.', codActividad: '46491', descActividad: 'Venta', nombreComercial: 'X', direccion: DIR, telefono: '23010013', correo: 'a@b.com', establecimiento: 'B001', puntoVenta: 'P001' };
        const renglones = renglonesPorLote(item, dosLotes);
        const doc = armarFactura({ ambiente: '00', emisor: EMISOR, correlativo: 1, ahora: new Date('2026-09-28T16:00:00Z'), condicion: 1, renglones,
            receptor: { tipoDocumento: '13', numDocumento: '01234567-8', nrc: null, nombre: 'T', codActividad: null, descActividad: null, direccion: DIR, telefono: '77778888', correo: null },
            pagos: [{ codigo: '01', monto: totalAPagar('01', renglones) }] });
        const fila = { id: 1, tipo: doc.tipo, ambiente: '00', numero_control: doc.numeroControl, codigo_generacion: doc.codigoGeneracion, json: doc.json, sello_recibido: null };
        const texto = JSON.stringify(definicionPdf(fila, null));
        expect(texto).toContain('"Lote"');
        expect(texto).toContain('31/12/2026');
        expect(ticketDeVenta(fila).items.filas[0][1]).toBe('ENSURE ADVANCE LIQ FRESA X 220ML L:B2611 V:31/12/2026');
    });
});
