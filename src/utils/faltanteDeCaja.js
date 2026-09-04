/* Lo que la campana necesita saber del aviso de «ayer la caja cerró con
 * faltante» para dibujar una TARJETA en vez de una fila de texto.
 *
 * Es el gemelo de `datosDeCierreDelDia` (`cierreDeMeta.js`) y sigue su misma
 * regla: si falta lo mínimo para dibujar, devuelve `null` y la campana vuelve
 * sola a la fila de siempre. Un aviso a medias pintado es peor que uno en
 * prosa — la prosa al menos se entiende entera.
 *
 * Vive en su propio archivo y no en `cierreDeMeta.js` porque no es del mismo
 * asunto: aquéllos cuentan cómo cerró un período contra su meta, y éste cuenta
 * que falta dinero en un cajón. Compartir archivo por compartir forma es cómo
 * se termina con un módulo que no se puede nombrar.
 */

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export function datosDeFaltanteDeCaja(n) {
    if (n?.type !== 'CORTE_DIFERENCIA_AYER') return null;
    const m = n.metadata || {};

    /* La diferencia es lo ÚNICO obligatorio: es la noticia. Sin ella no hay
     * tarjeta. Los avisos que salieron antes de que la función mandara
     * `contado`/`esperado` (2026-09-04) siguen dibujándose — con el monto y la
     * sala, sin la barra— en vez de romperse o volver a texto: una campana con
     * historial de 90 días guarda avisos escritos por versiones anteriores, y
     * eso no es un caso raro sino el caso normal. */
    const diferencia = num(m.diferencia);
    if (diferencia == null || diferencia >= 0) return null;

    const contado  = num(m.contado);
    const esperado = num(m.esperado);
    /* Lo que el día ya cargaba antes de este corte, y de dónde salió — los
     * mismos dos datos que la tarjeta del corte muestra desde v2.983.1.
     *
     * Importa para el aviso porque desde que el criterio sigue a la tarjeta
     * (2026-09-04) el número del título es el TRAMO, y un tramo negativo con
     * arrastre positivo describe un corte que contó exacto: lo que falta es el
     * sobrante de más temprano, que ya no está. Sin esta línea, «faltan $0.45»
     * sobre un conteo exacto no se puede entender. */
    const arrastre = num(m.arrastre) ?? 0;
    const aportes  = num(m.aportes);

    return {
        falta: Math.abs(diferencia),
        sala: String(m.sala || ''),
        hora: String(m.hora || ''),
        corteId: m.corte_id ?? null,
        contado,
        esperado,
        arrastre,
        arrastreDesde: m.arrastre_desde ? String(m.arrastre_desde) : null,
        aportes: aportes == null ? null : aportes,
        /* Qué tan grande es el faltante DENTRO de lo que había que contar. Es la
         * pieza que convierte «faltan $9.85» en algo que se puede juzgar de un
         * vistazo: sobre $319 es un descuadre y sobre $3,190 es redondeo.
         *
         * Se calcula acá y no en la base para que un aviso viejo —sin
         * `esperado`— simplemente no la tenga, en vez de obligar a reescribir
         * los que ya se mandaron. */
        proporcion: esperado != null && esperado > 0
            ? Math.abs(diferencia) / esperado
            : null,
    };
}
