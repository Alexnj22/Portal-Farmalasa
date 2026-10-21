import { supabase } from '../supabaseClient';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@plataforma/config';
import { busquedasSrsDe, decidirSrs, SRS_CONCURRENCIA, SRS_LOTE, SRS_PAUSA_MS, textoDePrincipios } from '../utils/enriquecerSrs';
import { fetchProductsWithoutPrincipioActivo, guardarPrincipiosActivos } from './productos';

// ── El registro sanitario (SRS), por el intermediario `srs-proxy` ────────────
//
// Estaba copiado TRES veces —el buscador de la ficha, el enriquecedor del
// catálogo y el panel de inventario—, cada copia leyendo la dirección y la
// llave directo de `import.meta.env`. Una sola, con la configuración del
// adaptador de la plataforma (F3 del núcleo portable).
//
// Es un `fetch` y no `functions.invoke` a propósito: el intermediario recibe la
// búsqueda en la dirección (GET con parámetros), y así lo llamaban las tres.

/** Busca en el SRS. Devuelve el JSON del intermediario (`{ data, total }`). */
export async function buscarEnSrs(q, { pagina = 1, porPagina = 10 } = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const url = `${SUPABASE_URL}/functions/v1/srs-proxy`
        + `?q=${encodeURIComponent(q)}&page=${pagina}&page-max=${porPagina}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) throw new Error(`SRS ${res.status}`);
    return res.json();
}

// ── «Enriquecer SRS» (2026-10-15) ────────────────────────────────────────────
// Lo que hacía el modal del portal, para que la app recorra lo mismo. La
// cuenta (búsquedas, parecido, principios) es de `utils/enriquecerSrs`.

/** Prueba las búsquedas de `busquedasSrsDe` hasta que una traiga resultados. */
export async function buscarEnSrsParaProducto(producto) {
    for (const q of busquedasSrsDe(producto)) {
        const json = await buscarEnSrs(q, { porPagina: 15 });
        if ((json.data || []).length > 0) return json;
    }
    return { data: [], total: 0 };
}

/**
 * Le pone a un producto los principios del SRS (borra, inserta, escribe el
 * texto y anota: `guardarPrincipiosActivos`). Lanza si no se pudo.
 */
export async function aplicarPrincipiosDeSrs(productId, principios, contexto = {}) {
    const rows = (principios || []).map((p) => ({ product_id: productId, ...p }));
    const res = await guardarPrincipiosActivos(productId, rows, textoDePrincipios(principios), { origen: 'srs', ...contexto });
    if (res?.error) throw res.error;
}

/**
 * Recorre los productos activos sin principio activo (de a `SRS_LOTE`), de a
 * `SRS_CONCURRENCIA` a la vez, y va contando: `alAvanzar({ hechos, total })`,
 * `alDecidir({ tipo, entrada, producto })` con `tipo` 'auto' | 'revisar' | 'sin'.
 * `cancelado()` corta la corrida. Devuelve `{ total, error }`.
 * @param {{ alAvanzar?: (p: { hechos: number, total: number }) => void,
 *          alDecidir?: (d: { tipo: string, entrada: any, producto: any }) => void,
 *          cancelado?: () => boolean }} [opciones]
 */
export async function escanearSinPrincipioEnSrs({ alAvanzar, alDecidir, cancelado = () => false } = {}) {
    const { data: productos, error } = await fetchProductsWithoutPrincipioActivo(SRS_LOTE);
    if (error || !productos?.length) return { total: 0, error: error ?? null };
    const cola = [...productos];
    let hechos = 0;
    alAvanzar?.({ hechos, total: productos.length });
    const trabajador = async () => {
        while (cola.length && !cancelado()) {
            const producto = cola.shift();
            await new Promise((r) => setTimeout(r, SRS_PAUSA_MS));
            try {
                const json = await buscarEnSrsParaProducto(producto);
                const { tipo, entrada } = decidirSrs(producto, json.data || []);
                alDecidir?.({ tipo, entrada, producto });
            } catch {
                alDecidir?.({ tipo: 'sin', entrada: null, producto });
            }
            hechos += 1;
            alAvanzar?.({ hechos, total: productos.length });
        }
    };
    await Promise.all(Array.from({ length: SRS_CONCURRENCIA }, trabajador));
    return { total: productos.length, error: null };
}
