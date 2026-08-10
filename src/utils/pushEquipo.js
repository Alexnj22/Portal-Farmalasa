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
import { reclamarPushSubscription, soltarPushSubscription } from '../data/pushSubscriptions';

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
 */
export async function soltarPushDelEquipoSiEsCompartido(claseDispositivo) {
    reclamo = { employeeId: null, promesa: null };
    if (claseDispositivo === 'app') return;
    try {
        const sub = await suscripcionDeEsteNavegador();
        if (!sub) return;
        const { error } = await soltarPushSubscription(sub.toJSON().endpoint);
        if (error) console.error('Push: no se pudo soltar el equipo:', error.message);
    } catch (err) {
        console.error('Push: no se pudo soltar el equipo:', err);
    }
}
