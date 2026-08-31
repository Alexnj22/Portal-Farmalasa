import { useCallback, useEffect, useId, useRef } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Que una pantalla de trabajo compartido se ponga al día sola.
 *
 * Nació de las bolsas de efectivo (usuario, 2026-08-31): «si estamos 2 o 3
 * personas contando, debo actualizar para ver cuáles faltan». Una vista que sólo
 * se entera de lo que hizo su propia pestaña no se ve desactualizada — muestra
 * una lista de pendientes que ya no es cierta, y quien la mira cuenta dos veces
 * la misma bolsa.
 *
 * ── Por qué son DOS caminos y no uno ────────────────────────────────────────
 *
 * `tabla` abre un canal de realtime: el cambio llega en cuanto pasa, que es lo
 * que hace que contar entre varios se sienta compartido y no por turnos.
 *
 * Pero el reloj NO se apaga cuando hay realtime, y ésa es la parte que se
 * olvida: lo que llega por el socket llega **sólo mientras el socket está
 * vivo**, y nada recupera después lo que pasó mientras estuvo caído. Una
 * pestaña suspendida —el teléfono en segundo plano, el ahorro de memoria del
 * navegador, un corte de red— vuelve mostrando lo de antes y *parece* al día.
 * Es peor que no tener realtime. Con canal, el reloj corre lento y es la red;
 * sin canal, es el único camino y corre más seguido.
 *
 * ── Las tres cosas que un `setInterval` suelto no hace ──────────────────────
 *
 * 1. **No consulta con la pestaña oculta.** Un reloj suelto sigue preguntando
 *    por cada pestaña abierta y por cada portal que quedó puesto — justamente
 *    donde nadie está mirando el resultado.
 * 2. **Al volver, cobra lo que se saltó.** Sólo si de verdad venció el
 *    intervalo, para que alternar entre ventanas no valga una consulta por cada
 *    cambio de foco.
 * 3. **`activo: false` lo PAUSA, sin perder el aviso.** Con un diálogo abierto
 *    los datos de abajo no se tocan: cambiarlos mientras alguien decide sobre
 *    ellos es cómo se firma otra cosa de la que se leyó. Lo que llegó durante la
 *    pausa queda anotado y se lee al cerrar.
 *
 * `recargar` tiene que ser la lectura SILENCIOSA —la que no borra la pantalla—.
 * Una que ponga «Cargando» deja la vista parpadeando cada intervalo.
 */
export function useRefrescoEnVivo(recargar, {
    ms = 20_000,
    activo = true,
    tabla = null,
    esperaMs = 400,
} = {}) {
    const recargarRef = useRef(recargar);
    /* El instante de la última lectura. Es una ref y no estado porque cambiarlo
     * no tiene que redibujar nada: nadie lo mira, sólo decide si ya venció.
     * Arranca en 0 y se siembra en un efecto de montaje: leer el reloj DURANTE
     * el render hace que dos renders del mismo estado den resultados distintos
     * (`react-hooks/purity`).
     *
     * Y se siembra en SU PROPIO efecto, no en el del reloj: sembrarlo ahí lo
     * volvía a poner en hora cada vez que se reanudaba una pausa, o sea que
     * cerrar un diálogo reiniciaba la cuenta y había que esperar el intervalo
     * entero — justo lo contrario de «se cobra lo que se saltó». */
    const ultimaRef = useRef(0);
    // Llegó un aviso mientras estaba en pausa: se lee al reanudar.
    const pendienteRef = useRef(false);
    // La pausa, legible desde el callback del canal, que no se vuelve a crear.
    const activoRef = useRef(activo);

    useEffect(() => { ultimaRef.current = Date.now(); }, []);

    // Por efecto y no durante el render: la función suele venir recreada en cada
    // render del llamador, y escribirle a una ref mientras se renderiza es
    // justamente lo que el compilador de React no admite.
    useEffect(() => { recargarRef.current = recargar; }, [recargar]);
    useEffect(() => { activoRef.current = activo; }, [activo]);

    /* Los DOS caminos leen por acá, y por eso los dos ponen el reloj en hora:
     * si no, un aviso de realtime dejaría al reloj creyendo que la pantalla
     * sigue vieja y consultaría de nuevo un segundo después. */
    const leer = useCallback(() => {
        ultimaRef.current = Date.now();
        recargarRef.current?.();
    }, []);

    // ── El reloj ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!activo) return undefined;
        // Lo anotado durante la pausa se cobra al reanudar, sin esperar el ciclo.
        if (pendienteRef.current) { pendienteRef.current = false; leer(); }

        const siVencio = () => {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - ultimaRef.current < ms) return;
            leer();
        };

        /* El reloj corre más fino que el intervalo y sólo COMPARA: así, al
         * reanudar la pausa o al volver la pestaña, la lectura llega en
         * segundos en vez de esperar el ciclo entero. Un `Date.now()` cada
         * cinco segundos no cuesta nada; una consulta de más, sí. */
        const tic = setInterval(siVencio, Math.min(ms, 5_000));
        document.addEventListener('visibilitychange', siVencio);
        return () => {
            clearInterval(tic);
            document.removeEventListener('visibilitychange', siVencio);
        };
    }, [ms, activo, leer]);

    // ── El aviso de la base ─────────────────────────────────────────────────
    /* El nombre del canal lleva el `useId` del componente: dos vistas mirando la
     * misma tabla a la vez pedirían el mismo tema y una se quedaría sin recibir
     * — un modo de falla mudo, que es el que no se puede permitir acá. */
    const idDelCanal = useId();
    useEffect(() => {
        if (!tabla) return undefined;

        /* Coalescido a propósito. Confirmar un conteo de treinta bolsas es un
         * UPDATE por bolsa: sin esto serían treinta lecturas completas de la
         * pantalla, todas devolviendo lo mismo. Se espera a que el ruido pare y
         * se lee UNA vez. */
        let plazo = null;
        const canal = supabase
            .channel(`refresco-${tabla}-${idDelCanal}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: tabla }, () => {
                if (!activoRef.current) { pendienteRef.current = true; return; }
                clearTimeout(plazo);
                plazo = setTimeout(leer, esperaMs);
            })
            .subscribe();

        return () => { clearTimeout(plazo); supabase.removeChannel(canal); };
    }, [tabla, esperaMs, leer, idDelCanal]);
}

export default useRefrescoEnVivo;
