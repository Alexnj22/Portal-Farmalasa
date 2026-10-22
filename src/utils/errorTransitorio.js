// ¿Este error de PostgREST puede dar otro resultado si se repite?
//
// Nació en el kiosco (auditoría 2026-10-21). Ahí la regla era «un error con
// `code` es un rechazo REAL del servidor; sin `code` es la red», y con eso un
// marcaje se descartaba para siempre. Pero los fallos transitorios TAMBIÉN
// traen código: `PGRST003` es el *Timed out acquiring connection from
// connection pool* —el modo de caída del 01-sep—, `57014` el statement
// timeout, y los 5xx del gateway. En una saturación, un marcaje no se
// encolaba («NO SE PUDO REGISTRAR») y uno que salía de la cola justo cuando
// volvía la red se tiraba con un `console.warn`.
//
// Se reintenta lo que NO llegó a ejecutarse o se canceló entero (rollback):
// sin conexión, sin ranura en el pool, timeout, conexión cortada, conflicto
// de serialización. Un rechazo de datos o permisos (`P0001`, `42501`, `23505`…)
// da lo mismo cuántas veces se mande.

const CODIGOS_TRANSITORIOS = new Set([
    'PGRST000', // no se pudo conectar a la base
    'PGRST001', // error interno de conexión
    'PGRST002', // no se pudo armar el caché del esquema
    'PGRST003', // sin conexión libre en el pool (504)
    '57014',    // statement timeout
    '57P01',    // admin_shutdown
    '57P02',    // crash_shutdown
    '57P03',    // cannot_connect_now
    '53300',    // too_many_connections
    '40001',    // serialization_failure
    '40P01',    // deadlock_detected
]);

const TEXTO_DE_RED = /Failed to fetch|NetworkError|Load failed|ECONNRESET|network request failed|timed out|timeout/i;

/**
 * @param {{ code?: string|number, message?: string, name?: string } | null | undefined} error
 * @returns {boolean} true si conviene reintentar (o encolar) en vez de descartar
 */
export function esFalloTransitorio(error) {
    if (!error) return false;
    const codigo = String(error.code ?? '').trim();
    // Sin código no hubo respuesta de Postgres: la petición no llegó o no volvió.
    if (!codigo) return true;
    if (CODIGOS_TRANSITORIOS.has(codigo)) return true;
    if (/^08/.test(codigo)) return true;      // clase 08: excepción de conexión
    if (/^5\d\d$/.test(codigo)) return true;  // 5xx del gateway
    return TEXTO_DE_RED.test(String(error.message || error.name || ''));
}
