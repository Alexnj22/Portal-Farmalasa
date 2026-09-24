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
        ventasMeses: leerMeses(m.ventas_meses),
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

/* ── Pedidos (24-sep): seguimiento, llegada del conductor y problemas ─────
 * Los avisos de pedido los escribe el NAVEGADOR (`notifyBranch`), no la base,
 * así que el metadata se arma acá con una sola forma para los seis sitios que
 * avisan. `etapa` ubica el aviso en el recorrido del pedido. */
export const ETAPAS_DE_PEDIDO = ['preparacion', 'en_camino', 'llego', 'recibido'];

export function metaDePedido({ numeros = [], sala = null, etapa, cajas = null, conductor = null,
    conductorId = null, detalle = null } = {}) {
    return {
        pedido: {
            numeros: (numeros ?? []).filter((x) => x != null).map(String),
            sala, etapa, cajas, conductor, conductor_id: conductorId, detalle,
        },
    };
}

export function datosDePedido(n) {
    if (!['PEDIDO_TRACKING', 'PEDIDO_LLEGADA', 'PEDIDO_PROBLEMA', 'PEDIDO_REENVIO'].includes(n?.type)) return null;
    const p = n.metadata?.pedido;
    if (!p || !p.etapa) return null;
    return {
        numeros: Array.isArray(p.numeros) ? p.numeros.map(String) : [],
        // Si el título ya nombra todos los números, la tarjeta no los repite.
        numerosEnTitulo: Array.isArray(p.numeros) && p.numeros.length > 0
            && p.numeros.every((x) => String(n.title || '').includes(`#${x}`)),
        sala: p.sala ? String(p.sala) : null,
        etapa: String(p.etapa),
        cajas: num(p.cajas),
        conductor: p.conductor ? String(p.conductor) : null,
        conductorId: p.conductor_id || null,
        detalle: p.detalle ? String(p.detalle) : null,
    };
}

/* ── Solicitudes pendientes (24-sep) ──────────────────────────────────────
 * `metadata.solicitud` lo arma `notificar_solicitud_creada` con la misma forma
 * para todos los tipos. Un aviso anterior no lo trae y queda como texto. */
/* Las ventas mes a mes que manda `ventas_por_mes_de_producto`: MIN·MAX y los
 * productos de un traslado las leen igual. */
function leerMeses(v) {
    return (Array.isArray(v) ? v : [])
        .filter((x) => x && /^\d{4}-\d{2}$/.test(String(x.ym)))
        .map((x) => ({ ym: String(x.ym), unidades: num(x.unidades) ?? 0 }));
}

export function datosDeSolicitud(n) {
    if (n?.type !== 'REQUEST_PENDING') return null;
    const s = n.metadata?.solicitud;
    if (!s || !s.tipo) return null;
    return {
        tipo: String(s.tipo),
        etiqueta: s.etiqueta ? String(s.etiqueta) : null,
        quien: s.quien ? String(s.quien) : null,
        quienId: s.quien_id || null,
        quienFoto: s.quien_foto || null,
        sala: s.sala ? String(s.sala) : null,
        origen: s.origen ? String(s.origen) : null,
        doc: s.doc ? String(s.doc) : null,
        // El número de la factura viaja en el metadata pero no se muestra: «no
        // es relevante en esa vista» (usuario, 24-sep). Sí la fecha, el pago y
        // el cliente.
        fecha: s.fecha || null,
        pago: s.pago ? String(s.pago) : null,
        monto: num(s.monto),
        antes: s.antes != null ? String(s.antes) : null,
        despues: s.despues != null ? String(s.despues) : null,
        cliente: s.cliente ? String(s.cliente) : null,
        productos: (Array.isArray(s.productos) ? s.productos : [])
            .filter((p) => p && p.nombre)
            .map((p) => ({
                nombre: String(p.nombre),
                cantidad: num(p.cantidad),
                // En un traslado: cuántas tiene la sala a la que se lo piden.
                existencia: num(p.existencia),
            })),
        mas: num(s.mas) ?? 0,
        unidades: num(s.unidades),
        subtipo: s.subtipo ? String(s.subtipo) : null,
        creditos: num(s.creditos),
        desde: s.desde || null,
        hasta: s.hasta || null,
        motivo: s.motivo ? String(s.motivo) : null,
    };
}

/* ── Séptima tanda (24-sep): respuestas, decisiones y diferencias ─────────
 * Los tres devuelven null si el aviso no trae su bloque: un aviso viejo sigue
 * saliendo como texto. */

/** La respuesta a un traslado pedido, o a un envío (`REQUEST_RESOLVED`). */
export function datosDeRespuesta(n) {
    if (n?.type !== 'REQUEST_RESOLVED') return null;
    const r = n.metadata?.respuesta;
    if (!r || !r.tipo || !r.estado) return null;
    const lista = (v) => (Array.isArray(v) ? v : []).filter((p) => p && p.nombre);
    return {
        tipo: String(r.tipo),
        estado: String(r.estado),
        quien: r.quien ? String(r.quien) : null,
        quienId: r.quien_id || null,
        quienFoto: r.quien_foto || null,
        origen: r.origen ? String(r.origen) : null,
        sala: r.sala ? String(r.sala) : null,
        productos: lista(r.productos).map((p) => ({
            nombre: String(p.nombre), pedida: num(p.pedida), enviada: num(p.enviada),
        })),
        mas: num(r.mas) ?? 0,
        motivo: r.motivo ? String(r.motivo) : null,
        nota: r.nota ? String(r.nota) : null,
        alternativa: r.alternativa ? String(r.alternativa) : null,
        aceptados: num(r.aceptados),
        devueltos: lista(r.devueltos).map((p) => ({ nombre: String(p.nombre), motivo: p.motivo ? String(p.motivo) : null })),
        noLlegaron: num(r.no_llegaron),
    };
}

/** Lo que decidieron sobre MI solicitud (`REQUEST_DECIDED`, `MINMAX_DECIDED`). */
export function datosDeDecision(n) {
    if (n?.type !== 'REQUEST_DECIDED' && n?.type !== 'MINMAX_DECIDED') return null;
    const d = n.metadata?.decision;
    if (!d || !d.estado) return null;
    return {
        tipo: d.tipo ? String(d.tipo) : null,
        etiqueta: d.etiqueta ? String(d.etiqueta) : null,
        aprobada: d.estado === 'APPROVED',
        quien: d.quien ? String(d.quien) : null,
        quienId: d.quien_id || null,
        quienFoto: d.quien_foto || null,
        sala: d.sala ? String(d.sala) : null,
        fecha: d.fecha || null,
        hora: d.hora || null,
        monto: num(d.monto),
        doc: d.doc ? String(d.doc) : null,
        pago: d.pago ? String(d.pago) : null,
        cliente: d.cliente ? String(d.cliente) : null,
        antes: d.antes != null ? String(d.antes) : null,
        despues: d.despues != null ? String(d.despues) : null,
        producto: d.producto ? String(d.producto) : null,
        min: num(d.min),
        max: num(d.max),
        productos: (Array.isArray(d.productos) ? d.productos : []).filter((p) => p && p.nombre)
            .map((p) => ({ nombre: String(p.nombre), cantidad: num(p.cantidad) })),
        mas: num(d.mas) ?? 0,
        desde: d.desde || null,
        hasta: d.hasta || null,
        nota: d.nota ? String(d.nota) : null,
        instruccion: d.instruccion ? String(d.instruccion) : null,
    };
}

/** Una diferencia de un pedido, en el paso en que está (`PEDIDO_DIFERENCIA`). */
export function datosDeDiferencia(n) {
    if (n?.type !== 'PEDIDO_DIFERENCIA') return null;
    const d = n.metadata?.diferencia;
    if (!d || !d.estado) return null;
    return {
        producto: d.producto ? String(d.producto) : null,
        sala: d.sala ? String(d.sala) : null,
        estado: String(d.estado),
        que: d.que ? String(d.que) : null,
        enviada: num(d.enviada),
        recibida: num(d.recibida),
        problema: num(d.problema),
        salida: d.salida ? String(d.salida) : null,
        // Si se arregla con un traslado o en físico, y qué significa para el
        // lado de quien lee (24-sep: «¿se refiere al sistema?»).
        corto: d.corto ? String(d.corto) : null,
        ayuda: d.ayuda ? String(d.ayuda) : null,
        valor: d.valor ? String(d.valor) : null,
        opciones: (Array.isArray(d.opciones) ? d.opciones : []).filter((o) => o && o.valor)
            .map((o) => ({ valor: String(o.valor), rotulo: String(o.rotulo ?? o.valor), corto: String(o.corto ?? o.rotulo ?? o.valor) })),
        itemId: d.item_id ?? null,
        lado: d.lado ? String(d.lado) : null,
        nota: d.nota ? String(d.nota) : null,
        quien: d.quien ? String(d.quien) : null,
        quienId: d.quien_id || null,
        quienFoto: d.quien_foto || null,
    };
}

/** ¿Me toca contestar esta diferencia? Los mismos turnos que `turnoDe` en
 *  `utils/decisionDiferencia.js`; la base lo vuelve a comprobar. */
export const diferenciaMeToca = (d) => Boolean(d?.itemId) && (
    (d.estado === 'propuesta'       && (d.lado === 'bodega' || d.lado === 'supervision'))
    || (d.estado === 'contrapropuesta' && (d.lado === 'sala' || d.lado === 'supervision'))
    || (d.estado === 'escalada'        && d.lado === 'supervision'));

/* ── Octava tanda (24-sep): conteo cíclico, Hacienda y promociones ──────── */

/** El conteo cíclico del mes, listo para contarse (`CONTEO_CICLICO`). */
export function datosDeConteo(n) {
    if (n?.type !== 'CONTEO_CICLICO') return null;
    const m = n.metadata || {};
    const comp = m.composicion && typeof m.composicion === 'object' ? m.composicion : null;
    if (!comp) return null;
    const ORDEN = ['A', 'B', 'C', 'BAJO_RECETA'];
    const lugar = (k) => (ORDEN.includes(k) ? ORDEN.indexOf(k) : ORDEN.length);
    const grupos = Object.entries(comp)
        .map(([k, v]) => ({ clave: k, n: num(v) ?? 0 }))
        .filter((g) => g.n > 0)
        .sort((a, b) => lugar(a.clave) - lugar(b.clave));
    return {
        sala: m.sala ? String(m.sala) : null,
        productos: num(m.productos) ?? grupos.reduce((s, g) => s + g.n, 0),
        grupos,
    };
}

/* Lo que dice Hacienda, en palabras del portal. El original trae la ruta del
 * campo en el JSON («#/receptor/nrc») y a veces viene en inglés. */
const CAMPO_DE_HACIENDA = {
    nrc: 'NRC', nit: 'NIT', numDocumento: 'Documento', tipoDocumento: 'Tipo de documento',
    telefono: 'Teléfono', correo: 'Correo', direccion: 'Dirección', nombre: 'Nombre',
    departamento: 'Departamento', municipio: 'Municipio', distrito: 'Distrito', codActividad: 'Actividad',
    subTotal: 'Subtotal', montoTotalOperacion: 'Total', totalPagar: 'Total a pagar',
};
const DE_QUIEN = { receptor: 'del cliente', emisor: 'de la sala', resumen: 'en los totales', cuerpoDocumento: 'en los productos' };
export function motivoDeHacienda(texto) {
    const t = String(texto ?? '').trim();
    if (!t) return null;
    if (/multiple of 0\.01/i.test(t)) return 'Un monto tiene más de dos decimales.';
    const m = /#\/(\w+)(?:\/\d+)?\/(\w+)\s*:?\s*(.*)$/.exec(t);
    if (!m) return t.replace(/^Campo\s+/i, '');
    const campo = CAMPO_DE_HACIENDA[m[2]] ?? m[2];
    const quien = DE_QUIEN[m[1]] ? ` ${DE_QUIEN[m[1]]}` : '';
    const resto = m[3].replace(/\s+/g, ' ').trim();
    return `${campo}${quien}${resto ? `: ${resto}` : ''}${/[.!?]$/.test(resto) ? '' : '.'}`;
}

/** El envío nocturno a Hacienda que no salió bien (`SYSTEM` de regularizar-dte). */
export function datosDeHacienda(n) {
    if (n?.type !== 'SYSTEM') return null;
    const h = n.metadata?.hacienda;
    if (!h) return null;
    return {
        corrio: h.corrio !== false,
        fallidas: num(h.fallidas) ?? 0,
        resueltas: num(h.resueltas) ?? 0,
        restantes: num(h.restantes) ?? 0,
        esperando: num(h.esperando),
        facturas: (Array.isArray(h.facturas) ? h.facturas : []).filter(Boolean).map((f) => ({
            sala: f.sala ? String(f.sala) : null,
            doc: f.doc ? String(f.doc) : null,
            fecha: f.fecha || null,
            cliente: f.cliente ? String(f.cliente) : null,
            monto: num(f.monto),
            motivo: motivoDeHacienda(f.motivo),
        })),
    };
}

/** Una promoción: terminó, se acaba el lote de una sala, o cerró su mes. */
export function datosDePromo(n) {
    if (n?.type !== 'PROMO_CERRADA' && n?.type !== 'PROMO_LOTE_BAJO') return null;
    const p = n.metadata?.promo;
    if (!p || !p.tipo) return null;
    return {
        tipo: String(p.tipo),
        nombre: p.nombre ? String(p.nombre) : null,
        motivo: p.motivo ? String(p.motivo) : null,
        fin: p.fin || null,
        producto: p.producto ? String(p.producto) : null,
        sala: p.sala ? String(p.sala) : null,
        vendido: num(p.vendido),
        asignado: num(p.asignado),
        donde: p.donde ? String(p.donde) : null,
        mes: p.mes ? String(p.mes) : null,
        costo: num(p.costo),
        salas: (Array.isArray(p.salas) ? p.salas : []).filter((s) => s && s.sala).map((s) => ({
            sala: String(s.sala), nivel: s.nivel != null ? String(s.nivel) : null,
            venta: num(s.venta), costo: num(s.costo),
        })),
    };
}
