// El historial de la ficha de una persona y sus ausencias, escritos una vez
// para el portal (`EmployeeDetailView`) y la app (`app/empleado/historial.js`).
//
// La fuente es la vista `employee_timeline`: contratación, novedades, los
// movimientos de la bitácora y los horarios publicados. **La vista no trae el
// id del evento** —es un UNION de cuatro tablas—, así que el portal armaba un id
// sintético (`TIPO_fecha_creado`) y con ESE id llamaba a «Editar», «Cancelar» y
// «Adjuntar soporte», que buscan la fila en `employee_events` por id: no la
// encontraban nunca. Acá cada renglón que viene de `employee_events` se amarra
// con su fila real (`eventos`: el historial que ya trae la ficha) por tipo,
// fecha y momento de creación, y lleva `eventoId`. Sin amarre, no hay acción.

/** El tono de cada tipo de evento (el nombre de la variante; el color lo pone quien pinta). */
const VARIANTE_EVENTO = {
    ROSTER_PUBLISHED: 'neutral',
    EMPLEADO_ASIGNADO: 'chart-1',
    REASSIGNMENT: 'chart-1',
    EMPLEADO_RELEVADO: 'warning',
    EMPLEADO_DESVINCULADO_SUCURSAL: 'danger',
    UNASSIGNED: 'danger',
    REHIRE: 'success',
    VACATION_RECALL: 'warning',
    DISABILITY: 'danger',
    VACATION: 'success',
    PERMIT: 'success',
    SUPPORT: 'chart-4',
    INDUCTION: 'chart-9',
    AMONESTACION_VERBAL: 'warning',
    AMONESTACION_ESCRITA: 'warning',
    SUSPENSION: 'danger',
    // El Art. 86 es la única del grupo que es una buena noticia: la persona rectificó.
    RECTIFICACION: 'success',
};
const VARIANTE_POR_PARTE = [['TRANSFER', 'chart-1'], ['PROMOTION', 'success'], ['SALARY', 'chart-6'], ['TERMINATION', 'danger']];

export function varianteDeEvento(type, tiposConocidos = {}) {
    if (type === 'HIRE' || type === 'HIRING') return 'success';
    if (VARIANTE_EVENTO[type]) return VARIANTE_EVENTO[type];
    if (tiposConocidos[type]) {
        const parte = VARIANTE_POR_PARTE.find(([k]) => String(type).includes(k));
        if (parte) return parte[1];
    }
    return 'neutral';
}

const meta = (m) => {
    if (!m) return {};
    if (typeof m === 'string') { try { return JSON.parse(m); } catch { return {}; } }
    return m;
};
const mismoMomento = (a, b) => a && b && new Date(a).getTime() === new Date(b).getTime();

/**
 * Los renglones de `employee_timeline` listos para pintar, del más nuevo al más viejo.
 * @param {Array} filas    lo que devolvió `fetchEmployeeTimeline`
 * @param {Array} eventos  las filas de `employee_events` de esa persona (`emp.history`)
 */
export function historialDeFicha(filas = [], eventos = []) {
    const usados = new Set();
    return (filas || []).map((ev) => {
        const m = meta(ev.metadata);
        const real = (eventos || []).find((e) => !usados.has(e.id) && e.type === ev.event_type
            && String(e.date).slice(0, 10) === String(ev.event_date).slice(0, 10)
            && (mismoMomento(e.created_at, ev.created_at) || !ev.created_at));
        if (real) usados.add(real.id);
        return {
            id: real?.id ?? `${ev.event_type}_${ev.event_date}_${ev.created_at}`,
            eventoId: real?.id ?? null,
            type: ev.event_type,
            category: ev.category,
            date: ev.event_date,
            endDate: ev.event_end_date,
            note: ev.note || m.note || m.details?.note || 'Evento registrado en el sistema.',
            metadata: m,
            documentId: m.document_id || null,
            isSystem: ['HIRE', 'ROSTER_PUBLISHED'].includes(ev.event_type),
        };
    });
}

/** ¿Se puede corregir o cancelar? Sólo una novedad real que no esté ya cancelada ni reemplazada. */
export const eventoVigente = (ev) => !!ev?.eventoId && !ev.isSystem
    && ev.metadata?.status !== 'CANCELLED' && ev.metadata?.status !== 'SUPERSEDED';

/** Los datos para reabrir una novedad en el formulario de corrección. */
export const datosParaCorregir = (ev, employeeId) => ({
    type: ev.type, date: ev.date, endDate: ev.metadata?.endDate, note: ev.note,
    ...ev.metadata, employeeId, _editingEventId: ev.eventoId,
});

const esAusencia = (ev) => ev.type === 'PERMIT' || ev.type === 'DISABILITY';

/**
 * Los días de ausencia, para el calendario: `{ 'AAAA-MM-DD': { permiso, incapacidad,
 * seguro, eventos } }`. `seguro` marca desde el cuarto día de una incapacidad (lo paga el ISSS).
 */
export function diasDeAusencia(historial = [], hoy = null) {
    const mapa = {};
    const poner = (d, ev, indice) => {
        const c = (mapa[d] ||= { permiso: false, incapacidad: false, seguro: false, eventos: [] });
        if (ev.type === 'PERMIT') c.permiso = true; else c.incapacidad = true;
        if (ev.type === 'DISABILITY' && indice >= 3) c.seguro = true;
        if (!c.eventos.some((e) => e.id === ev.id)) c.eventos.push(ev);
    };
    for (const ev of historial.filter(esAusencia)) {
        const m = ev.metadata || {};
        if (ev.type === 'PERMIT' && m.permissionDates?.length) { m.permissionDates.forEach((d) => poner(d, ev, 0)); continue; }
        const inicio = new Date(`${ev.date || hoy}T12:00:00`);
        const fin = new Date(`${m.endDate || ev.date || hoy}T12:00:00`);
        let i = 0;
        for (const d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1), i++) poner(d.toISOString().slice(0, 10), ev, i);
    }
    return mapa;
}

/** Las ausencias de un mes (`AAAA-MM`) o, si se eligió, de un día. */
export function ausenciasFiltradas(historial = [], { mes = null, dia = null } = {}) {
    return historial.filter(esAusencia).filter((ev) => {
        const m = ev.metadata || {};
        if (dia) {
            if (ev.type === 'PERMIT' && m.permissionDates?.length) return m.permissionDates.includes(dia);
            const inicio = ev.date || dia; const fin = m.endDate || ev.date || dia;
            return dia >= inicio && dia <= fin;
        }
        if (!mes) return true;
        if (ev.type === 'PERMIT' && m.permissionDates?.length) return m.permissionDates.some((d) => d.startsWith(mes));
        return (ev.date || '').startsWith(mes) || (m.endDate || '').startsWith(mes);
    });
}

/** Días que paga el seguro en una incapacidad: del cuarto en adelante. */
export const diasDeSeguro = (ev) => (ev.type === 'DISABILITY' && Number(ev.metadata?.days) > 3 ? Number(ev.metadata.days) - 3 : 0);
