// El paquete del mes de la distribuidora para el contador: TODO lo fiscal del
// mes, en los mismos formatos que los libros de las farmacias. Acá se decide
// QUÉ entra y con qué nombre; el ZIP lo arma cada pantalla con su librería
// (el portal con `client-zip`, la app con `fflate`), así los dos sacan el
// mismo paquete. Vivía en `views/distribucion/paquete.js`.
//
// Si un libro falla, el paquete NO sale: uno al que le falta un libro en
// silencio es peor que no tener paquete (misma decisión que el de las farmacias).
import { construirLibro, csvRetencionVentas, CSV_RET_VENTAS_HEADERS } from '../utils/libroIva';
import { buildCsvText } from '../utils/csvExport';
import { rangoDelMes } from '../utils/fecha';
import { fetchLibrosVentas, fetchLibroCompras, fetchRelacionadas } from './distribucionCompras';
import {
    comprasParaLibro, totalesContribuyente, totalesConsumidor, retencionesDeClientes, percepcionesAClientes,
    CSV_PERCEPCION_CLIENTES_HEADERS, csvPercepcionClientes, anexoDeCompras, resumenFiscal,
} from '../utils/distribucionReportes';

const d2 = (n) => (Number(n) || 0).toFixed(2);

/** Los archivos del paquete (`{ name, texto }`), ya armados como CSV, desde lo que devuelve la base. */
export function archivosDelPaquete({ ventas, compras, relacionadas }) {
    const entradas = [];
    const agregar = (nombre, headers, rows) => {
        if (!rows?.length) return;
        entradas.push({ name: `${nombre}.csv`, texto: buildCsvText(headers, rows) });
    };
    const libro = (tab, filas) => {
        const l = construirLibro(tab, { [tab]: filas });
        agregar(l.base, l.headers, l.rows);
    };
    libro('contribuyente', ventas?.contribuyente ?? []);
    libro('consumidor', ventas?.consumidor ?? []);
    libro('anulados', ventas?.anulados ?? []);
    libro('compras', comprasParaLibro(compras));
    libro('percepcion', anexoDeCompras(compras, 'percepcion'));
    libro('retencion', anexoDeCompras(compras, 'retencion'));
    const ret = retencionesDeClientes(ventas?.contribuyente);
    agregar('iva-retenido-sobre-ventas', CSV_RET_VENTAS_HEADERS, ret.length ? csvRetencionVentas(ret) : []);
    const perc = percepcionesAClientes(ventas?.contribuyente);
    agregar('iva-percibido-a-clientes', CSV_PERCEPCION_CLIENTES_HEADERS, perc.length ? csvPercepcionClientes(perc) : []);
    const prods = relacionadas?.productos ?? [];
    agregar('compras-a-relacionadas', ['PRODUCTO', 'UNIDADES', 'PAGADO', 'PAGADO C/U SIN IVA'],
        prods.map(p => [p.nombre, p.unidades, d2(p.pagado), (Number(p.pagado_u) || 0).toFixed(4)]));

    const tc = totalesContribuyente(ventas?.contribuyente);
    const tf = totalesConsumidor(ventas?.consumidor);
    const r = resumenFiscal({ tc, tf, compras });
    agregar('resumen-del-mes', ['CONCEPTO', 'MONTO'], [
        ['Ventas gravadas a contribuyentes (neto de notas)', d2(tc.gravadas)],
        ['Débito fiscal contribuyentes', d2(tc.debito)],
        ['Ventas a consumidor final (con IVA)', d2(tf.total)],
        ['Débito fiscal consumidor final', d2(tf.debito)],
        ['Crédito fiscal de compras', d2(r.credito)],
        ['Impuesto (débito − crédito), REFERENCIAL', d2(r.impuesto)],
        ['IVA que nos retuvieron clientes (anticipo)', d2(r.retenidoNos)],
        ['IVA que nos percibieron proveedores (anticipo)', d2(r.percibidoNos)],
        ['IVA percibido a clientes (a enterar)', d2(r.percibidoAClientes)],
        ['Documentos sin sello de Hacienda (fuera de los libros)', `${ventas?.sin_sello?.documentos ?? 0} por ${d2(ventas?.sin_sello?.total)}`],
    ]);
    return entradas;
}

/** Lee el mes y devuelve el paquete sin comprimir, o null si el mes no tiene nada. */
export async function paqueteDelMes(mes) {
    const [desde, hasta] = rangoDelMes(mes);
    const [ventas, compras, relacionadas] = await Promise.all([
        fetchLibrosVentas({ desde, hasta }), fetchLibroCompras({ desde, hasta }), fetchRelacionadas({ desde, hasta }),
    ]);
    const entradas = archivosDelPaquete({ ventas, compras, relacionadas });
    if (!entradas.length) return null;
    return { entradas, nombre: `torogoz-paquete-${mes}.zip`, archivos: entradas.length, sinSello: Number(/** @type {any} */ (ventas)?.sin_sello?.documentos ?? 0) };
}
