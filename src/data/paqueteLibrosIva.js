// El paquete del mes de los libros de IVA: qué archivos entran y con qué
// nombre (una carpeta por libro y un CSV por sucursal). El ZIP lo arma cada
// pantalla con su librería —el portal con `client-zip`, la app con `fflate`—
// así los dos sacan el mismo paquete. Vivía dentro de `LibrosIvaView`.
//
// Lo que contabilidad hace sin esto es entrar ocho veces, cambiar la sucursal
// seis veces y bajar 44 archivos a mano. Un archivo mal nombrado o una sucursal
// salteada en esa rutina no se nota hasta que Hacienda cruza el mes.
//
// Trae los libros SIN filtro de sucursal —una llamada por libro, no una por
// libro y sucursal— y los reparte por `branch_id`. Son 8 consultas en vez de
// 44, el servidor ya aplica el scope del usuario, y el orden dentro de cada
// sucursal es el que devolvió el RPC, que es el orden legal.
//
// Renta y notas de crédito NO se reparten: sus documentos llegan por correo y no
// traen sucursal (ver `librosIva.js`). Van sueltos en la raíz del ZIP.
// Inventarles una carpeta de sucursal sería inventarles el dato.
//
// Devuelve `null` si no hay una sola fila en el período — quien llama decide qué
// decir. Lanza si algún libro falla: un paquete al que le falta un libro en
// silencio es peor que no tener paquete.
import { buildCsvText } from '../utils/csvExport';
import { construirLibro } from '../utils/libroIva';
import { calcularTotales } from '../utils/librosIva';
import {
    fetchAnexoRetencionRenta, fetchLibroConsumidor, fetchLibroContribuyente, fetchLibroAnulados,
    fetchLibroCompras, fetchLibroPercepcion, fetchLibroRetencion, fetchNotasCreditoCompras, fetchRetencionVentas,
} from './librosIva';

const POR_SUCURSAL = ['consumidor', 'contribuyente', 'compras', 'anulados',
                      'percepcion', 'retencion', 'retencionVentas'];
const SIN_SUCURSAL = ['renta', 'notas'];
const LIBROS_VACIOS = { consumidor: [], contribuyente: [], anulados: [], compras: [],
                        percepcion: [], retencion: [], notas: [], renta: [],
                        retencionVentas: [] };

/** Los archivos (`{ name, texto }`) a partir de los nueve libros ya leídos. */
export function archivosDeLibrosIva(todo, { mes, nombreSucursal }) {
    // Las sucursales que APARECEN en el período, no una lista a mano: el día que
    // abra una sucursal entra sola, y una que no vendió ni compró no genera seis
    // archivos vacíos.
    const ids = [...new Set(POR_SUCURSAL.flatMap(k => (todo[k] || []).map(r => r.branch_id)))]
        .filter(id => id != null)
        .sort((a, b) => a - b);

    const entradas = [];
    const agregar = (tab, filasDelLibro, nombre) => {
        if (filasDelLibro.length === 0) return;   // sin filas no hay archivo
        const d = { ...LIBROS_VACIOS, [tab]: filasDelLibro };
        const libro = construirLibro(tab, d, calcularTotales(d)[tab]);
        entradas.push({ name: nombre(libro), texto: buildCsvText(libro.headers, libro.rows) });
    };

    for (const tab of POR_SUCURSAL)
        for (const id of ids)
            agregar(tab, (todo[tab] || []).filter(r => r.branch_id === id),
                l => `${l.base}/${nombreSucursal(id).replace(/\s+/g, '-')}.csv`);

    for (const tab of SIN_SUCURSAL)
        agregar(tab, todo[tab] || [], l => `${l.base}_${mes}.csv`);

    return entradas;
}

/** Lee los nueve libros del mes y devuelve el paquete sin comprimir, o null si no hay filas. */
export async function paqueteDeLibrosIva({ desde, hasta, mes, nombreSucursal }) {
    const [cons, contrib, anul, comp, perc, ret, nts, rent, rv] = await Promise.all([
        fetchLibroConsumidor(desde, hasta, null),
        fetchLibroContribuyente(desde, hasta, null),
        fetchLibroAnulados(desde, hasta, null),
        fetchLibroCompras(desde, hasta, null),
        fetchLibroPercepcion(desde, hasta, null),
        fetchLibroRetencion(desde, hasta, null),
        fetchNotasCreditoCompras(desde, hasta),
        fetchAnexoRetencionRenta(desde, hasta),
        fetchRetencionVentas(desde, hasta, null),
    ]);
    for (const r of [cons, contrib, anul, comp, perc, ret, nts, rent, rv])
        if (r.error) throw r.error;

    const todo = {
        consumidor: cons.data || [], contribuyente: contrib.data || [],
        anulados: anul.data || [], compras: comp.data || [],
        percepcion: perc.data || [], retencion: ret.data || [],
        notas: nts.data || [], renta: rent.data || [],
        retencionVentas: rv.data || [],
    };
    const entradas = archivosDeLibrosIva(todo, { mes, nombreSucursal });
    if (entradas.length === 0) return null;
    return { entradas, nombre: `libros-iva_${mes}.zip`, archivos: entradas.length };
}
