// Portal Farmalasa — Version control
// Maintainer: Edwin Nunez
// Format: MAJOR.MINOR.PATCH
// - MAJOR: breaking redesigns / architecture changes
// - MINOR: new features / modules
// - PATCH: fixes, tweaks, visual adjustments
//
// ─────────────────────────────────────────────────────────────────────────────
// ACÁ NO VA EL CHANGELOG. La entrada de cada versión se escribe en
// `CHANGELOG.md`, en la raíz. Lo vigila `npm run gate:version`.
//
// Ya se intentó una vez: el 2026-07-28 este archivo pesaba 805 KB y se movió el
// histórico a CHANGELOG.md dejando "las últimas 6 entradas acá, que es lo que
// uno mira al retomar". Nada verificaba esa regla, así que **164 de las 268
// entradas que se escribieron después nunca llegaron a CHANGELOG.md** y el
// archivo volvió a 7,330 líneas — el mismo problema, reconstruido en tres
// semanas.
//
// El motivo de fondo para sacarlo es otro y es peor que el peso: con 2-3
// sesiones de trabajo sobre el mismo árbol, TODAS escriben en el mismo bloque
// de 30 líneas al tope de este archivo, así que colisionan siempre. Medido el
// 2026-08-01 en una sola sesión: la versión se me adelantó tres veces y una vez
// tuve que dejar este archivo fuera de mi commit —esperando a que otra sesión
// commiteara— porque staged se llevaba su entrada de changelog. Con una sola
// línea acá, la colisión es de una línea y se resuelve sola.
// ─────────────────────────────────────────────────────────────────────────────

export const APP_VERSION = '2.949.0';
