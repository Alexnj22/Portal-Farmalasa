import useMediaQuery from './useMediaQuery';

/**
 * ¿Esta pantalla se dibuja con el layout compacto (el del teléfono)?
 *
 * ── Por qué no alcanza con el ancho ───────────────────────────────────────
 * El corte era `(max-width: 719px)` a secas, y eso da por sentado que un
 * teléfono es angosto. **Acostado no lo es.** Medido en WebKit:
 *
 *     iPhone 13 acostado        844 × 390   → 844px de ancho → "escritorio"
 *     iPhone 15 Pro Max acost.  932 × 430   → idem
 *     Android grande acostado   915 × 412   → idem
 *
 * O sea que girar el teléfono hacía desaparecer el clúster flotante y volvía
 * la barra de filtros de escritorio, con sus objetivos de mouse, en una
 * pantalla que se sigue manejando con el pulgar. Lo reportó el usuario.
 *
 * El único teléfono que se salvaba era el iPhone SE (667 × 375 acostado), y se
 * salvaba **por accidente**: 667 cae por debajo de 719. No había ninguna
 * intención ahí — simplemente los teléfonos crecieron y se pasaron del número.
 *
 * ── La regla ya estaba escrita en este repo ───────────────────────────────
 * `useCoarsePointer` lo dice textual: *"lo que decide no es cuánto mide la
 * ventana sino con qué se apunta"*, y `TabBarAction`/`ModalShell` deciden por
 * `(hover: none)` justamente por esto. Lo que faltaba era aplicarlo acá.
 *
 * ── Por qué NO es solo `(hover: none)` ────────────────────────────────────
 * Porque entonces una tablet entraría en el layout del teléfono, y ahí sí
 * sobra sitio para la barra de filtros completa — el clúster flotante existe
 * para llegar con el pulgar en una pantalla chica, no para toda pantalla
 * táctil. Lo que distingue un teléfono acostado de una tablet acostada no es
 * el ancho: es el **alto**.
 *
 *     teléfonos acostados   375 – 430px de alto
 *     tablets acostadas     744 – 834px de alto
 *
 * 500px cae limpio en el medio, con más del doble de margen a cada lado que
 * cualquier dispositivo real. Verificado contra los dos extremos: el iPad mini
 * (744) sigue en escritorio y el teléfono más grande (430) entra en compacto.
 *
 * ── Una sola fuente de verdad ─────────────────────────────────────────────
 * `BarraFlotante` y `FilterBar` **tienen que coincidir**: si los cortes
 * divergen queda una franja donde se ven las dos cosas, o ninguna. Estaban
 * sincronizados a mano, cada uno con su copia del literal — o sea sincronizados
 * hasta que alguien tocara uno. Ahora es este hook o nada.
 */
const CONSULTA = '(max-width: 719px), (hover: none) and (max-height: 500px)';

export function useLayoutCompacto() {
    return useMediaQuery(CONSULTA);
}

/**
 * ¿El diálogo tiene que entrar de COSTADO en vez de desde abajo?
 *
 * Acostado, una hoja inferior es la forma equivocada y se puede medir: en un
 * iPhone 13 (844 × 390) la hoja de filtros ocupaba el **63% del alto** —247 de
 * 390px— y usaba **150 de sus 844px de ancho**. O sea que tapaba casi toda la
 * pantalla para mostrar dos controles en una columna, con 694px de vacío al
 * lado. El alto es el recurso escaso acostado, y la hoja inferior gasta
 * justamente ese.
 *
 * Un panel lateral usa el alto COMPLETO (390 contra 247), deja la lista entera
 * visible en la otra mitad —así se la ve filtrarse mientras se elige— y no
 * obliga a ningún modal a rediseñar su cuerpo: el contenido apilado de vertical
 * entra tal cual.
 *
 * La condición es la misma que la de arriba menos el ancho: dedo **y** poca
 * altura. `(max-height: 500px)` sin `(hover: none)` atraparía una ventana de
 * escritorio achatada, que tiene mouse y todo el ancho del mundo.
 */
const LATERAL = '(hover: none) and (max-height: 500px)';

export function usePanelLateral() {
    return useMediaQuery(LATERAL);
}

export default useLayoutCompacto;
