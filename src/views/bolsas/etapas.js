import { Banknote, Package, Send, ShieldCheck } from 'lucide-react';

/* ── Las cuatro etapas, en el orden en que pasan las cosas ──────────────────
 *
 * Vive en su propio archivo porque la leen los DOS lados: `BolsasView` para
 * dibujar las pestañas y `CircuitoDeBolsas` para saber qué cuerpo pintar. La
 * lista tiene que ser UNA — con dos copias, agregar una etapa al circuito
 * dejaría una pestaña sin contenido o un contenido sin pestaña, y las dos
 * fallan en silencio.
 *
 * Y va aparte del motor y no adentro por una razón mecánica: un archivo que
 * exporta componentes **y** constantes rompe el refresco en caliente de Vite
 * (`react-refresh/only-export-components`), o sea que tocar la lista obligaría
 * a recargar la pantalla entera en desarrollo.
 *
 * `estado` es el valor de la columna, y por eso está acá y no en la vista: es
 * la traducción entre lo que dice la base y lo que lee quien mueve el dinero.
 * «ABIERTA» no significa nada para quien tiene la bolsa en la mano.
 *
 * `soloAdmin` marca las tres que exigen alcance ALL. La sala ve una sola etapa
 * —la suya— y con una sola pestaña `ViewTabBar` no dibuja ninguna: no hay entre
 * qué elegir, que es exactamente la regla de §14.
 */
export const ETAPAS = [
    { key: 'sala',        label: 'En la sala',          icon: Package,     estado: 'ABIERTA'   },
    { key: 'camino',      label: 'Esperando recepción', icon: Send,        estado: 'ENTREGADA', soloAdmin: true },
    { key: 'contar',      label: 'Por contar',          icon: Banknote,    estado: 'RECIBIDA',  soloAdmin: true },
    { key: 'finalizadas', label: 'Finalizadas',         icon: ShieldCheck, estado: 'CONTADA',   soloAdmin: true },
];

/* ── El rango de días que cubre una tanda, dicho corto ──────────────────────
 *
 * Vive acá y no en `ConteosDeBolsas` porque lo leen los DOS lados —la tabla de
 * conteos y la ranura de la píldora, que la arma `CircuitoDeBolsas`— y ese
 * componente se carga en diferido: importarlo desde el motor para sacar una
 * función de tres líneas rompería el corte del bundle.
 *
 * Un solo día se dice «17 ago» y no «17 ago → 17 ago», que sería decir dos
 * veces lo mismo.
 */
export const rangoDeDias = (desde, hasta) => {
    if (!desde) return '—';
    const corto = (f) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV',
        { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return desde === hasta ? corto(desde) : `${corto(desde)} → ${corto(hasta)}`;
};
