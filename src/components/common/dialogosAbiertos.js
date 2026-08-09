import { useSyncExternalStore } from 'react';

/**
 * La PILA de diálogos abiertos.
 *
 * Nació como un contador, para que el clúster flotante se APAGUE mientras hay
 * una hoja encima (reportado con el panel lateral acostado: el clúster quedaba
 * debajo del vidrio y se transparentaba a través del panel). Se contaba y no se
 * encendía un booleano porque los diálogos se anidan, y cerrar el de adentro
 * habría encendido la barra con el de afuera todavía abierto.
 *
 * ── Por qué hoy es una PILA y no un contador (2026-08-09) ─────────────────
 * Porque «hay diálogos anidados» dejó de ser un dato de fondo y pasó a ser la
 * regla: **un diálogo sobre otro está prohibido**. Se veían los dos a la vez y
 * los textos se pisaban — reportado sobre Conexiones, con el diálogo de bloqueo
 * abierto encima del detalle de la persona.
 *
 * La prohibición no se sostiene pidiéndole a cada vista que cierre lo suyo
 * antes de abrir lo otro: eso es una regla de prosa, y las reglas de prosa se
 * rompen (hay 18 llamadores). Se sostiene desde el canónico — `ModalShell`
 * pregunta si es el de encima y, si no lo es, no pinta. Para contestar eso hace
 * falta saber el ORDEN, no la cantidad.
 *
 * El de abajo no se desmonta: sigue montado con su estado intacto y vuelve a
 * aparecer en cuanto el de encima se va. Ocultarlo y no desmontarlo es lo que
 * hace que «Cancelar» devuelva la pantalla exactamente como estaba.
 *
 * ── Por qué no lo escribe `ModalShell` directo ────────────────────────────
 * Porque `--barra-flotante-display` ya tiene un escritor —`AppLayout`, que la
 * apaga con el menú abierto— y dos efectos escribiendo la misma variable se
 * pisan: el que corra segundo gana, y cuál es depende del orden de render. Acá
 * `ModalShell` solo APILA; la variable la sigue escribiendo `AppLayout`, que
 * mira las dos señales.
 */

let pila = [];   // [{ id, nombre }] — el último es el de encima
const oyentes = new Set();

const avisar = () => { for (const o of oyentes) o(); };

/**
 * Apila un diálogo. Devuelve `{ cerrar, debajo }`:
 *   · `cerrar` — para el cleanup del efecto que lo abrió.
 *   · `debajo` — el nombre del diálogo que quedó tapado, o `null`. Sólo sirve
 *     para avisar en desarrollo: que la pantalla se salve no vuelve legítimo el
 *     anidamiento, y el flujo hay que rediseñarlo igual.
 */
export function abrirDialogo(id, nombre) {
    const debajo = pila.length ? pila[pila.length - 1].nombre : null;
    pila = [...pila, { id, nombre }];
    avisar();
    return {
        debajo,
        cerrar: () => {
            pila = pila.filter(d => d.id !== id);
            avisar();
        },
    };
}

const suscribir = (o) => { oyentes.add(o); return () => oyentes.delete(o); };

/**
 * ¿Es este diálogo el de encima? Es lo que decide si pinta.
 *
 * Un diálogo que TODAVÍA no está en la pila cuenta como el de encima: su id se
 * apila en un efecto, o sea un fotograma después del primer render. Contestar
 * `false` ahí dejaría un fotograma en blanco al abrir cualquier diálogo — y el
 * caso real que esto cubre (el de abajo) sí está en la pila y se resuelve bien.
 */
export function useEsDialogoDeEncima(id) {
    return useSyncExternalStore(
        suscribir,
        () => pila.length === 0
            || pila[pila.length - 1].id === id
            || !pila.some(d => d.id === id),
        () => true,
    );
}

export function useHayDialogo() {
    return useSyncExternalStore(suscribir, () => pila.length > 0, () => false);
}
