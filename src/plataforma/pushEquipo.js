// ── El aviso del sistema es del EQUIPO; su dueño es quien tenga sesión ahí ────
//
// Web Push no tiene forma de pertenecer a una cuenta: el `endpoint` lo emite el
// navegador de esa computadora y es la única dirección que existe. En las
// máquinas de mostrador, donde el turno cambia de persona y el equipo no, eso
// dejaba la suscripción ligada al PRIMERO que apretó «Activar» ahí y cerrar
// sesión no la soltaba — los avisos de quien ya se fue seguían cayendo en esa
// pantalla y el siguiente no recibía ninguno de los suyos.
//
// Entonces el dueño se define por quien está adentro:
//
//   · al ENTRAR se reclama el equipo (`reclamarPushDelEquipo`),
//   · al SALIR se suelta si el equipo es compartido
//     (`soltarPushDelEquipoSiEsCompartido`).
//
// Lo que NO se hace al soltar es `sub.unsubscribe()`: se borra la fila pero la
// suscripción del navegador se deja viva. Así el permiso ya concedido sigue
// puesto y el siguiente empleado queda ligado en silencio al iniciar sesión, sin
// tener que enterarse de nada ni volver a autorizar avisos.
import { reclamarPushSubscription } from '@nucleo/data/pushSubscriptions';
import { AUTH_STORAGE_KEY } from '@nucleo/supabaseClient';

// El endpoint se RECUERDA al reclamar. En `pagehide` no hay tiempo de
// preguntárselo al service worker: `getSubscription()` es asíncrono y la página
// ya se está muriendo, así que la respuesta llegaría a un mundo que no existe.
let endpointDelEquipo = null;

async function suscripcionDeEsteNavegador() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    if (typeof window === 'undefined' || !('PushManager' in window)) return null;
    // `getRegistration()` y NO `ready`: `ready` es una promesa que jamás se
    // resuelve si no hay service worker registrado, y esto se llama en los
    // caminos de inicio y cierre de sesión, donde quedarse colgado sería mudo.
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return reg.pushManager.getSubscription();
}

// El hook está montado dos veces (banner + barra lateral) y los dos preguntan
// por el mismo equipo: se comparte la promesa para que salga UNA llamada y las
// dos instancias contesten lo mismo.
let reclamo = { employeeId: null, promesa: null };

async function hacerReclamo() {
    try {
        const sub = await suscripcionDeEsteNavegador();
        if (!sub) return null;   // nadie activó avisos en este equipo: nada que reclamar
        const { endpoint, keys: { p256dh, auth } } = sub.toJSON();
        endpointDelEquipo = endpoint;
        const { error } = await reclamarPushSubscription({ endpoint, p256dh, auth });
        if (error) {
            console.error('Push: no se pudo ligar este equipo a la sesión:', error.message);
            return false;
        }
        return true;
    } catch (err) {
        console.error('Push: no se pudo ligar este equipo a la sesión:', err);
        return false;
    }
}

/**
 * Liga la suscripción de este navegador al empleado que acaba de entrar.
 * Devuelve `true` si quedó ligada, `false` si falló y `null` si no había nada
 * que reclamar. El `false` importa: el hook lo usa para dejar de decir que los
 * avisos están activos cuando la base no tiene a nadie ligado — si no, la
 * persona vería la campanita en verde sin recibir uno solo.
 */
export function reclamarPushDelEquipo(employeeId) {
    if (!employeeId) return Promise.resolve(null);
    if (reclamo.employeeId !== employeeId) {
        reclamo = { employeeId, promesa: hacerReclamo() };
    }
    return reclamo.promesa;
}

/**
 * Suelta el equipo al cerrar sesión, salvo que sea de una sola persona.
 *
 * El criterio es la clase de dispositivo que ya fija `AuthContext`
 * (`sb_device_class`), y llega por parámetro porque ese dato es suyo:
 *
 *   · `app` — el portal agregado a la pantalla de inicio o el build nativo. Es
 *     el teléfono de alguien, y ahí la suscripción TIENE que sobrevivir al
 *     cierre de sesión: recibir avisos con la app cerrada es lo único para lo
 *     que existe, y la sesión también se cierra sola por inactividad.
 *   · `navegador` — se trata como compartido. Una computadora sin nadie adentro
 *     no le manda avisos a nadie; el siguiente que entre la reclama.
 *
 * El único caso que este criterio no cubriría es una PWA instalada en una
 * computadora compartida: se clasificaría `app` y conservaría el defecto viejo.
 * **Decisión del usuario, 2026-08-10: no se va a instalar como app en las
 * computadoras del trabajo**, así que la clase de dispositivo alcanza. Si algún
 * día se instala en el mostrador, esto deja de alcanzar y hace falta una marca
 * explícita del equipo.
 */
export async function soltarPushDelEquipoSiEsCompartido(claseDispositivo) {
    reclamo = { employeeId: null, promesa: null };
    const recordado = endpointDelEquipo;
    endpointDelEquipo = null;
    if (claseDispositivo === 'app') return;

    // El token se lee ANTES del primer `await`, y la llamada no pasa por el
    // cliente de supabase. `doLogout` llama a esto y en el MISMO tick sigue con
    // `signOut()`, que borra la sesión del cliente: cuando `supabase.rpc` iba a
    // buscar el token, ya no había, la llamada salía como `anon` y el servidor
    // contestaba 401. Medido el 21-sep: **300 de 361** cierres de sesión no
    // soltaron el equipo, así que los avisos de quien se fue seguían cayendo en
    // esa pantalla — justo lo que esta función existe para evitar.
    // El token capturado sigue sirviendo después del `signOut`: el servidor
    // valida la firma y el vencimiento del JWT, no si la sesión sigue abierta.
    const sesion = sesionGuardada();
    if (!sesion?.access_token) return;
    try {
        const endpoint = recordado || (await suscripcionDeEsteNavegador())?.toJSON().endpoint;
        if (!endpoint) return;
        // El cierre típico de sala es por inactividad, y para entonces el token
        // suele estar VENCIDO: la computadora se durmió o la pestaña quedó en
        // segundo plano y nadie lo renovó. PostgREST lo rechaza con 401 antes de
        // llegar a la función — medido el 2026-11-05: 42 de 389 cierres (11%)
        // no soltaron el equipo. Por eso se renueva primero, y `doLogout`
        // espera a que esto termine antes de revocar la sesión.
        // Si la renovación falla se intenta igual con el viejo: peor no queda.
        const token = tokenVigente(sesion)
            ? sesion.access_token
            : (await renovarSesion(sesion)) || sesion.access_token;
        const res = await soltarConToken(endpoint, token);
        if (res && !res.ok) console.error('Push: no se pudo soltar el equipo:', res.status);
    } catch (err) {
        console.error('Push: no se pudo soltar el equipo:', err);
    }
}

// El token de la sesión, leído de `localStorage` en el acto: `getSession()` es
// asíncrono, y los dos llamadores de abajo no tienen futuro que esperar.
function sesionGuardada() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
    } catch {
        return null;   // sin sesión guardada: no hay a quién soltar
    }
}

function tokenDeLaSesion() {
    return sesionGuardada()?.access_token || null;
}

// Con 30 s de margen: el token tiene que seguir valiendo cuando LLEGUE. Sin
// `expires_at` no hay con qué decidir y se usa tal cual, como antes.
function tokenVigente(sesion) {
    const vence = Number(sesion?.expires_at);
    if (!sesion?.expires_at || !Number.isFinite(vence)) return true;
    return vence * 1000 > Date.now() + 30_000;
}

// Se renueva a mano y no con `supabase.auth.refreshSession()`: ésa emite
// TOKEN_REFRESHED, y el oyente de `AuthContext` podría volver a poner adentro a
// quien se está yendo. La sesión nueva se guarda donde estaba la vieja —sólo si
// nadie la cambió en el medio— para que el `signOut` que viene detrás revoque
// ESTA y no intente renovar con un refresh token que ya se gastó.
async function renovarSesion(sesion) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon || !sesion?.refresh_token) return null;
    try {
        const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: anon },
            body: JSON.stringify({ refresh_token: sesion.refresh_token }),
        });
        if (!res.ok) return null;
        const nueva = await res.json();
        if (!nueva?.access_token) return null;
        if (sesionGuardada()?.refresh_token === sesion.refresh_token) {
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...sesion, ...nueva }));
        }
        return nueva.access_token;
    } catch {
        return null;
    }
}

// `keepalive` en los dos casos: en `pagehide` la página se muere, y en el
// cierre de sesión el portal navega al login mientras la llamada vuela.
function soltarConToken(endpoint, token) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) return Promise.resolve(null);
    return fetch(`${url}/rest/v1/rpc/soltar_push_del_equipo`, {
        method: 'POST',
        keepalive: true,
        headers: {
            'Content-Type': 'application/json',
            apikey: anon,
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ p_endpoint: endpoint }),
    });
}

/**
 * Suelta el equipo cuando se va la PÁGINA — cerrar la pestaña o el navegador—,
 * que es el único cierre que `doLogout` no cubre: no hay botón, no hay
 * vencimiento, simplemente deja de existir. Sin esto la fila quedaba ligada a
 * quien se fue y sus avisos seguían cayendo en esa pantalla de la sala hasta que
 * otra persona entrara ahí y la reclamara.
 *
 * Tres decisiones que no son de gusto:
 *
 *  · **`fetch` con `keepalive`, no `supabase.rpc`.** En `pagehide` el navegador
 *    mata las peticiones en vuelo; `keepalive` se la entrega al sistema y
 *    sobrevive a que la página muera. `sendBeacon` también sobrevive pero NO
 *    deja poner cabeceras, y sin `Authorization` el servidor no sabe quién
 *    suelta qué.
 *  · **El token se lee de `localStorage`, en el acto.** `getSession()` es
 *    asíncrono y acá no hay futuro que esperar.
 *  · **Sólo `navegador`.** En un teléfono con la app instalada `pagehide`
 *    dispara cada vez que se cambia de aplicación: soltarlo ahí desligaría el
 *    equipo todo el día y el aviso dejaría de llegar justo cuando sirve —con la
 *    app cerrada—, que es lo único para lo que existe.
 *
 * `pagehide` también dispara al recargar (F5). Se acepta: al arrancar, el hook
 * reclama de nuevo y la ventana sin dueño dura lo que tarda el arranque.
 */
export function soltarPushAlCerrarLaPagina(claseDispositivo) {
    if (claseDispositivo === 'app') return;
    if (!endpointDelEquipo) return;

    const token = tokenDeLaSesion();
    if (!token) return;

    try {
        soltarConToken(endpointDelEquipo, token)
            .catch(() => { /* la página ya se fue: no hay dónde reportarlo */ });
    } catch { /* idem */ }

    endpointDelEquipo = null;
}
