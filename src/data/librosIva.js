// Libros de IVA — capa de datos.
//
// Los siete RPC son SECURITY DEFINER con el gate de permiso adentro (migraciones
// 20260731211927 para ventas, 20260801154204 para compras): las policies de
// `sales_invoices` y `purchase_receipts` piden `ventas.can_view` y
// `compras.can_view`, así que un contador con permiso de Libros IVA y nada más
// leería cero filas por el camino normal. El scope de sucursal lo aplica el
// servidor, no esta capa.
//
// Sin paginar a propósito, y no por descuido: todos devuelven volúmenes chicos
// por construcción. El de consumidor agrupa POR DÍA (≤31 filas por sucursal-mes),
// y los demás son documentos contados — junio 2026, las 7 sucursales: 49 CCF, 80
// anulados, 389 compras y 226 filas de percepción. El mes más cargado no llega a
// 400 filas contra el cap de 1000 de PostgREST. Si algún día se pidiera un año
// completo, esto necesita `fetchAllRows`.
import { supabase } from '../supabaseClient';
import { getSignedFileUrl } from '../utils/storageFiles';

import { registrarEgreso } from './egreso';
// `client-zip` solo hace falta al apretar un botón, así que va por
// `await import()` — regla de librerías pesadas de CLAUDE.md.
let zipPromise = null;
function getZipLib() {
    if (!zipPromise) {
        zipPromise = import('client-zip')
            .catch(err => { zipPromise = null; throw err; });  // reintentar, no quedar roto
    }
    return zipPromise;
}

// El ZIP de UN documento se arma en el navegador, igual que en Facturas de
// Compra: son dos archivos de ~186 kB, no amerita ida al servidor.
//
// Vive acá y no en la vista porque lo usan los dos lados: la tabla del libro y
// el modal del documento.
export async function descargarPaqueteDteVenta(row) {
    const { downloadZip } = await getZipLib();
    const base = String(row?.codigo_generacion || row?.erp_invoice_id || 'dte').toUpperCase();
    const entradas = [];
    for (const [ext, path] of [['json', row?.json_path], ['pdf', row?.pdf_path]]) {
        if (!path) continue;
        const url = await getSignedFileUrl(path);
        if (!url) continue;
        const res = await fetch(url);
        if (res.ok) entradas.push({ name: `${base}.${ext}`, input: await res.blob() });
    }
    if (entradas.length === 0) throw new Error('Este documento no tiene archivos guardados.');

    const blob = await downloadZip(entradas).blob();
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `${base}.zip` });
    a.click();
    URL.revokeObjectURL(url);
    registrarEgreso('dte_venta', { formato: 'zip', filas: entradas.length, detalle: { documento: base } });
}

const params = (desde, hasta, branchId) => ({
    p_desde: desde,
    p_hasta: hasta,
    p_branch_id: branchId ? Number(branchId) : null,
});

// Art. 83 RCT — una fila por día, con el rango de correlativos del→al.
export function fetchLibroConsumidor(desde, hasta, branchId) {
    return supabase.rpc('get_libro_ventas_consumidor', params(desde, hasta, branchId));
}

// Art. 85 RCT — una fila por documento. `nrc` viene NULL mientras el sync no
// capture el receptor del DTE; la vista lo muestra como faltante.
export function fetchLibroContribuyente(desde, hasta, branchId) {
    return supabase.rpc('get_libro_ventas_contribuyente', params(desde, hasta, branchId));
}

// Anexo de anulados. `NULA` no entra: nunca llegó a Hacienda.
export function fetchLibroAnulados(desde, hasta, branchId) {
    return supabase.rpc('get_libro_anulados', params(desde, hasta, branchId));
}

// Art. 86 RCT — libro de compras, una fila por documento. Las anuladas vienen
// marcadas, no filtradas: el libro del ERP las incluye (verificado en Bodega el
// 2026-07-20, 28 documentos y $16,321.43 de los dos lados).
export function fetchLibroCompras(desde, hasta, branchId) {
    return supabase.rpc('get_libro_compras', params(desde, hasta, branchId));
}

// Anexo de percepción (Art. 163 CT) — el subconjunto de compras con percepción.
export function fetchLibroPercepcion(desde, hasta, branchId) {
    return supabase.rpc('get_libro_percepcion', params(desde, hasta, branchId));
}

// Anexo de retención (Art. 162 CT) — el que la empresa presentaría COMO AGENTE
// de retención. Sale vacío y así debe ser: no lo es, y el origen tampoco tiene
// una sola fila entre 2025-01 y 2026-07 en las 7 sucursales.
export function fetchLibroRetencion(desde, hasta, branchId) {
    return supabase.rpc('get_libro_retencion', params(desde, hasta, branchId));
}

// La otra mitad, y la que sí tiene filas: el 1% que un cliente gran
// contribuyente nos retuvo sobre una venta. Son dos cosas OPUESTAS —una la
// practicamos, la otra nos la practican— y por eso van en secciones separadas
// de la misma pestaña. Confundirlas sería declarar un impuesto por otro, que es
// la misma trampa que ya está anotada para la retención de Renta del Art. 156.
//
// Trae `json_path`/`pdf_path` del DTE archivado cuando existe, para abrir el
// documento sin salir del libro.
export function fetchRetencionVentas(desde, hasta, branchId) {
    return supabase.rpc('get_retencion_ventas', params(desde, hasta, branchId));
}

// Reporte de sujeto excluido (Art. 119 CT). RETIRADO de la vista el 2026-08-02:
// cero documentos en toda la historia y el reporte no existe en el origen. Se
// conserva para volver a colgarlo si algún día aparece uno.
export function fetchLibroSujetoExcluido(desde, hasta, branchId) {
    return supabase.rpc('get_libro_sujeto_excluido', params(desde, hasta, branchId));
}

// Notas de crédito (05) y débito (06) de compras. NO es un libro: es la sección
// que hace visible lo que el libro no lleva.
//
// Sin `branchId` a propósito, y no por descuido: estos documentos llegan por
// correo y el origen no trae sucursal. Repartirlos por el documento que
// corrigen daría ~30% de cobertura, y un dato fiscal mal repartido es peor que
// uno sin repartir. La vista lo dice en pantalla.
export function fetchNotasCreditoCompras(desde, hasta) {
    return supabase.rpc('get_notas_credito_compras', { p_desde: desde, p_hasta: hasta });
}

// Anexo de retención de Renta (Art. 156 CT) — 10% sobre servicios prestados por
// personas naturales. NO es el libro de retención de IVA (Art. 162), que ya vive
// arriba en `fetchLibroRetencion`: son dos impuestos distintos y confundirlos
// sería declarar uno por el otro.
//
// Sin sucursal a propósito, como las notas de crédito: los documentos llegan por
// correo a una casilla de la empresa y no traen sucursal — inventarle una sería
// peor que no tenerla.
export function fetchAnexoRetencionRenta(desde, hasta) {
    return supabase.rpc('get_anexo_retencion_renta', { p_desde: desde, p_hasta: hasta });
}

// Los proveedores que PODRÍAN estar sujetos a la retención del Art. 156, para
// que el contador marque. El portal no puede decidirlo solo: distinguir un
// servicio de una compra de mercadería es una lectura del documento, no un dato.
export function fetchCandidatosRetencionRenta(desde, hasta) {
    return supabase.rpc('get_candidatos_retencion_renta', { p_desde: desde, p_hasta: hasta });
}

// C6 (H3): cuánto se cobró en el período y NO entra al libro por no tener sello.
// El filtro del sello es correcto; lo que faltaba era que el monto se viera donde
// se presenta el libro. Facturación ya las lista una por una — Pendiente MH las
// de sello vacío, Observaciones las de sello inválido — pero en ningún lado
// estaba el total del período.
export function fetchVentasFueraDelLibro(desde, hasta, branchId) {
    return supabase.rpc('get_ventas_fuera_del_libro', {
        p_desde: desde, p_hasta: hasta,
        p_branch_id: branchId ? Number(branchId) : null,
    });
}
