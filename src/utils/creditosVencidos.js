/* «Créditos que se pasaron del mes», para la tarjeta del aviso.
 *
 * Gemelo de `datosDeAperturasDeLaManana` y `datosDeFaltanteDeCaja`: lee el
 * `metadata` del aviso y devuelve `null` en cuanto falta lo mínimo, para que la
 * campana vuelva sola a su fila de texto en vez de dibujar una tarjeta a medias.
 *
 * El mismo tipo `CREDITO_VENCIDO` llega en DOS formas, y las dos las escribe
 * `avisar-creditos-vencidos`:
 *  · el de UNA sala (jefatura y quien vendió): `creditos`, `total`, `dias`.
 *  · el RESUMEN de supervisión: además `salas: [{ sala, creditos, total, dias }]`.
 * Se distinguen por la lista y no por un campo aparte: si trae salas, es el
 * resumen.
 */

/* A partir de cuántos días el más viejo se pinta en rojo y no en naranja. El
 * plazo es 30; dos meses encima es una deuda que ya no se cobra sola. */
export const DIAS_EN_ROJO = 60;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export function datosDeCreditosVencidos(n) {
    if (n?.type !== 'CREDITO_VENCIDO') return null;
    const m = n.metadata || {};

    const total = num(m.total);
    const creditos = num(m.creditos);
    // Sin monto ni cuántos no hay nada que dibujar que el título no diga ya.
    if (total == null || creditos == null) return null;

    const salas = (Array.isArray(m.salas) ? m.salas : [])
        .filter((s) => s && s.sala && num(s.total) != null)
        .map((s) => ({
            branchId: s.branch_id ?? null,
            sala: String(s.sala),
            creditos: num(s.creditos) ?? 0,
            total: num(s.total),
            dias: num(s.dias),
        }))
        .sort((a, b) => b.total - a.total);

    // El nombre de la sala en los avisos escritos antes de que viajara en el
    // metadata: el cuerpo empieza siempre con «Sala: …».
    const sala = m.sala
        ? String(m.sala)
        : (/^([^:]+):/.exec(String(n.body || ''))?.[1] ?? null);

    const diasDe = salas.map((s) => s.dias).filter((d) => d != null);
    return {
        resumen: salas.length > 0,
        total,
        creditos,
        sala,
        dias: num(m.dias) ?? (diasDe.length ? Math.max(...diasDe) : null),
        salas,
        // El tope de las barras: la sala que más debe llena la suya.
        tope: salas.reduce((t, s) => Math.max(t, s.total), 0),
    };
}
