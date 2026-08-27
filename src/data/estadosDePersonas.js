import { supabase } from '../supabaseClient';

// ── El estado de una persona, preguntado UNA vez por pantalla ───────────────
//
// El aro de la foto (`AvatarConEstado`, DESIGN.md §5.4) tiene que salir en las
// 26 pantallas donde aparece alguien, y una pantalla puede pintar cuarenta
// caras. Preguntar una por una serían cuarenta llamadas para el mismo dato: no
// es «un poco más lento», es la diferencia entre una petición y cuarenta, y
// cada una ocupa una ranura del pool de PostgREST — el mismo pool que una
// lectura lenta llena hasta tirar el portal (ver
// `feedback_una_consulta_lenta_de_lectura_tumba_el_portal_entero`).
//
// Así que las peticiones se JUNTAN. Cada avatar dice «necesito este id», y en
// el siguiente turno del bucle de eventos sale UNA llamada con todos los ids
// que se acumularon. Cuarenta caras = una consulta, medida en 16 ms para las 49
// personas de la empresa entera.
//
// ── Lo que NO se pregunta ─────────────────────────────────────────────────
// La base sólo hace falta cuando el navegador no puede saberlo solo. Quien
// tiene permiso de ver el historial ya lo recibió entero en el arranque
// (`historialCompleto`), y ahí `AvatarConEstado` resuelve el aro sin una sola
// petición. Esto atiende al resto: la dependienta que mira un pedido despachado
// desde Bodega y cuyo navegador no tiene ni la ficha ni los eventos de quien lo
// despachó.
//
// ── Y sólo viajan los ausentes ────────────────────────────────────────────
// La función descarta a quien está presente antes de devolver, así que la
// respuesta típica es `[]`. Pero un id que NO vuelve significa «está», no «no
// se preguntó»: por eso se cachean también los ausentes de la respuesta, con
// `null`. Sin eso, cada render volvería a pedir a los presentes — que son la
// mayoría — y el batcher no ahorraría nada.

// El estado vive en `employee_events`, que cambia cuando alguien carga una
// vacación: raro, y nunca mientras se mira una pantalla. Cinco minutos es
// suficiente para que una sesión larga se entere sin preguntar de más.
const VIGENCIA_MS = 5 * 60 * 1000;

const cache = new Map();          // id → { estado, at }
const suscriptores = new Set();
let pendientes = new Set();
let programado = false;

const avisar = () => suscriptores.forEach(fn => { try { fn(); } catch { /* un oyente roto no puede romper a los demás */ } });

function guardar(id, estado) {
    cache.set(String(id), { estado, at: Date.now() });
}

const vigente = (e) => e && (Date.now() - e.at) < VIGENCIA_MS;

async function resolverTanda() {
    programado = false;
    const ids = [...pendientes];
    pendientes = new Set();
    if (!ids.length) return;

    // Se marcan ANTES de la respuesta para que un segundo render no vuelva a
    // pedir los mismos ids mientras la primera llamada está en vuelo.
    ids.forEach(id => { if (!cache.has(id)) guardar(id, null); });

    const { data, error } = await supabase.rpc('get_estados_de_personas', { p_ids: ids });
    if (error) {
        // El error NO se traga en silencio: un `select` que falla sin avisar
        // deja el mapa vacío y el aro desaparece de todas las fotos sin que
        // nada lo delate. Pero tampoco se lanza — una foto sin aro no puede
        // tumbar la pantalla que la contiene.
        console.error('get_estados_de_personas falló:', error.message);
        // Se vencen los que se acababan de marcar, para que el próximo render
        // reintente en vez de quedarse con un «está» que nadie confirmó.
        ids.forEach(id => cache.delete(id));
        avisar();
        return;
    }

    (data || []).forEach(fila => guardar(fila.id, { clave: fila.clave, hasta: fila.hasta || null }));
    avisar();
}

// ── LEER y PEDIR son dos funciones, y eso no es estilo ────────────────────
//
// La primera versión las tenía juntas: una sola función que devolvía lo
// cacheado y, si no lo tenía, lo pedía. Se la pasé a `useSyncExternalStore`
// como `getSnapshot` y el proceso de pruebas MURIÓ — «Worker exited
// unexpectedly», sin un error que dijera por qué.
//
// El contrato de `getSnapshot` es que sea PURA: React la llama varias veces por
// render para comparar, así que una función con efecto se dispara N veces por
// cada pintada y se realimenta con el aviso que ella misma provoca.
//
// Separadas, cada una hace una cosa: `leerEstado` mira el mapa y no toca nada
// —apta para `getSnapshot`—, y `pedirEstado` es el efecto, que va donde van los
// efectos.

/** Lo que hay en memoria. PURA: no pide nada. `undefined` = todavía no se sabe. */
export function leerEstado(id) {
    if (!id) return null;
    const guardado = cache.get(String(id));
    return vigente(guardado) ? guardado.estado : undefined;
}

/** Encola el id para la próxima tanda. Es el efecto. */
export function pedirEstado(id) {
    if (!id) return;
    const clave = String(id);
    if (vigente(cache.get(clave))) return;

    pendientes.add(clave);
    if (!programado) {
        programado = true;
        // `queueMicrotask` y no un `setTimeout`: junta todo lo que se pide
        // durante UN render de React —que es lo que se quiere— sin agregarle
        // un retraso visible a la primera pintada.
        queueMicrotask(resolverTanda);
    }
}

export function suscribirse(fn) {
    suscriptores.add(fn);
    return () => suscriptores.delete(fn);
}

/** Para las pruebas: deja el módulo como recién cargado. */
export function _limpiarCache() {
    cache.clear();
    pendientes = new Set();
    programado = false;
}
