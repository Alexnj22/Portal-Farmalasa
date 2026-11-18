// El papel de una venta cobrada desde el kiosco de caja (2026-11-18).
//
// La caja de hoy imprime su ticket por la impresora de la sala con su propio
// formato; el kiosco imprime éste por `imprimirDocumento`. Dice lo que el
// cliente discute en el mostrador: qué se llevó, cuánto pagó, cuánto entregó y
// el vuelto. Si Hacienda ya selló el documento, va su código de generación
// para que el cliente lo consulte; si no, el documento sale con el envío de la
// noche y el papel no promete un código que todavía no existe.
//
// Lo que se rompe solo (§5 de docs/IMPRESION-EN-TICKETERA-2026-08-13.md): sólo
// ASCII —por eso los rótulos van SIN TILDE—, 54 columnas y sin tema.

import { EMPRESA } from '../constants/empresa';
import { formatMoney } from './formatNumber';
import { juntarSiEntra, recortar, selloCorto, soloAscii } from './ticketCampos';

const DOCUMENTO = { COF: 'FACTURA CONSUMIDOR FINAL', CCF: 'CREDITO FISCAL', TIK: 'TICKET' };
const plano = (n) => formatMoney(n).replace('$', '');

/**
 * @param {{ cobro: { referencia?: any, numero?: string|null, documento?: string|null, total: number, efectivo: number, vuelto: number,
 *   cliente?: string|null, mh?: { sello?: string, codigo_generacion?: string }|null },
 *   renglones: { nombre?: string, cantidad?: number, precio?: number, subtotal?: number }[], sala?: string|null, cobro_por?: string|null, hechoAt: string }} d
 */
export function ticketDeCobroKiosco({ cobro, renglones = [], sala = null, cobro_por = null, hechoAt }) {
    const datos = [
        ['Fecha', selloCorto(hechoAt)],
        ['Sucursal', recortar(soloAscii(sala || '-'), 20)],
        ['Preventa', `#${soloAscii(cobro.referencia ?? '-')}`],
    ];
    if (cobro.numero) datos.push(['Documento', soloAscii(cobro.numero)]);
    datos.push(['Cliente', recortar(soloAscii(cobro.cliente || 'Consumidor final'), 30)]);

    const sello = cobro.mh?.sello && String(cobro.mh.sello).length === 40;
    return {
        titulo: DOCUMENTO[cobro.documento] ?? 'COMPROBANTE DE VENTA',
        tituloDeCola: `Venta #${cobro.referencia ?? ''}`,
        encabezado: { titulo: soloAscii(EMPRESA.razonSocial) },
        datos,
        items: {
            cantidadPrimero: true,
            columnas: [
                { label: 'CANT', ancho: '11%' },
                { label: 'DESCRIPCION', ancho: '53%' },
                { label: 'P.UNIT', ancho: '17%', alinear: 'der' },
                { label: 'TOTAL', ancho: '19%', alinear: 'der' },
            ],
            filas: renglones.map((r) => [String(Number(r.cantidad) || 0), soloAscii(r.nombre || 'Producto'), plano(r.precio ?? 0), plano(r.subtotal ?? 0)]),
        },
        totales: [
            ['TOTAL', formatMoney(cobro.total), true],
            ['Efectivo recibido', formatMoney(cobro.efectivo)],
            ['CAMBIO', formatMoney(cobro.vuelto)],
        ],
        pie: [
            ...(sello && cobro.mh.codigo_generacion ? ['CODIGO DE GENERACION', soloAscii(String(cobro.mh.codigo_generacion).toUpperCase())] : []),
            juntarSiEntra(`Te atendio: ${recortar(soloAscii(cobro_por || 'sin identificar'), 28)}`, 'Gracias por tu compra'),
        ],
    };
}
