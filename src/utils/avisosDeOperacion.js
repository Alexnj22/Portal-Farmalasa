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
        quien: m.quien ? String(m.quien) : null,
        quienId: m.quien_id || null,
        quienFoto: m.quien_foto || null,
        contado: num(m.contado),
        ventas: num(m.ventas),
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
        detalle: (Array.isArray(m.detalle) ? m.detalle : [])
            .filter((d) => d && d.area)
            .map((d) => ({ area: String(d.area), tipo: d.tipo === 'limpieza' ? 'limpieza' : 'lectura',
                desde: d.desde || null, hasta: d.hasta || null })),
        quedan: Math.max(quedan, 0),
        cerrada: quedan <= 0,
    };
}

/* ── Los traslados por respaldo ───────────────────────────────────────────── */
/* Cuántos renglones se ven antes de «Ver los N traslados». */
export const TRASLADOS_VISIBLES = 3;

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
            quienFoto: t.quien_foto || null,
            hora: t.hora || null,
        }));
    if (!lista.length) return null;
    // En el orden en que salieron.
    lista.sort((a, b) => (Date.parse(a.hora) || 0) - (Date.parse(b.hora) || 0));

    return {
        traslados: lista,
        unidades: num(m.unidades) ?? lista.reduce((s, t) => s + (t.unidades || 0), 0),
    };
}

/* ── Segunda tanda (23-sep): MIN·MAX, bolsa que no cuadró y depósito ───────
 * Mismo contrato: `null` si el aviso es anterior a que su metadata trajera lo
 * que la tarjeta dibuja. */

export function datosDeMinmaxPendiente(n) {
    if (n?.type !== 'MINMAX_PENDING') return null;
    const m = n.metadata || {};
    if (!('min_nuevo' in m) || !('max_nuevo' in m)) return null;
    return {
        producto: m.producto ? String(m.producto) : null,
        quien: m.quien ? String(m.quien) : null,
        quienId: m.quien_id || null,
        quienFoto: m.quien_foto || null,
        ventasMeses: (Array.isArray(m.ventas_meses) ? m.ventas_meses : [])
            .filter((v) => v && /^\d{4}-\d{2}$/.test(String(v.ym)))
            .map((v) => ({ ym: String(v.ym), unidades: num(v.unidades) ?? 0 })),
        ventasMesCurso: num(m.ventas_mes_curso),
        existencia: num(m.existencia),
        minHoy: num(m.min_hoy),
        maxHoy: num(m.max_hoy),
        minNuevo: num(m.min_nuevo),
        maxNuevo: num(m.max_nuevo),
        motivo: m.motivo ? String(m.motivo) : null,
    };
}

export function datosDeBolsaNoCuadra(n) {
    if (n?.type !== 'bolsa_no_cuadra') return null;
    const m = n.metadata || {};
    const lista = (Array.isArray(m.lista) ? m.lista : [])
        .filter((b) => b && b.folio && num(b.dif) != null)
        .map((b) => ({ folio: String(b.folio), dif: num(b.dif), fecha: b.fecha || null, hora: b.hora || null }));
    if (!lista.length) return null;
    return {
        lista,
        neto: num(m.neto) ?? lista.reduce((s, b) => s + b.dif, 0),
        confirmo: m.confirmo ? String(m.confirmo) : null,
        confirmoId: m.confirmo_id || null,
        confirmoFoto: m.confirmo_foto || null,
    };
}

export function datosDeDeposito(n) {
    if (n?.type !== 'DEPOSITO_BANCO') return null;
    const m = n.metadata || {};
    if (!('quien' in m)) return null;
    return {
        destino: m.destino ? String(m.destino) : 'BANCO',
        banco: m.banco ? String(m.banco) : null,
        entregadoA: m.entregado_a ? String(m.entregado_a) : null,
        bolsas: num(m.bolsas),
        remanente: num(m.remanente) ?? 0,
        quien: m.quien ? String(m.quien) : null,
        quienId: m.quien_id || null,
        quienLleva: m.quien_lleva === true,
        quienFoto: m.quien_foto || null,
        montoBanco: num(m.monto_banco) ?? 0,
        montoEfectivo: num(m.monto_efectivo) ?? 0,
        desde: m.desde || null,
        hasta: m.hasta || null,
    };
}

/* ── Tercera tanda (24-sep): alerta de CCF, factura de sala y cortes sin
 * confirmar ─────────────────────────────────────────────────────────────── */

export function datosDeAlertaDeVentas(n) {
    if (n?.type !== 'SALES_ALERT') return null;
    const m = n.metadata || {};
    if (!m.numero) return null;
    return {
        tipo: String(m.tipo || m.alert_type || ''),
        numero: String(m.numero),
        seguidas: num(m.seguidas),
        problemas: Array.isArray(m.problemas) ? m.problemas.map(String) : [],
        cliente: m.cliente ? String(m.cliente) : null,
        total: num(m.total),
        hora: m.hora || null,
        fecha: m.fecha || null,
        vendedor: m.vendedor ? String(m.vendedor) : null,
        vendedorId: m.vendedor_id || null,
        vendedorFoto: m.vendedor_foto || null,
        urgente: m.urgent === true,
    };
}

export function datosDeFacturaDeSala(n) {
    if (n?.type !== 'FACTURA_SALA') return null;
    const m = n.metadata || {};
    const lista = (Array.isArray(m.lista) ? m.lista : [])
        .filter((f) => f && f.etiqueta)
        .map((f) => ({ etiqueta: String(f.etiqueta), monto: num(f.monto), fecha: f.fecha || null }));
    if (!lista.length) return null;
    return { lista, total: num(m.total) ?? lista.reduce((s, f) => s + (f.monto || 0), 0) };
}

export function datosDeCortesPendientes(n) {
    if (n?.type !== 'CORTE_PENDIENTE') return null;
    const m = n.metadata || {};
    const lista = (Array.isArray(m.lista) ? m.lista : [])
        .filter((c) => c && c.id)
        .map((c) => ({
            id: c.id, fecha: c.fecha || null, hora: c.hora || null,
            quien: c.quien ? String(c.quien) : null, quienId: c.quien_id || null, quienFoto: c.quien_foto || null,
            tramo: 'tramo' in c ? num(c.tramo) : null,
            sinConteo: c.tramo === null || c.tramo === undefined,
        }));
    if (!lista.length) return null;
    return { lista };
}
