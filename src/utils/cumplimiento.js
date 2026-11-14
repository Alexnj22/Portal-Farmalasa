// Cumplimiento sanitario (2026-11-11, auditoría de sucursales).
//
// Qué pide cada registro. `TIPOS` es la gemela de `cumplimiento_requeridos`
// en la base (supabase/migrations/20261111152646_cumplimiento_sanitario_registros.sql):
// los campos `requerido` de acá son EXACTAMENTE los de allá — la base rechaza
// lo que falte, y la pantalla lo marca antes de mandar. Cambiar uno exige
// cambiar el otro (lo vigila tests/unit/cumplimiento.test.js contra el SQL).
//
// Fuentes de cada lista:
//   farmacovigilancia  Norma Técnica de Farmacovigilancia, Art. 18, 24.2, 28.2
//   reporte_cero       RTS 11.02.04:24 §6.3.6; Guía BPFV 4.6.11 (cada semestre)
//   vencido            RTS §6.6.7-6.6.8; Guía BPAD 6.1-6.3
//   destruccion        Instructivo SRS §6.2.4 (aviso 72 h antes, gestora MARN)
//   retiro             RTS §6.1.11, §6.6.4
//   autoinspeccion     RTS §5.15; Guía de verificación BPAD (secciones 1-3, 5, 6)
//   a_la_vista         Reglamento de la Ley de Medicamentos Art. 46; RTS §6.1.2, 6.2.3, 6.2.5, 6.3.5
//   capacitacion       RTS §6.3.2-6.3.4
//
// Puro: sin navegador, sin base.

export const GRAVEDADES = Object.freeze([
    { value: 'no_grave', label: 'No grave (30 días)' },
    { value: 'grave', label: 'Grave (15 días)' },
    { value: 'muerte', label: 'Mortal o pone en riesgo la vida (72 horas)' },
]);

export const FUENTES_DE_RETIRO = Object.freeze([
    { value: 'SRS', label: 'Superintendencia de Regulación Sanitaria' },
    { value: 'laboratorio', label: 'Laboratorio o titular' },
    { value: 'droguería', label: 'Droguería proveedora' },
    { value: 'interno', label: 'Decisión interna' },
]);

export const MOTIVOS_DE_BAJA = Object.freeze([
    { value: 'vencido', label: 'Vencido' },
    { value: 'deteriorado', label: 'Deteriorado o dañado' },
    { value: 'retirado', label: 'Retirado del mercado' },
    { value: 'devuelto', label: 'Devolución de cliente no apta' },
]);

/**
 * Los campos de cada tipo. `tipo` del campo: texto · area · fecha · numero ·
 * opciones · lista (texto separado por renglones, se guarda como arreglo).
 * `alCerrar`: se pide al cerrar el registro, no al crearlo.
 */
export const TIPOS = Object.freeze({
    farmacovigilancia: {
        titulo: 'Sospecha de reacción adversa',
        corto: 'Reacción adversa',
        campos: [
            { key: 'paciente', label: 'Paciente (iniciales y edad)', tipo: 'texto', requerido: true, ayuda: 'Iniciales, edad y sexo. No hace falta el nombre completo.' },
            { key: 'producto', label: 'Medicamento sospechoso', tipo: 'texto', requerido: true },
            { key: 'lote', label: 'Lote', tipo: 'texto' },
            { key: 'reaccion', label: 'Qué le pasó', tipo: 'area', requerido: true },
            { key: 'gravedad', label: 'Gravedad', tipo: 'opciones', opciones: GRAVEDADES, requerido: true },
            { key: 'detectada_el', label: 'Cuándo se supo', tipo: 'fecha', requerido: true },
            { key: 'notificador', label: 'Quién lo recibió', tipo: 'texto', requerido: true },
            { key: 'notificada_el', label: 'Fecha en que se notificó al CNFV', tipo: 'fecha', alCerrar: true, requerido: true },
            { key: 'folio_cnfv', label: 'Número o folio de la notificación', tipo: 'texto', alCerrar: true },
        ],
    },
    reporte_cero: {
        titulo: 'Reporte cero del semestre',
        corto: 'Reporte cero',
        campos: [
            { key: 'periodo', label: 'Semestre', tipo: 'semestre', requerido: true },
            { key: 'notas', label: 'Notas', tipo: 'area' },
        ],
    },
    vencido: {
        titulo: 'Producto dado de baja',
        corto: 'Baja',
        campos: [
            { key: 'producto', label: 'Producto', tipo: 'texto', requerido: true },
            { key: 'lote', label: 'Lote', tipo: 'texto', requerido: true },
            { key: 'vence', label: 'Vencimiento', tipo: 'texto', requerido: true, ayuda: 'Como viene en la caja (p. ej. 10/2026).' },
            { key: 'cantidad', label: 'Cantidad (unidades)', tipo: 'numero', requerido: true },
            { key: 'motivo', label: 'Motivo', tipo: 'opciones', opciones: MOTIVOS_DE_BAJA, requerido: true },
            { key: 'ubicacion', label: 'Dónde quedó separado', tipo: 'texto', ayuda: 'El área rotulada de productos no aptos.' },
        ],
    },
    destruccion: {
        titulo: 'Acta de destrucción',
        corto: 'Destrucción',
        campos: [
            { key: 'lugar', label: 'Lugar de la destrucción', tipo: 'texto', requerido: true },
            { key: 'gestora', label: 'Gestora autorizada', tipo: 'texto', requerido: true, ayuda: 'La empresa con autorización del MARN que se lleva los productos.' },
            { key: 'productos', label: 'Productos (uno por renglón: producto, lote, cantidad)', tipo: 'lista', requerido: true },
            { key: 'aviso_srs_el', label: 'Fecha del aviso a la SRS', tipo: 'fecha', ayuda: 'Se avisa 72 horas antes.' },
            { key: 'certificado', label: 'Número del certificado de destrucción', tipo: 'texto', alCerrar: true },
            { key: 'testigos', label: 'Testigos', tipo: 'texto', alCerrar: true },
        ],
    },
    retiro: {
        titulo: 'Retiro de lote',
        corto: 'Retiro',
        campos: [
            { key: 'alerta', label: 'Número de alerta o comunicado', tipo: 'texto', requerido: true },
            { key: 'fuente', label: 'Quién lo ordena', tipo: 'opciones', opciones: FUENTES_DE_RETIRO, requerido: true },
            { key: 'producto', label: 'Producto', tipo: 'texto', requerido: true },
            { key: 'lote', label: 'Lote', tipo: 'texto', requerido: true },
            { key: 'motivo', label: 'Motivo del retiro', tipo: 'area' },
            { key: 'existencia', label: 'Unidades que había en la sala', tipo: 'numero', alCerrar: true, requerido: true },
            { key: 'devuelto_a', label: 'A quién se devolvió', tipo: 'texto', alCerrar: true },
        ],
    },
    autoinspeccion: {
        titulo: 'Autoinspección',
        corto: 'Autoinspección',
        campos: [
            { key: 'guia', label: 'Guía', tipo: 'fijo', valor: 'BPAD' },
            { key: 'respuestas', label: 'Respuestas', tipo: 'checklist', requerido: true },
            { key: 'plan', label: 'Plan de acción', tipo: 'area' },
        ],
    },
    a_la_vista: {
        titulo: 'Revisión de lo que debe estar a la vista',
        corto: 'A la vista',
        campos: [
            { key: 'respuestas', label: 'Respuestas', tipo: 'checklist', requerido: true },
            { key: 'notas', label: 'Notas', tipo: 'area' },
        ],
    },
    capacitacion: {
        titulo: 'Capacitación',
        corto: 'Capacitación',
        campos: [
            { key: 'tema', label: 'Tema', tipo: 'texto', requerido: true },
            { key: 'facilitador', label: 'Quién la impartió', tipo: 'texto', requerido: true },
            { key: 'horas', label: 'Duración (horas)', tipo: 'numero' },
            { key: 'asistentes', label: 'Asistentes', tipo: 'personas', requerido: true },
            { key: 'evaluacion', label: 'Cómo se evaluó', tipo: 'texto', ayuda: 'Prueba escrita, práctica, preguntas…' },
        ],
    },
});

/** Los campos que se piden al crear (sin los de cierre). */
export const camposAlCrear = (tipo) => (TIPOS[tipo]?.campos || []).filter((c) => !c.alCerrar);
/** Los campos que se piden al cerrar. */
export const camposAlCerrar = (tipo) => (TIPOS[tipo]?.campos || []).filter((c) => c.alCerrar);

/** Las claves que la base exige al guardar (gemela de `cumplimiento_requeridos`). */
export const requeridosDe = (tipo) => camposAlCrear(tipo).filter((c) => c.requerido).map((c) => c.key);

const vacio = (v) => v === undefined || v === null || v === ''
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** Los rótulos de lo que falta para poder guardar. */
export function faltantes(tipo, datos, campos = camposAlCrear(tipo)) {
    return campos.filter((c) => c.requerido && vacio(datos?.[c.key])).map((c) => c.label);
}

// ── Listas de verificación ───────────────────────────────────────────────
// Peso de cada ítem como en la guía de la SRS: C crítico, M mayor, m menor.
// Una sala con un crítico que no cumple no aprueba, sin importar el resto.

export const AUTOINSPECCION = Object.freeze([
    {
        seccion: 'Organización y personal',
        items: [
            { id: 'p1', texto: 'Permiso de funcionamiento vigente y a la vista', peso: 'C' },
            { id: 'p2', texto: 'Regente con horario rotulado y cumpliendo sus horas', peso: 'C' },
            { id: 'p3', texto: 'Dependientes con acreditación vigente', peso: 'M' },
            { id: 'p4', texto: 'Programa anual de capacitación con registros', peso: 'M' },
            { id: 'p5', texto: 'Personal con uniforme e identificación', peso: 'm' },
        ],
    },
    {
        seccion: 'Instalaciones',
        items: [
            { id: 'i1', texto: 'Área limpia, ordenada y sin plagas (fumigación al día)', peso: 'M' },
            { id: 'i2', texto: 'Temperatura y humedad registradas a diario y dentro de rango', peso: 'C' },
            { id: 'i3', texto: 'Refrigerador con termómetro y registro diario', peso: 'C' },
            { id: 'i4', texto: 'Productos sobre tarimas o estantes, nunca en el piso', peso: 'M' },
            { id: 'i5', texto: 'Extintor vigente y señalización de emergencia', peso: 'M' },
        ],
    },
    {
        seccion: 'Almacenamiento',
        items: [
            { id: 'a1', texto: 'Área rotulada para productos no aptos (vencidos, retirados)', peso: 'C' },
            { id: 'a2', texto: 'Rotación por fecha de vencimiento (primero en vencer, primero en salir)', peso: 'M' },
            { id: 'a3', texto: 'Sin productos vencidos en el área de venta', peso: 'C' },
            { id: 'a4', texto: 'Productos de cadena de frío dentro del refrigerador', peso: 'C' },
        ],
    },
    {
        seccion: 'Dispensación',
        items: [
            { id: 'd1', texto: 'Antibióticos y bajo receta sólo con receta, anotados en el libro', peso: 'C' },
            { id: 'd2', texto: 'Recetas retenidas archivadas por fecha', peso: 'M' },
            { id: 'd3', texto: 'Sin descuentos ni puntos en sucedáneos de la leche materna', peso: 'C' },
            { id: 'd4', texto: 'Precios visibles al público', peso: 'm' },
        ],
    },
    {
        seccion: 'Documentación',
        items: [
            { id: 'r1', texto: 'Procedimientos escritos y al alcance del personal', peso: 'M' },
            { id: 'r2', texto: 'Farmacovigilancia: notificaciones o reporte cero del semestre', peso: 'M' },
            { id: 'r3', texto: 'Actas de destrucción y bajas archivadas', peso: 'M' },
            { id: 'r4', texto: 'Retiros de lote atendidos y documentados', peso: 'M' },
        ],
    },
]);

export const A_LA_VISTA = Object.freeze([
    { seccion: 'A la vista del público', items: [
        { id: 'v1', texto: 'Permiso de funcionamiento de la SRS', peso: 'C' },
        { id: 'v2', texto: 'Rótulo del regente con nombre, número JVPQF y horario', peso: 'C' },
        { id: 'v3', texto: 'Horario de atención de la farmacia', peso: 'm' },
        { id: 'v4', texto: 'Aviso de venta de antibióticos sólo con receta', peso: 'M' },
        { id: 'v5', texto: 'Aviso de la Defensoría del Consumidor y libro de quejas', peso: 'm' },
        { id: 'v6', texto: 'Prohibición de fumar', peso: 'm' },
    ] },
    { seccion: 'Para el personal y la inspección', items: [
        { id: 'v7', texto: 'Acreditaciones de los dependientes', peso: 'M' },
        { id: 'v8', texto: 'Credencial del regente', peso: 'M' },
        { id: 'v9', texto: 'Autorización del referente de farmacovigilancia', peso: 'M' },
        { id: 'v10', texto: 'Permiso del área de inyecciones (si aplica)', peso: 'M' },
    ] },
]);

export const listaDe = (tipo) => (tipo === 'autoinspeccion' ? AUTOINSPECCION : tipo === 'a_la_vista' ? A_LA_VISTA : []);

/**
 * El resultado de una lista: cuántos cumplen, cuántos no (por peso) y si
 * aprueba. `respuestas` = { [id]: 'si' | 'no' | 'na' }.
 */
export function puntuarLista(lista, respuestas = {}) {
    const items = lista.flatMap((s) => s.items);
    const r = { total: items.length, si: 0, no: 0, na: 0, sinResponder: 0, fallas: { C: 0, M: 0, m: 0 } };
    for (const it of items) {
        const v = respuestas?.[it.id];
        if (v === 'si') r.si += 1;
        else if (v === 'no') { r.no += 1; r.fallas[it.peso] += 1; }
        else if (v === 'na') r.na += 1;
        else r.sinResponder += 1;
    }
    const aplican = r.total - r.na;
    r.porcentaje = aplican > 0 ? Math.round((r.si / aplican) * 100) : 0;
    r.aprueba = r.sinResponder === 0 && r.fallas.C === 0;
    return r;
}

// ── Semestres (reporte cero) ─────────────────────────────────────────────

/** '2026-S1' para una fecha ISO. */
export const semestreDe = (iso) => {
    const [a, m] = String(iso || '').split('-').map(Number);
    return a && m ? `${a}-S${m <= 6 ? 1 : 2}` : '';
};

/** El semestre que ya cerró y toca reportar (gemela del `v_sem` de `cumplimiento_resumen`). */
export const semestreAReportar = (hoyIso) => {
    const [a, m] = String(hoyIso || '').split('-').map(Number);
    return m <= 6 ? `${a - 1}-S2` : `${a}-S1`;
};

export const nombreDelSemestre = (s) => {
    const [a, n] = String(s || '').split('-S');
    return a && n ? `${n === '1' ? 'Enero a junio' : 'Julio a diciembre'} de ${a}` : s;
};

/** Los últimos `n` semestres terminados, del más nuevo al más viejo. */
export function semestresRecientes(hoyIso, n = 4) {
    const out = [];
    let s = semestreAReportar(hoyIso);
    for (let i = 0; i < n; i++) {
        out.push(s);
        const [a, k] = s.split('-S').map(Number);
        s = k === 2 ? `${a}-S1` : `${a - 1}-S2`;
    }
    return out;
}

// ── Plazos ───────────────────────────────────────────────────────────────

/** Días que faltan (negativo = ya pasó) entre dos fechas ISO. */
export function diasHasta(fechaIso, hoyIso) {
    if (!fechaIso || !hoyIso) return null;
    const a = Date.UTC(...String(hoyIso).slice(0, 10).split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
    const b = Date.UTC(...String(fechaIso).slice(0, 10).split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
    return Math.round((b - a) / 86400000);
}

/** Cómo va el plazo de un registro abierto: { tono, texto } o null. */
export function estadoDelPlazo(registro, hoyIso) {
    if (!registro || registro.anulado_at) return { tono: 'neutral', texto: 'Anulado' };
    if (registro.estado === 'cerrado') return { tono: 'success', texto: registro.tipo === 'farmacovigilancia' ? 'Notificada' : 'Cerrado' };
    if (!registro.vence_el) return { tono: 'warning', texto: 'Abierto' };
    const d = diasHasta(registro.vence_el, hoyIso);
    if (registro.tipo === 'destruccion') {
        return d < 0 ? { tono: 'warning', texto: 'Aviso a la SRS ya debió salir' } : { tono: 'info', texto: `Avisar a la SRS en ${d} d` };
    }
    if (d < 0) return { tono: 'danger', texto: `Plazo vencido hace ${-d} d` };
    if (d === 0) return { tono: 'danger', texto: 'Vence hoy' };
    return { tono: d <= 3 ? 'warning' : 'info', texto: `Quedan ${d} d` };
}

// ── Vencimientos de documentos ───────────────────────────────────────────

/**
 * El calendario de vencimientos de toda la red a partir de los documentos del
 * expediente (`documentosDeSucursal`, que es la misma fuente que el aviso
 * diario `check-doc-expiry`). Recibe la función para no depender de la
 * pantalla. Devuelve filas ordenadas por fecha.
 */
export function calendarioDeVencimientos(branches, documentosDeSucursal, hoyIso) {
    const filas = [];
    for (const b of branches || []) {
        if (!b || !['FARMACIA', 'BODEGA'].includes(b.type)) continue;
        const { permisos, personal, infra, propios } = documentosDeSucursal(b);
        for (const d of [...permisos, ...personal, ...infra, ...propios]) {
            const vence = d.hasExpiration === false ? null : d.expDate;
            if (!vence) continue;
            const iso = String(vence).slice(0, 10);
            filas.push({ branchId: b.id, sala: b.name, docId: d.id, documento: d.title, vence: iso, dias: diasHasta(iso, hoyIso), tieneArchivo: !!d.url });
        }
        // Los extintores ya salen como renglón del expediente; esto queda para
        // quien pase otra fuente de documentos sin ellos.
        const ext = b?.settings?.legal?.extinguisherExpiration;
        if (ext && !filas.some((f) => f.branchId === b.id && f.docId === 'extintores')) {
            const iso = String(ext).slice(0, 10);
            filas.push({ branchId: b.id, sala: b.name, docId: 'extintores', documento: 'Recarga de extintores', vence: iso, dias: diasHasta(iso, hoyIso), tieneArchivo: true });
        }
    }
    return filas.sort((x, y) => x.vence.localeCompare(y.vence) || String(x.sala).localeCompare(String(y.sala)));
}

/** El tono de una fila del calendario (mismos umbrales que el aviso: 60/30/7). */
export function tonoDeVencimiento(dias) {
    if (dias === null || dias === undefined) return 'neutral';
    if (dias < 0) return 'danger';
    if (dias <= 7) return 'danger';
    if (dias <= 30) return 'warning';
    if (dias <= 60) return 'info';
    return 'success';
}

// ── Lo que se muestra en la lista y en el tablero ────────────────────────
// Vivían en las pestañas del portal; se mudaron (2026-11-13) para que la app
// las cuente igual.

/** Una línea con lo esencial de un registro. */
export function resumenDelRegistro(r) {
    const d = r?.datos || {};
    switch (r?.tipo) {
        case 'farmacovigilancia': return [d.producto, d.reaccion].filter(Boolean).join(' · ');
        case 'reporte_cero': return `Sin reacciones adversas · ${nombreDelSemestre(d.periodo)}`;
        case 'vencido': return [d.producto, d.lote && `lote ${d.lote}`, d.cantidad && `${d.cantidad} u.`].filter(Boolean).join(' · ');
        case 'destruccion': return [`${(d.productos || []).length} producto(s)`, d.gestora].filter(Boolean).join(' · ');
        case 'retiro': return [d.producto, d.lote && `lote ${d.lote}`, d.alerta].filter(Boolean).join(' · ');
        case 'autoinspeccion':
        case 'a_la_vista': return d.resultado ? `${d.resultado.porcentaje} % · ${d.resultado.aprueba ? 'Aprueba' : 'No aprueba'}` : '';
        case 'capacitacion': return [d.tema, `${(d.asistentes || []).length} asistentes`].filter(Boolean).join(' · ');
        default: return '';
    }
}

/**
 * Lo que le falta a una sala del tablero (`cumplimiento_resumen`), en palabras
 * de la sala: `[{ clave, tono: 'danger'|'warning'|'info', texto, detalle, tab, crea }]`.
 * `tab` es la pestaña donde se resuelve; `crea`, el registro que lo resuelve
 * de una vez (si lo hay); `detalle`, lo mismo dicho corto para ir junto al
 * nombre de la sala; `clave`, la obligación (para juntar las salas).
 */
export function pendientesDeSala(s, hoyIso, fechaTexto = (f) => f) {
    const r = [];
    const farmacia = s.tipo_sala === 'FARMACIA';
    if (s.fv_vencidas > 0) r.push({ clave: 'fv_fuera_de_plazo', tono: 'danger', texto: `${s.fv_vencidas} reacción(es) adversa(s) sin notificar fuera de plazo`, detalle: `${s.fv_vencidas}`, tab: 'farmacovigilancia' });
    else if (s.fv_abiertas > 0) r.push({ clave: 'fv_por_notificar', tono: 'warning', texto: `${s.fv_abiertas} reacción(es) adversa(s) por notificar`, detalle: `${s.fv_abiertas}`, tab: 'farmacovigilancia' });
    if (farmacia && !s.fv_semestre_cubierto) r.push({ clave: 'fv_semestre', tono: 'warning', texto: `Falta el reporte de farmacovigilancia de ${nombreDelSemestre(s.fv_semestre).toLowerCase()}`, detalle: '', tab: 'farmacovigilancia', crea: 'reporte_cero', semestre: s.fv_semestre });
    if (s.retiros_abiertos > 0) r.push({ clave: 'retiros', tono: 'danger', texto: `${s.retiros_abiertos} retiro(s) de lote sin atender`, detalle: `${s.retiros_abiertos}`, tab: 'retiros' });
    if (s.dependientes_sin_acreditacion > 0) r.push({ clave: 'acreditacion', tono: 'danger', texto: `${s.dependientes_sin_acreditacion} persona(s) de mostrador sin acreditación`, detalle: `${s.dependientes_sin_acreditacion}`, tab: 'dependientes' });
    const dAuto = s.ultima_autoinspeccion ? -diasHasta(s.ultima_autoinspeccion, hoyIso) : null;
    if (dAuto === null) r.push({ clave: 'autoinspeccion', tono: 'warning', texto: 'Nunca se ha hecho la autoinspección', detalle: 'nunca', tab: 'autoinspeccion', crea: 'autoinspeccion' });
    else if (dAuto > 365) r.push({ clave: 'autoinspeccion', tono: 'warning', texto: `La última autoinspección fue el ${fechaTexto(s.ultima_autoinspeccion)} (toca una por año)`, detalle: `última ${fechaTexto(s.ultima_autoinspeccion)}`, tab: 'autoinspeccion', crea: 'autoinspeccion' });
    if (farmacia && !s.ultima_revision_a_la_vista) r.push({ clave: 'a_la_vista', tono: 'info', texto: 'Falta revisar lo que debe estar a la vista', detalle: '', tab: 'autoinspeccion', crea: 'a_la_vista' });
    if (s.capacitaciones_del_anio === 0) r.push({ clave: 'capacitacion', tono: 'warning', texto: 'Sin capacitaciones anotadas este año', detalle: '', tab: 'capacitacion', crea: 'capacitacion' });
    if (s.vencidos_por_destruir > 0) r.push({ clave: 'destruir', tono: 'info', texto: `${s.vencidos_por_destruir} producto(s) de baja esperando destrucción`, detalle: `${s.vencidos_por_destruir}`, tab: 'vencidos', crea: 'destruccion' });
    return r;
}

/**
 * Cada obligación del tablero de la red: el título cuando falta en alguna
 * sala y cómo se dice cuando está al día en todas. El orden es el de la
 * urgencia (lo que tiene plazo legal corriendo, primero).
 */
export const OBLIGACIONES = Object.freeze([
    { clave: 'fv_fuera_de_plazo', titulo: 'Reacciones adversas sin notificar, fuera de plazo', alDia: null },
    { clave: 'retiros', titulo: 'Retiros de lote sin atender', alDia: 'Retiros de lote atendidos' },
    { clave: 'acreditacion', titulo: 'Personal de mostrador sin acreditación', alDia: 'Mostrador acreditado' },
    { clave: 'fv_por_notificar', titulo: 'Reacciones adversas por notificar', alDia: 'Reacciones adversas notificadas' },
    { clave: 'fv_semestre', titulo: 'Reporte de farmacovigilancia del semestre', alDia: 'Reporte de farmacovigilancia del semestre' },
    { clave: 'autoinspeccion', titulo: 'Autoinspección del año', alDia: 'Autoinspección del año' },
    { clave: 'capacitacion', titulo: 'Capacitación de este año', alDia: 'Capacitación de este año' },
    { clave: 'a_la_vista', titulo: 'Revisión de lo que debe estar a la vista', alDia: 'Lo que debe estar a la vista' },
    { clave: 'destruir', titulo: 'Bajas esperando destrucción', alDia: null },
]);

/**
 * El tablero de la red: lo que falta juntado por obligación, con las salas
 * donde falta. Siete tarjetas que repiten el mismo renglón no dicen nada; una
 * línea «falta en estas salas» dice qué hacer y dónde.
 * Devuelve `{ grupos: [{ clave, titulo, tono, tab, crea, salas: [{ branch_id, sala, detalle, tono }] }], alDia: [texto], totalSalas }`.
 * `temas` (opcional) deja sólo las pestañas que la persona puede ver.
 */
export function pendientesDeLaRed(salas, hoyIso, fechaTexto = (f) => f, temas = null) {
    const porClave = new Map();
    for (const s of salas || []) {
        for (const p of pendientesDeSala(s, hoyIso, fechaTexto)) {
            if (temas && !temas.has(p.tab)) continue;
            if (!porClave.has(p.clave)) porClave.set(p.clave, { ...p, salas: [] });
            porClave.get(p.clave).salas.push({ branch_id: s.branch_id, sala: s.sala, detalle: p.detalle, tono: p.tono });
        }
    }
    const peso = { danger: 0, warning: 1, info: 2 };
    const grupos = [];
    const alDia = [];
    for (const o of OBLIGACIONES) {
        const g = porClave.get(o.clave);
        if (g) {
            const tono = g.salas.reduce((t, x) => (peso[x.tono] < peso[t] ? x.tono : t), 'info');
            const titulo = o.clave === 'fv_semestre' && g.semestre
                ? `Reporte de farmacovigilancia de ${nombreDelSemestre(g.semestre).toLowerCase()}` : o.titulo;
            grupos.push({ clave: o.clave, titulo, tono, tab: g.tab, crea: g.crea || null, semestre: g.semestre || null, salas: g.salas });
        } else if (o.alDia) {
            alDia.push(o.alDia);
        }
    }
    // «Por notificar» al día no se dice si hay reacciones fuera de plazo.
    const conFuera = grupos.some((g) => g.clave === 'fv_fuera_de_plazo');
    return {
        grupos: grupos.sort((a, b) => peso[a.tono] - peso[b.tono]),
        alDia: conFuera ? alDia.filter((t) => t !== 'Reacciones adversas notificadas') : alDia,
        totalSalas: (salas || []).length,
    };
}

/**
 * Las pestañas de registros: qué tipos lleva cada una, qué botón crea cada
 * tipo, el aviso de la norma y el texto cuando está vacía.
 */
export const REGISTROS_DE_CUMPLIMIENTO = Object.freeze({
    farmacovigilancia: {
        tipos: [{ tipo: 'farmacovigilancia', boton: 'Sospecha de reacción adversa', principal: true }, { tipo: 'reporte_cero', boton: 'Reporte cero del semestre' }],
        aviso: 'Toda sospecha se notifica al Centro Nacional de Farmacovigilancia: 30 días si no es grave, 15 si es grave y 72 horas si fue mortal o puso en riesgo la vida. Si en el semestre no hubo ninguna, se envía el reporte cero.',
        vacio: { titulo: 'Sin sospechas anotadas', subtitulo: 'Si un cliente cuenta una reacción a un medicamento, se anota aquí el mismo día.' },
    },
    vencidos: {
        tipos: [{ tipo: 'vencido', boton: 'Dar de baja un producto', principal: true }, { tipo: 'destruccion', boton: 'Acta de destrucción' }],
        aviso: 'Lo vencido o dañado sale del área de venta, se separa en el área rotulada de no aptos y se anota. Para destruirlo se avisa a la SRS 72 horas antes y lo retira una gestora autorizada por el MARN, que entrega su certificado.',
        vacio: { titulo: 'Sin bajas anotadas' },
    },
    retiros: {
        tipos: [{ tipo: 'retiro', boton: 'Anotar retiro en esta sala', principal: true }],
        aviso: 'Cuando la SRS o un laboratorio ordena retirar un lote, cada sala dice cuántas unidades tenía, las separa y anota a quién las devolvió.',
        vacio: { titulo: 'Sin retiros de lote' },
    },
    autoinspeccion: {
        tipos: [{ tipo: 'autoinspeccion', boton: 'Hacer autoinspección', principal: true }, { tipo: 'a_la_vista', boton: 'Revisar lo que debe estar a la vista' }],
        aviso: 'Una autoinspección al año con la guía de la SRS, con su informe y su plan de acción. Un punto crítico sin cumplir basta para no aprobar.',
        vacio: { titulo: 'Sin autoinspecciones', subtitulo: 'La norma pide una al año en cada sala.' },
    },
    capacitacion: {
        tipos: [{ tipo: 'capacitacion', boton: 'Anotar capacitación', principal: true }],
        aviso: 'El personal recibe capacitación según un programa anual; cada una se registra con su tema, quién la dio, quiénes asistieron y cómo se evaluó.',
        vacio: { titulo: 'Sin capacitaciones anotadas' },
    },
});

/** Los datos listos para guardar: sin vacíos y con el resultado de la lista. */
export function datosParaGuardar(tipo, datos) {
    const limpio = Object.fromEntries(Object.entries(datos || {}).filter(([, v]) => v !== '' && v !== undefined));
    const lista = listaDe(tipo);
    if (lista.length) {
        const p = puntuarLista(lista, limpio.respuestas);
        limpio.resultado = { porcentaje: p.porcentaje, aprueba: p.aprueba, fallas: p.fallas };
    }
    return limpio;
}

/** Los datos con que nace un formulario de alta (o los del registro a corregir). */
export function datosIniciales(tipo, registro) {
    const datos = {};
    for (const c of TIPOS[tipo]?.campos || []) {
        if (c.tipo === 'fijo') datos[c.key] = c.valor;
        else if (c.tipo === 'checklist') datos[c.key] = {};
        else if (c.tipo === 'personas' || c.tipo === 'lista') datos[c.key] = [];
    }
    return { ...datos, ...(registro?.datos || {}) };
}
