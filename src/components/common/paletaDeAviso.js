/* La paleta de la tarjeta de un aviso, para los dos sitios que la dibujan.
 *
 * Vivía dentro de `NotificationBell` como una constante `cx` calculada en el
 * render. Desde que la vista `/notificaciones` dibuja la MISMA tarjeta
 * (2026-09-04) tiene que salir de un solo lugar: copiada, la copia sería la que
 * se queda vieja y lo que divergiría es cómo se ve un aviso sin leer.
 *
 * En un `.js` y no en el `.jsx` de la tarjeta: un archivo que exporta
 * componentes y funciones a la vez rompe el fast refresh de Vite.
 *
 * Es binaria por `isDark` y eso cubre los CUATRO temas: `isDark` ya es `true`
 * en `dark` y en `solid-dark` (ver `ThemeContext`).
 */
export const paletaDeAviso = (isDark) => (isDark ? {
    headerBorder: 'border-white/[0.07]',
    title: 'text-white/90',
    /* El realce va en un VELO absoluto sobre la tarjeta, no en la tarjeta:
       `[data-surface="card"]` fija su fondo desde `index.css`, que va sin
       `@layer` y le gana a cualquier utilidad de Tailwind — un `hover:bg-*` ahí
       no pinta nada (mismo motivo por el que existe `data-tono`). Y por eso es
       `group-hover`: el velo no recibe el puntero, lo recibe la tarjeta. */
    rowHover: 'group-hover:opacity-100',
    veloHover: 'bg-white/[0.06]',
    rowUnread: 'bg-chart-1/[0.07]',
    rowTitle: 'text-white/90', rowTitleRead: 'text-white/60',
    rowBody: 'text-white/50',
    rowTime: 'text-white/40',
    iconBtn: 'text-white/45 hover:text-white/90 hover:bg-surface-card',
    emptyIconBox: 'bg-white/[0.06] border-border-card text-white/40',
    emptyTitle: 'text-white/80', emptySub: 'text-white/45',
    chipMuted: 'text-white/40',
    undoStrip: 'bg-white/[0.05]',
    undoText: 'text-white/60',
    undoBtn: 'text-chart-1-text hover:bg-chart-1/10 border-chart-1/40',
} : {
    headerBorder: 'border-border-card/60',
    title: 'text-content',
    rowHover: 'group-hover:opacity-100',
    veloHover: 'bg-brand/[0.06]',
    rowUnread: 'bg-chart-1/10',
    rowTitle: 'text-content', rowTitleRead: 'text-content-2',
    rowBody: 'text-content-3',
    rowTime: 'text-content-3',
    iconBtn: 'text-content-3 hover:text-content-2 hover:bg-surface-card',
    emptyIconBox: 'bg-surface-card border-border-card text-brand-text/50',
    emptyTitle: 'text-content-2', emptySub: 'text-content-3',
    chipMuted: 'text-content-3',
    undoStrip: 'bg-surface-card-hover/80',
    undoText: 'text-content-2',
    undoBtn: 'text-brand-text hover:bg-chart-1/10 border-chart-1/30',
});
