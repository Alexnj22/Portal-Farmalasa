/* El resumen de la mañana de administración (2026-11-14).
 *
 * Los avisos que llegaban sueltos entre las 08:00 y las 08:40 —créditos
 * vencidos de la red, antibióticos sin conteo, la factura que no entró a
 * Hacienda, clientes con los puntos partidos, fichas sin número interno— los
 * junta `armar_resumen_manana()` en la base a las 08:45 en UN aviso de tipo
 * `RESUMEN_MANANA`. Cada tema viaja como renglón en `metadata.renglones`, con
 * su propio enlace: la tarjeta los pinta uno debajo del otro y cada uno lleva a
 * su pantalla.
 *
 * Devuelve `null` para cualquier otro aviso, o para uno sin renglones legibles,
 * y la tarjeta queda como siempre (título y cuerpo).
 */
export function datosDeResumenDeLaManana(n) {
    if (n?.type !== 'RESUMEN_MANANA') return null;
    const crudos = Array.isArray(n.metadata?.renglones) ? n.metadata.renglones : [];
    const renglones = crudos
        .filter((r) => r && typeof r.titulo === 'string' && r.titulo.trim())
        .map((r, i) => ({
            clave: r.tema || String(i),
            titulo: r.titulo,
            cuerpo: typeof r.cuerpo === 'string' && r.cuerpo.trim() ? r.cuerpo : null,
            link: typeof r.link === 'string' && r.link ? r.link : null,
        }));
    return renglones.length ? { renglones } : null;
}
