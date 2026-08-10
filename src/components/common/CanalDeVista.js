import {
    createContext, useContext, useId, useMemo,
    useLayoutEffect, useSyncExternalStore,
} from 'react';

/**
 * CanalDeVista — el cable entre las DOS píldoras de una vista.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * §16.9 dice que una vista tiene dos píldoras: la del header (`ViewTabBar`,
 * navegación + buscador) y la del cuerpo (`FilterBar`, filtros + acciones).
 * En táctil las dos se funden en una sola barra flotante al alcance del pulgar
 * — y ahí aparece el problema: **son HERMANAS, no una descendiente de la otra**.
 * `GlassViewLayout` recibe `ViewTabBar` por la prop `filtersContent` y
 * `FilterBar` por `children`. Un contexto declarado en `ViewTabBar` no llega a
 * `FilterBar` ni al revés.
 *
 * Hasta el 2026-07-30 el puente lo cableaba cada vista a mano, pasándole
 * `buscador={{...}}` a su `FilterBar` además de pasárselo a su `ViewTabBar`.
 * Medido: **1 vista de 22 lo hacía**. No es descuido, es la forma del problema
 * — el mismo dato hay que escribirlo dos veces y una de las dos no se ve rota
 * hasta que alguien abre la vista en un teléfono. Y en las 5 pestañas de
 * Productos era directamente imposible: el estado del buscador vive en
 * `ProductosView` y las pestañas solo reciben el término ya rebotado, nunca el
 * setter.
 *
 * Con el canal el dato se publica UNA vez, donde ya estaba, y el canónico lo
 * encuentra solo. Es la regla que este proyecto ya aplica en `LiquidSelect` →
 * `SelectorTactil`: **el canónico decide, no el llamador.**
 *
 * ── Dos canales, en sentidos opuestos ─────────────────────────────────────
 *   buscador  `ViewTabBar` publica  →  `FilterBar` consume
 *             Para que la barra flotante tenga el buscador sin que la vista lo
 *             repita.
 *   barra     `FilterBar` publica   →  `ViewTabBar` consume
 *             Para que el header sepa que en táctil hay una barra flotante
 *             abajo y NO dibuje su propia lupa. Dos accesos al mismo buscador
 *             —uno de ellos arriba, que se va con el scroll— es peor que uno
 *             solo bien puesto.
 *
 * ── Sin proveedor, todo sigue funcionando ─────────────────────────────────
 * Los hooks devuelven `null` si no hay `ProveedorDeVista` arriba (un `FilterBar`
 * dentro de un modal, por ejemplo). Ahí `ViewTabBar` conserva su buscador y
 * `FilterBar` no muestra ninguno: exactamente el comportamiento previo.
 *
 * ── Por qué un store externo y no `useState` en el proveedor ───────────────
 * `filtersContent` se renderiza DOS VECES en `GlassViewLayout` —una rama para
 * escritorio y otra para móvil, y eso está bien y documentado ahí—. O sea que
 * hay **dos `ViewTabBar` montados publicando a la vez**. Con un `useState` el
 * desmontaje de la copia oculta (al cruzar el breakpoint) borraría lo que
 * publicó la copia viva. Un `Map` por `id` de publicador resuelve las dos
 * cosas: conviven, y cada uno solo borra lo suyo.
 */

/** Comparación superficial: publicar el mismo dato no debe despertar a nadie. */
const igual = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]);
};

function crearCanal() {
    const entradas = new Map();
    const suscriptores = new Set();
    let instantanea = null;

    // La instantánea SOLO cambia de identidad acá dentro. Es el contrato de
    // `useSyncExternalStore`: si `leer()` devolviera un objeto nuevo en cada
    // llamada, React entraría en bucle de renders.
    const recomputar = () => {
        const primera = entradas.values().next();
        instantanea = primera.done ? null : primera.value;
    };

    return {
        publicar(id, valor) {
            if (valor == null) {
                if (!entradas.has(id)) return;
                entradas.delete(id);
            } else {
                if (igual(entradas.get(id), valor)) return;
                entradas.set(id, valor);
            }
            recomputar();
            suscriptores.forEach(f => f());
        },
        suscribir(f) { suscriptores.add(f); return () => suscriptores.delete(f); },
        leer: () => instantanea,
    };
}

/**
 * El proveedor lo RENDERIZA `GlassViewLayout`, no este archivo: acá no vive
 * ningún componente para que el módulo sea solo hooks y el fast-refresh no se
 * caiga (un archivo que exporta componentes y no-componentes a la vez pierde el
 * hot reload de los dos).
 */
export const CanalDeVistaCtx = createContext(null);

/** Crea los canales, una vez por vista. Lo llama `GlassViewLayout`. */
export const useCanalesDeVista = () =>
    useMemo(() => ({ buscador: crearCanal(), barra: crearCanal(), filtros: crearCanal() }), []);

/**
 * Publica un valor en un canal. Sin array de dependencias a propósito: el
 * efecto corre en cada render y `publicar` descarta lo que no cambió. La
 * alternativa —enumerar las deps— obliga al llamador a memoizar el objeto, que
 * es justo el tipo de paso que se olvida.
 *
 * `useLayoutEffect` y no `useEffect`: el consumidor tiene que enterarse ANTES
 * del pintado o se ve un cuadro con la lupa del header dibujada de más.
 */
function usePublicar(nombre, valor) {
    const canales = useContext(CanalDeVistaCtx);
    const canal = canales?.[nombre] ?? null;
    const id = useId();

    // El efecto cierra sobre `valor` del render en curso, así que no hace falta
    // un ref —y escribir un ref durante el render es justo lo que el compilador
    // de React prohíbe—. Corre en cada render y `publicar` descarta lo repetido.
    useLayoutEffect(() => {
        if (canal) canal.publicar(id, valor);
    });

    // ── La baja va en SU PROPIO efecto, y esto no es cosmético ────────────
    // Estaba junto al alta, como `return () => publicar(id, null)` del efecto de
    // arriba. Pero ese efecto no tiene array de dependencias, así que su limpieza
    // corre en CADA render — y borrar del Map siempre cambia el Map, así que
    // siempre notificaba, aunque el valor fuera idéntico. Con dos canales
    // apuntándose entre sí eso es un bucle cerrado: `ViewTabBar` publica →
    // `FilterBar` re-renderiza → publica → `ViewTabBar` re-renderiza → publica…
    // Se manifestó como React #185 ("Maximum update depth exceeded") y tiraba la
    // vista entera al ErrorBoundary en el teléfono.
    //
    // Con deps `[canal, id]` la limpieza corre solo al desmontar, y el alta de
    // arriba —que sí corre siempre— no notifica cuando el valor no cambió.
    useLayoutEffect(() => {
        if (!canal) return undefined;
        return () => canal.publicar(id, null);
    }, [canal, id]);
}

const sinSuscripcion = () => () => {};
const sinValor = () => null;

function useLeer(nombre) {
    const canales = useContext(CanalDeVistaCtx);
    const canal = canales?.[nombre] ?? null;
    return useSyncExternalStore(
        canal ? canal.suscribir : sinSuscripcion,
        canal ? canal.leer : sinValor,
        sinValor,
    );
}

/** `ViewTabBar` → `{ value, onChange, placeholder }`, o `null` si no hay buscador. */
export const usePublicarBuscador = cfg => usePublicar('buscador', cfg);
export const useBuscadorDeVista = () => useLeer('buscador');

/**
 * `FilterBar` → `{ activa: true }` mientras dibuja la barra flotante táctil.
 *
 * Escribe en DOS canales y la diferencia entre ellos es lo único que evita un
 * bucle (ver `useHayBarraDeFiltros`):
 *   `barra`    "hay una barra flotante abajo" — la escribe cualquiera que
 *              dibuje una, y es lo que hace que `ViewTabBar` suelte su lupa.
 *   `filtros`  "la barra la puso un `FilterBar`" — la escribe SOLO él.
 */
export const usePublicarBarraFlotante = (activa) => {
    const valor = activa ? { activa: true } : null;
    usePublicar('barra', valor);
    usePublicar('filtros', valor);
};
export const useHayBarraFlotante = () => !!useLeer('barra');

/**
 * ── El respaldo del layout, y por qué NO puede leer `barra` ────────────────
 * Una vista puede tener buscador y **no** tener `FilterBar` — pasa en 5
 * (Pedidos, Laboratorios, Roles, Avisos, Mantenimiento). Como la barra flotante
 * sólo la dibujaba `FilterBar`, en el teléfono esas cinco se quedaban con la
 * lupa arriba, que se va con el scroll. `GlassViewLayout` dibuja entonces una
 * barra flotante de respaldo con el buscador solo.
 *
 * Ese respaldo **publica** en `barra` (para que `ViewTabBar` suelte la lupa) y
 * **lee** `filtros` para saber si hace falta. Leer `barra` —lo que él mismo
 * escribe— sería la condición apagándose a sí misma: dibuja → publica → ahora
 * "ya hay barra" → deja de dibujar → deja de publicar → vuelve a dibujar. Es la
 * misma forma del bucle que documenta `usePublicar` más arriba (React #185, la
 * vista entera al ErrorBoundary en el teléfono), y por eso los canales son dos.
 */
export const useHayBarraDeFiltros = () => !!useLeer('filtros');
export const usePublicarBarraDeBusqueda = activa =>
    usePublicar('barra', activa ? { activa: true } : null);
