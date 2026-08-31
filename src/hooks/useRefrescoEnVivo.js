import { useEffect, useRef } from 'react';

/**
 * Volver a leer SOLO, cada tanto, mientras la pantalla está a la vista.
 *
 * Nació de las bolsas de efectivo (usuario, 2026-08-31): «si estamos 2 o 3
 * personas contando, debo actualizar para ver cuáles faltan». Una pantalla de
 * trabajo compartido que sólo se entera de lo que hizo su propia pestaña no
 * está desactualizada de forma visible — está mostrando una lista de pendientes
 * que ya no es cierta, y quien la mira cuenta dos veces la misma bolsa.
 *
 * Tres cosas que lo separan de un `setInterval` suelto:
 *
 * 1. **No corre con la pestaña oculta.** Un `setInterval` en segundo plano
 *    sigue consultando por cada pestaña abierta y por cada persona que dejó el
 *    portal puesto — y justamente ahí nadie está mirando el resultado.
 * 2. **Al volver, se cobra lo que se saltó.** Es la mitad que falta: sin esto,
 *    volver a la pestaña muestra lo de hace media hora y nada en pantalla lo
 *    delata. Sólo si de verdad venció el intervalo, para que alternar entre
 *    ventanas no valga una consulta por cada cambio de foco.
 * 3. **`activo: false` lo PAUSA.** Con un diálogo abierto los datos de abajo no
 *    se tocan: cambiarlos mientras alguien decide sobre ellos es cómo se firma
 *    otra cosa de la que se leyó.
 *
 * `recargar` tiene que ser la lectura SILENCIOSA —la que no borra la pantalla—.
 * Una que ponga «Cargando» deja la vista parpadeando cada intervalo.
 */
export function useRefrescoEnVivo(recargar, { ms = 20_000, activo = true } = {}) {
    const recargarRef = useRef(recargar);
    /* El instante del último disparo. Es una ref y no estado porque cambiarlo no
     * tiene que redibujar nada: nadie lo mira, sólo decide si ya venció.
     * Arranca en 0 y se siembra en un efecto de montaje: leer el reloj DURANTE
     * el render hace que dos renders del mismo estado den resultados distintos
     * (`react-hooks/purity`).
     *
     * Y se siembra en SU PROPIO efecto, no en el del reloj: sembrarlo ahí lo
     * volvía a poner en hora cada vez que se reanudaba una pausa, o sea que
     * cerrar un diálogo reiniciaba la cuenta y había que esperar el intervalo
     * entero — justo lo contrario de «se cobra lo que se saltó». */
    const ultimaRef = useRef(0);
    useEffect(() => { ultimaRef.current = Date.now(); }, []);

    // Por efecto y no durante el render: la función suele venir recreada en cada
    // render del llamador, y escribirle a una ref mientras se renderiza es
    // justamente lo que el compilador de React no admite.
    useEffect(() => { recargarRef.current = recargar; }, [recargar]);

    useEffect(() => {
        if (!activo) return undefined;

        const siVencio = () => {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - ultimaRef.current < ms) return;
            ultimaRef.current = Date.now();
            recargarRef.current?.();
        };

        /* El reloj corre más fino que el intervalo y sólo COMPARA: así, al
         * reanudar la pausa o al volver la pestaña, la lectura llega en
         * segundos en vez de esperar el ciclo entero. Un `Date.now()` cada
         * cinco segundos no cuesta nada; una consulta de más, sí. */
        const reloj = setInterval(siVencio, Math.min(ms, 5_000));
        document.addEventListener('visibilitychange', siVencio);
        return () => {
            clearInterval(reloj);
            document.removeEventListener('visibilitychange', siVencio);
        };
    }, [ms, activo]);
}

export default useRefrescoEnVivo;
