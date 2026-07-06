// PostgREST trunca en 1000 filas sin aviso (max-rows=1000). Este helper pagina
// cualquier query hasta agotarla — usar para tablas que crecen sin tope.
export const fetchAllRows = async (buildQuery) => {
    const CHUNK = 1000;
    let all = [];
    for (let page = 0; ; page++) {
        const { data, error } = await buildQuery().range(page * CHUNK, (page + 1) * CHUNK - 1);
        if (error) {
            console.error('fetchAllRows error:', error.message);
            return page === 0 ? null : all;
        }
        all = all.concat(data || []);
        if (!data || data.length < CHUNK) break;
    }
    return all;
};
