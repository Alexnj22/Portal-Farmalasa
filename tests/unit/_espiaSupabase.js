// Un espía encadenable de `supabase`, para probar la FORMA de una consulta.
//
// Las capas de datos del portal no calculan: arman consultas. Y lo que se rompe
// ahí no da error —da filas de menos—, así que lo que hay que anclar es
// exactamente eso: qué tabla, qué filtros, si pagina, si el orden es total.
//
// Cada llamada queda registrada en `pasos`, y el objeto se devuelve a sí mismo
// para que la cadena siga. `single()`, `maybeSingle()` y el `await` devuelven
// `{ data: [], error: null }`, que es lo que espera el llamador.
//
// No reemplaza a `fetchAllRows`: si la capa lo usa de verdad, el espía ve las
// llamadas que ese helper hace por dentro, que es justo lo que se quiere
// comprobar.

export function crearEspia() {
    const pasos = [];
    const rpc = [];

    const nodo = {
        // Se resuelve como una promesa para que `await consulta` funcione.
        then: (resolver) => Promise.resolve({ data: [], error: null }).then(resolver),
    };

    const METODOS = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'gt', 'gte',
                     'lt', 'lte', 'in', 'is', 'or', 'not', 'like', 'ilike', 'contains',
                     'order', 'limit', 'range', 'single', 'maybeSingle', 'returns', 'filter',
                     'overlaps', 'textSearch', 'abortSignal'];

    for (const m of METODOS) {
        nodo[m] = (...args) => { pasos.push({ metodo: m, args }); return nodo; };
    }

    const supabase = {
        from: (tabla) => { pasos.push({ metodo: 'from', args: [tabla] }); return nodo; },
        rpc: (nombre, args) => { rpc.push({ nombre, args }); return nodo; },
    };

    return {
        supabase,
        pasos,
        rpc,
        limpiar: () => { pasos.length = 0; rpc.length = 0; },
        /** Los argumentos de la primera llamada a `metodo`, o `undefined`. */
        primero: (metodo) => pasos.find(p => p.metodo === metodo)?.args,
        /** Todas las llamadas a `metodo`. */
        todos: (metodo) => pasos.filter(p => p.metodo === metodo).map(p => p.args),
        /** La tabla de la consulta. */
        tabla: () => pasos.find(p => p.metodo === 'from')?.args[0],
        /** ¿Se llamó a `metodo`? */
        uso: (metodo) => pasos.some(p => p.metodo === metodo),
    };
}
