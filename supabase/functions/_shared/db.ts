// Shared DB helpers para Edge Functions.
//
// PostgREST corta cada respuesta en max_rows (1000 por defecto, ver config.toml).
// `.limit(10000)` NO evita ese cap — sólo lo baja. Para leer todas las filas hay
// que paginar con `.range()`. Estos helpers encapsulan ese patrón.

const PAGE_SIZE = 1000;

/**
 * SELECT … WHERE inColumn IN (values) trayendo TODAS las filas.
 * - Trocea `values` para no exceder el largo de URL de PostgREST.
 * - Pagina cada trozo con `.range()` para superar el cap de 1000 filas.
 *
 * `extra` permite encadenar filtros adicionales (p.ej. `.eq('branch', id)`).
 */
export async function selectAllByIn<T = any>(
  supabase: any,
  table: string,
  columns: string,
  inColumn: string,
  values: any[],
  extra?: (q: any) => any,
  idChunk = 300,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += idChunk) {
    const slice = values.slice(i, i + idChunk);
    let from = 0;
    while (true) {
      let q = supabase.from(table).select(columns).in(inColumn, slice).range(from, from + PAGE_SIZE - 1);
      if (extra) q = extra(q);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      out.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return out;
}

/**
 * Ejecuta un query builder ya construido paginando con `.range()` hasta agotar.
 * Útil para queries con joins/filtros que no encajan en `selectAllByIn`.
 * `buildQuery(from, to)` debe devolver un PostgREST query con `.range(from, to)` aplicado.
 */
export async function selectAllPaged<T = any>(
  buildQuery: (from: number, to: number) => any,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}
