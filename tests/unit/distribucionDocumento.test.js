// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { armarFactura, armarCreditoFiscal } from '../../supabase/functions/_shared/dte/documentos.ts';
import { ticketDeVenta, definicionPdf, leerDocumento, urlConsultaPublica, nombreDelPdf, jsonParaElCliente } from '@nucleo/utils/distribucionDocumento.js';
import { seccionesParaElPrograma, COLUMNAS_TICKET } from '@nucleo/utils/ticketPrint';

// El ticket y el PDF de un documento de Distribución.
//
// Lo que se prueba es la regla del archivo: los dos papeles salen del JSON del
// DTE y dicen lo mismo que él. Si el total del ticket no es el `totalPagar`
// del JSON, el papel que se le entrega al cliente contradice al documento que
// recibió Hacienda.

const DIR = { departamento: '04', municipio: '36', distrito: '07', complemento: 'Barrio El Centro' };
const EMISOR = {
    nit: '04070101261015', nrc: '3456789', nombre: 'DISTRIBUIDORA DE PRUEBA, S.A.S.',
    codActividad: '46491', descActividad: 'Venta al por mayor de productos medicinales', nombreComercial: 'DISTRIBUIDORA PRUEBA',
    direccion: DIR, telefono: '23010013', correo: 'facturas@ejemplo.com', establecimiento: 'B001', puntoVenta: 'P001',
};
const renglones = [
    { codigo: '1', descripcion: 'ACETAMINOFÉN 500 MG X 100', cantidad: 12, precio: '1.95', precioIncluyeIva: false },
    { codigo: '2', descripcion: 'SUERO ORAL 500 ML', cantidad: 24, precio: '0.62', precioIncluyeIva: false },
];
const AHORA = new Date('2026-09-26T16:30:00Z');
const comoFila = (doc, extra = {}) => ({
    id: 1, tipo: doc.tipo, ambiente: doc.json.identificacion.ambiente, numero_control: doc.numeroControl,
    codigo_generacion: doc.codigoGeneracion, fec_emi: doc.fecEmi, hor_emi: doc.horEmi,
    total_pagar: doc.totalPagar, json: doc.json, sello_recibido: null, ...extra,
});

const factura = comoFila(armarFactura({
    ambiente: '00', emisor: EMISOR, correlativo: 3, renglones, ahora: AHORA, condicion: 1,
    receptor: { tipoDocumento: '13', numDocumento: '01234567-8', nrc: null, nombre: 'TIENDA LA ESQUINA',
        codActividad: null, descActividad: null, direccion: DIR, telefono: '77778888', correo: null },
    pagos: [{ codigo: '01', monto: '43.26' }],
}));
const ccf = comoFila(armarCreditoFiscal({
    ambiente: '01', emisor: EMISOR, correlativo: 9, ahora: AHORA, condicion: 2, opciones: { retiene1: true },
    renglones: [{ codigo: '3', descripcion: 'CAJA SUERO X 24', cantidad: 10, precio: '14.88', precioIncluyeIva: false }],
    receptor: { tipoDocumento: '36', numDocumento: '06141203901011', nrc: '1122334', nombre: 'SUPER EL AHORRO, S.A. DE C.V.',
        codActividad: '47111', descActividad: 'Venta en supermercados', direccion: DIR, telefono: '23334444', correo: null },
    pagos: [{ codigo: '13', monto: '166.65', plazo: '01', periodo: 30 }],
}), { sello_recibido: '2026ABCDEF0123456789ABCDEF0123456789ABCD' });

describe('leer el documento', () => {
    it('toma la dirección con los nombres del catálogo de Hacienda', () => {
        const d = leerDocumento(factura);
        expect(d.emisor.direccion).toBe('Barrio El Centro, Chalatenango, Chalatenango Sur, Chalatenango');
        expect(d.receptor.documento).toBe('DUI 01234567-8');
        expect(d.prueba).toBe(true);
        expect(d.sellado).toBe(false);
    });
    it('el NIT y el NRC salen con su formato', () => {
        const d = leerDocumento(ccf);
        expect(d.emisor.nit).toBe('0407-010126-101-5');
        expect(d.receptor.nrc).toBe('112233-4');
        expect(d.condicion).toBe('Credito a 30 dias');
    });
});

describe('ticket de venta', () => {
    it('Factura: el total es el del JSON y el IVA se informa como incluido', () => {
        const t = ticketDeVenta(factura);
        const total = t.totales.find(([k]) => k === 'TOTAL');
        expect(total[1]).toBe(`$${factura.json.resumen.totalPagar.toFixed(2)}`);
        expect(t.totales.some(([k]) => k === 'IVA incluido')).toBe(true);
        expect(t.totales.some(([k]) => k === 'IVA 13%')).toBe(false);
        expect(t.titulo).toBe('FACTURA');
        expect(t.items.filas).toHaveLength(2);
    });
    it('cantidad primero y la descripción con el ancho: un producto, una línea', () => {
        const t = ticketDeVenta(factura);
        expect(t.items.columnas.map(c => c.label)).toEqual(['CANT', 'DESCRIPCION', 'P.UNIT', 'TOTAL']);
        expect(t.items.cantidadPrimero).toBe(true);
        const [cant, desc] = t.items.filas[0];
        expect(desc.length).toBeGreaterThan(3);
        expect(Number(cant)).toBeGreaterThan(0);
    });
    it('en la impresora: la cantidad delante, el nombre al lado y ningún renglón pasa de 54', () => {
        const secciones = seccionesParaElPrograma({ ancho: 80, ...ticketDeVenta(factura) });
        const texto = JSON.stringify(secciones);
        const [cant, desc] = ticketDeVenta(factura).items.filas[0];
        // El rollo va en ASCII: se compara sin tildes.
        const primeraPalabra = desc.split(' ')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        expect(texto).toMatch(new RegExp(`\\s${cant} ${primeraPalabra}`));
        // El cuerpo (datos, productos, totales): el que se rellena a mano.
        const renglones = String(secciones.cuerpo).split('\n')
            // eslint-disable-next-line no-control-regex
            .map(r => r.replace(/\x1b.|\x1d.|\x1b[!-~]./g, ''));
        expect(renglones.every(r => r.length <= COLUMNAS_TICKET.chica + 2)).toBe(true);
    });
    it('efectivo: lo entregado y el cambio', () => {
        const total = factura.json.resumen.totalPagar;
        const t = ticketDeVenta(factura, null, { pagos: [{ forma: '01', monto: total, efectivo_recibido: total + 4.5 }] });
        const mapa = Object.fromEntries(t.totales.map(([k, v]) => [k, v]));
        expect(mapa['Efectivo recibido']).toBe(`$${(total + 4.5).toFixed(2)}`);
        expect(mapa.CAMBIO).toBe('$4.50');
    });
    it('sin sello, el papel lo dice; en pruebas, también', () => {
        const t = ticketDeVenta(factura);
        expect(t.pie).toContain('PENDIENTE DEL SELLO DE HACIENDA');
        expect(t.bloques[0].titulo).toBe('PRUEBA - SIN VALIDEZ FISCAL');
    });
    it('CCF: sumas, IVA, retención y total; con sello y QR a la consulta pública', () => {
        const t = ticketDeVenta(ccf);
        const mapa = Object.fromEntries(t.totales.map(([k, v]) => [k, v]));
        expect(mapa.SUMAS).toBe('$148.80');
        expect(mapa['IVA 13%']).toBe('$19.34');
        expect(mapa['IVA RETENIDO']).toBe('-$1.49');
        expect(mapa.TOTAL).toBe('$166.65');
        expect(t.pie).toContain('SELLO DE RECEPCION');
        expect(t.pie).toContain(ccf.sello_recibido);
        // El ticket no lleva QR (ahorra papel, 2026-09-30): el código de
        // generación sí, y el QR sigue en el PDF.
        expect(t.qr).toBeUndefined();
        expect(t.pie).toContain(ccf.json.identificacion.codigoGeneracion);
        expect(urlConsultaPublica(ccf)).toContain(`codGen=${ccf.codigo_generacion}`);
        // Sin pruebas, el único bloque es el del cliente.
        expect(t.bloques.map(b => b.titulo)).toEqual(['Cliente']);
    });
});

describe('PDF (representación gráfica)', () => {
    it('lleva los tres números de identidad, el QR y la marca de pruebas cuando corresponde', () => {
        const def = definicionPdf(factura, '<svg></svg>');
        const texto = JSON.stringify(def);
        expect(texto).toContain(factura.numero_control);
        expect(texto).toContain(factura.codigo_generacion);
        expect(texto).toContain('PENDIENTE');
        expect(def.watermark.text).toBe('SIN VALIDEZ FISCAL');
        expect(texto).toContain('"svg":"<svg></svg>"');
    });
    it('en producción no lleva marca y sí el sello', () => {
        const def = definicionPdf(ccf, null);
        expect(def.watermark).toBeUndefined();
        expect(JSON.stringify(def)).toContain(ccf.sello_recibido);
        expect(JSON.stringify(def)).toContain('$166.65');
    });
    it('el nombre del archivo identifica tipo, número y código', () => {
        expect(nombreDelPdf(ccf)).toBe(`COMPROBANTE-DE-CREDITO-FISCAL-000009-${ccf.codigo_generacion}.pdf`);
    });
    it('el cierre va al pie de la hoja y tiene el guardián que abre otra si no cabe', () => {
        const def = definicionPdf(ccf, null);
        const cierre = def.content.find(n => n.absolutePosition);
        expect(cierre.absolutePosition.y).toBeGreaterThan(500);
        expect(def.content.some(n => n.id === 'guarda-del-cierre' && n.text === ' ')).toBe(true);
        expect(def.pageBreakBefore({ id: 'guarda-del-cierre', startPosition: { top: cierre.absolutePosition.y } })).toBe(true);
        expect(def.pageBreakBefore({ id: 'guarda-del-cierre', startPosition: { top: 300 } })).toBe(false);
    });
    it('lleva código y unidad de cada renglón, y los documentos relacionados si los hay', () => {
        const texto = JSON.stringify(definicionPdf(ccf, null));
        expect(texto).toContain('"Unidad"');
        expect(texto).toContain('Monto total de la operación');
    });
    it('una hoja invalidada lo dice en la marca de agua', () => {
        expect(definicionPdf({ ...ccf, invalidado_at: '2026-09-27T10:00:00Z' }, null).watermark.text).toBe('DOCUMENTO INVALIDADO');
    });
});

describe('JSON para el cliente', () => {
    it('lleva la firma y el sello cuando existen, y no los inventa cuando no', () => {
        const j = jsonParaElCliente({ ...ccf, firmado: 'eyJ.firma.jws' });
        expect(j.firmaElectronica).toBe('eyJ.firma.jws');
        expect(j.selloRecibido).toBe(ccf.sello_recibido);
        expect(j.identificacion).toEqual(ccf.json.identificacion);
        const sin = jsonParaElCliente(factura);
        expect('firmaElectronica' in sin).toBe(false);
        expect('selloRecibido' in sin).toBe(false);
    });
});

