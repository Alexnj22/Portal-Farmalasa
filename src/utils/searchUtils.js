/**
 * Normaliza un string para búsqueda: elimina tildes, puntuación y pasa a minúsculas.
 * "S.S.N" → "ssn"  |  "Ácido" → "acido"  |  "CO-TRIMOXAZOL" → "cotrimoxazol"
 */
export function normSearch(str = '') {
    return String(str)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[.\-/,;:()'"’]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Búsqueda por tokens: cada palabra del query debe aparecer en al menos un campo.
 * tokenMatch("grav 500", "GRAVOL 500MG X 8", "Lab") → true
 */
export function tokenMatch(query, ...fields) {
    const tokens = normSearch(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const haystack = fields.map(f => normSearch(f ?? '')).join(' ');
    return tokens.every(t => haystack.includes(t));
}

function levenshtein(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = i;
        for (let j = 1; j <= b.length; j++) {
            const val = a[i - 1] === b[j - 1] ? dp[j - 1] : 1 + Math.min(dp[j - 1], dp[j], prev);
            dp[j - 1] = prev;
            prev = val;
        }
        dp[b.length] = prev;
    }
    return dp[b.length];
}

/**
 * Score de similitud fuzzy 0–1. Usar solo como fallback cuando tokenMatch da 0 resultados.
 * Threshold recomendado: >= 0.72
 */
export function fuzzyScore(query, ...fields) {
    if (tokenMatch(query, ...fields)) return 1;
    const q = normSearch(query);
    const hay = fields.map(f => normSearch(f ?? '')).join(' ');
    const qWords = q.split(/\s+/).filter(w => w.length >= 3);
    const hWords = hay.split(/\s+/).filter(w => w.length >= 2);
    if (!qWords.length || !hWords.length) return 0;
    let total = 0;
    for (const qw of qWords) {
        let best = 0;
        for (const hw of hWords) {
            const maxLen = Math.max(qw.length, hw.length);
            if (maxLen === 0) continue;
            const score = 1 - levenshtein(qw, hw.slice(0, qw.length + 2)) / maxLen;
            if (score > best) best = score;
        }
        total += best;
    }
    return total / qWords.length;
}

const FUZZY_THRESHOLD = 0.72;
const FUZZY_MIN_QUERY  = 4;

/**
 * Filtra un array usando tokenMatch primero; si no hay resultados y el query
 * es suficientemente largo, cae a fuzzyScore.
 *
 * Devuelve { results, isFuzzy } — isFuzzy=true indica que los resultados son
 * aproximados y se debe mostrar el banner "Resultados similares para X".
 *
 * @param {string} query
 * @param {any[]} data
 * @param {(item: any) => string[]} getFields  — función que extrae los campos a buscar
 */
/**
 * Patrón LIKE tokenizado para columnas *_norm en el servidor (PostgREST .ilike()).
 * "alcohol 90" → "%alcohol%90%" (matchea "alcohol90"). Orden-dependiente,
 * a diferencia del LIKE ALL de los RPCs — aceptable para typeahead de producto.
 * Uso: .ilike('nombre_norm', likePattern(term))
 */
export function likePattern(q = '') {
    const toks = normSearch(q).split(/\s+/).filter(Boolean);
    return toks.length ? `%${toks.join('%')}%` : '%';
}

export function smartFilter(query, data, getFields) {
    if (!query?.trim()) return { results: data, isFuzzy: false };

    const exact = data.filter(item => tokenMatch(query, ...getFields(item)));
    if (exact.length) return { results: exact, isFuzzy: false };

    if (query.trim().length < FUZZY_MIN_QUERY) return { results: [], isFuzzy: false };

    const scored = data
        .map(item => ({ item, score: fuzzyScore(query, ...getFields(item)) }))
        .filter(({ score }) => score >= FUZZY_THRESHOLD)
        .sort((a, b) => b.score - a.score);

    return { results: scored.map(s => s.item), isFuzzy: scored.length > 0 };
}
