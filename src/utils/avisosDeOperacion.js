/* Los datos de tres tarjetas de la campana que nacieron el mismo día
 * (usuario, 23-sep: «rediseñalas para que sean modernas»):
 *
 *  · CORTE_NUEVO          — el corte de caja que hay que confirmar.
 *  · BITACORA_POR_VENCER  — la franja de la bitácora que está por cerrarse.
 *  · TRASLADO_RESPALDO    — los traslados que otra sala despachó por ésta.
 *
 * Mismo contrato que `datosDeAperturasDeLaManana` y compañía: leen el
 * `metadata` del aviso y devuelven `null` en cuanto falta lo mínimo, para que
 * la campana vuelva sola a su fila de texto en vez de dibujar una tarjeta a
 * medias. Un aviso escrito antes de que su metadata trajera estos datos cae ahí.
 */

const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/* ── El corte de caja ─────────────────────────────────────────────────────
 * `tramo` es la diferencia del corte que el aviso anunció. `null` NO es cero:
 * es que el corte salió sin contar el efectivo — por eso se mira si la CLAVE
 * existe, y un aviso viejo sin la clave no dibuja tarjeta. */
export function datosDeCorteNuevo(n) {
    if (n?.type !== 'CORTE_NUEVO') return null;
    const m = n.metadata || {};
    if (!('tramo' in m)) return null;

    const tramo = num(m.tramo);
    const estado = tramo == null ? 'sin_conteo'
        : tramo <= -0.01 ? 'falta'
        : tramo >= 0.01 ? 'sobra'
        : 'cuadra';

    return {
        estado,
        tramo,
        hora: m.hora ? String(m.hora) : null,
        // El cuerpo empieza siempre con «Sala — …».
        sala: m.sala ? String(m.sala) : (/^(.+?) — /.exec(String(n.body || ''))?.[1] ?? null),
    };
}

/* ── La bitácora por cerrarse ─────────────────────────────────────────────
 * El reloj se calcula al DIBUJAR, contra `fecha` + `cierra` en hora de El
 * Salvador, y no con los `minutos` que traía el aviso: abierto una hora más
 * tarde, «quedan 29 minutos» sería mentira. */
export const VENTANA_BITACORA_MIN = 45;   // la misma de `avisar-bitacora-por-vencer`

export function datosDeBitacoraPorVencer(n, ahora = Date.now()) {
    if (n?.type !== 'BITACORA_POR_VENCER') return null;
    const m = n.metadata || {};
    const pendientes = num(m.pendientes);
    if (!m.fecha || !/^\d{2}:\d{2}$/.test(String(m.cierra || '')) || pendientes == null) return null;

    // El Salvador no cambia de hora: UTC−6 todo el año.
    const cierre = Date.parse(`${m.fecha}T${m.cierra}:00-06:00`);
    if (!Number.isFinite(cierre)) return null;
    const quedan = Math.floor((cierre - ahora) / 60000);

    const areas = Array.isArray(m.areas)
        ? m.areas.map(String).filter(Boolean)
        : (/ en (.+?)\. Quedan/.exec(String(n.body || ''))?.[1]?.split(', ').filter(Boolean) ?? []);

    return {
        cierra: String(m.cierra),
        pendientes,
        lecturas: num(m.lecturas),
        limpiezas: num(m.limpiezas),
        areas,
        quedan: Math.max(quedan, 0),
        cerrada: quedan <= 0,
    };
}

/* ── Los traslados por respaldo ───────────────────────────────────────────── */
export function datosDeTrasladosPorRespaldo(n) {
    if (n?.type !== 'TRASLADO_RESPALDO') return null;
    const m = n.metadata || {};
    const lista = (Array.isArray(m.traslados) ? m.traslados : [])
        .filter((t) => t && t.destino)
        .map((t) => ({
            id: t.id ?? null,
            destino: String(t.destino),
            producto: t.producto ? String(t.producto) : null,
            mas: num(t.mas) ?? 0,
            unidades: num(t.unidades),
            quien: t.quien ? String(t.quien) : null,
            quienId: t.quien_id || null,
            hora: t.hora || null,
        }));
    if (!lista.length) return null;

    return {
        traslados: lista,
        unidades: num(m.unidades) ?? lista.reduce((s, t) => s + (t.unidades || 0), 0),
    };
}
