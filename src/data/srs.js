import { supabase } from '../supabaseClient';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../plataforma/config';

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
