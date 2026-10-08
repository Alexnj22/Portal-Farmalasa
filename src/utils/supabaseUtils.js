// PostgREST trunca en 1000 filas sin aviso (max-rows=1000). Este helper pagina
// cualquier query hasta agotarla — usar para tablas que crecen sin tope.
//
// Si falla una página que NO es la primera, por omisión devuelve lo que ya
// juntó: es el comportamiento de siempre y hay llamadores que lo prefieren a
// nada. Con `{ completo: true }` cualquier fallo devuelve `null` — para quien
// decide sobre la lista entera (cuántas cajas salen, qué se imprime), una lista
// a medias es peor que ninguna, porque no se distingue de una completa.
export const fetchAllRows = async (buildQuery, { completo = false } = {}) => {
    const CHUNK = 1000;
    let all = [];
    for (let page = 0; ; page++) {
        const { data, error } = await buildQuery().range(page * CHUNK, (page + 1) * CHUNK - 1);
        if (error) {
            console.error('fetchAllRows error:', error.message);
            return page === 0 || completo ? null : all;
        }
        all = all.concat(data || []);
        if (!data || data.length < CHUNK) break;
    }
    return all;
};
