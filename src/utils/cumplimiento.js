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
