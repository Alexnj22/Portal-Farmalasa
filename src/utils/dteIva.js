// ── El IVA de un DTE sale de `tributos`, no de `totalIva` ───────────────────
//
// `resumen.totalIva` **no existe en el esquema del Ministerio de Hacienda**. Lo
// descubrió el sync el 2026-07-23 y está documentado en
// `supabase/functions/sync-purchase-emails/index.ts` (`extractTotalIva`): leerlo
// de ahí dejó **513 de 516 documentos de julio 2026 con el IVA en NULL**,
// incluidos 415 CCF que sí lo traían — y la tarjeta «Crédito Fiscal IVA» del
// portal mostraba $36.82 en vez del monto real.
//
// En un CCF el IVA vive dentro de `resumen.tributos[]` como
// `{codigo: "20", valor: N}` — el 20 es IVA en el catálogo de tributos. En una
// factura de consumidor final el impuesto va incluido en el precio y `tributos`
// suele venir vacío.
//
// Esta función es la MISMA regla que el sync, portada para el navegador, y vive
// acá y no dentro de un visor porque ya son dos los que la necesitan.
//
// **Sólo el código 20.** Sumar todos los tributos parece más general y no lo es:
// un documento de combustible trae además FOVIAL y COTRANS, que no son crédito
// fiscal. `FormSalesDteViewer` los suma todos (línea 79) — no cambia su número
// hoy porque las ventas de la farmacia no llevan esos tributos, pero si alguna
// vez los lleva, ahí está el bug esperando.
const CODIGO_IVA = '20';

export function ivaDelDte(json, fallback = null) {
    // Se prueba `totalIva` primero por si algún proveedor sí lo manda directo:
    // no cuesta nada y evita re-sumar algo ya calculado.
    const directo = json?.resumen?.totalIva;
    if (typeof directo === 'number' && directo > 0) return directo;

    const tributos = json?.resumen?.tributos;
    if (Array.isArray(tributos)) {
        const iva = tributos
            .filter(t => t?.codigo === CODIGO_IVA)
            .reduce((suma, t) => suma + (Number(t?.valor) || 0), 0);
        if (iva > 0) return iva;
    }

    // Último recurso: lo que ya extrajo el sync y guardó en la fila. Va al final
    // —y no primero— porque el documento manda sobre la copia.
    return fallback;
}
