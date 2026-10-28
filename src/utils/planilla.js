/**
 * Planilla — lo puro de la nómina: el orden por cargo, el estado de un período,
 * cómo se nombra la quincena y el monto en letras de la boleta. Vivía en
 * `PayrollView`; se mudó el 2026-10-05 para que la app diga lo mismo.
 */
import { diaDe, diasEntre, fechaNumerica, fechaTexto, sumarDias } from './fecha';
import { descuentoDeSuspension, quincenaPorDefecto } from './quincena';

export const JERARQUIA_DE_CARGOS = [2,3,11,12,13,22,19,20,8,23,24,9,14,16,17,18,15,26,30,27];
export const ordenDeCargo = (emp) => {
    const idx = JERARQUIA_DE_CARGOS.indexOf(Number(emp?.role_id ?? emp?.roleId));
    return idx === -1 ? 999 : idx;
};

export const ESTADO_PLANILLA = {
    DRAFT:    { label: 'Borrador', variante: 'neutral' },
    APPROVED: { label: 'Aprobada', variante: 'success' },
    PAID:     { label: 'Pagada',   variante: 'chart-1' },
};

// ─── Number to words ──────────────────────────────────────────────────────────
/**
 * Un entero en letras, como se escribe en una boleta. Corregido el 2026-10-05
 * al pasarlo al núcleo: la versión de la pantalla escribía «uno mil» por 1,000,
 * «ciento» por 100 y «veinte y uno» por 21 — en papel que se firma.
 */
export function numeroEnLetras(n) {
    const ones = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve'];
    const veinti = ['veinte','veintiuno','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
    const tens = ['','','veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
    const hunds = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
    if (n === 0) return 'cero';
    if (n < 0) return 'menos ' + numeroEnLetras(-n);
    let s = '';
    if (n >= 1000) {
        const miles = Math.floor(n / 1000);
        // «mil», no «uno mil»; «veintiún mil», no «veintiuno mil».
        s += (miles === 1 ? '' : numeroEnLetras(miles).replace(/uno$/, 'ún').replace(/^ún$/, 'un') + ' ') + 'mil ';
        n %= 1000;
    }
    if (n === 100) { s += 'cien '; n = 0; }
    if (n >= 100)  { s += hunds[Math.floor(n / 100)] + ' '; n %= 100; }
    if (n >= 30)   { s += tens[Math.floor(n / 10)] + (n % 10 ? ' y ' + ones[n % 10] : '') + ' '; n = 0; }
    else if (n >= 20) { s += veinti[n - 20] + ' '; n = 0; }
    else if (n > 0){ s += ones[n] + ' '; }
    return s.trim();
}
export function montoEnLetras(amount) {
    const total = Math.round(amount * 100);
    return `${numeroEnLetras(Math.floor(total / 100)).toUpperCase()} CON ${String(total % 100).padStart(2,'0')}/100`;
}
export function rotuloDePeriodo(start, end) {
    const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
    const m = cap(fechaTexto(start, { month: 'long', year: 'numeric' }));
    const dia = Number(String(start).slice(8, 10));
    if (dia === 1)  return `Primera Quincena de ${m}`;
    if (dia === 16) return `Segunda Quincena de ${m}`;
    return `${fechaNumerica(start)} — ${fechaTexto(end)}`;
}


/** Los totales de la planilla: líquido, descuentos y salario ordinario. */
export function totalesDePlanilla(entries) {
    const t = { personas: 0, liquido: 0, descuentos: 0, ordinario: 0 };
    for (const e of entries || []) {
        t.personas++;
        t.liquido += Number(e.net_pay || 0);
        t.descuentos += Number(e.total_deductions || 0);
        t.ordinario += Number(e.ordinary_salary || 0);
    }
    return t;
}

/* Las partidas de una boleta, con la MISMA regla que el papel del portal.
 * La fila guarda las horas extra y nocturnas como HORAS, no como dinero: el
 * monto sale de multiplicarlas por el sueldo por hora y su recargo (sueldo
 * base / 30 / 8, los dos redondeados a centavos como en el papel). La app las
 * pintaba con `formatMoney` tal cual — tres horas extra salían como $3.00 — y
 * su subtotal era el A con las partidas del B listadas encima, o sea que la
 * suma no daba. Los subtotales A y B son los de la fila, nunca recalculados:
 * es lo que se pagó. */
const r2 = (n) => parseFloat((Number(n) || 0).toFixed(2));
export function partidasDeBoleta(entry, baseSalary) {
    const e = entry || {};
    const diario = r2((Number(baseSalary) || 0) / 30);
    const porHora = r2(diario / 8);
    // Una partida con horas y sin monto (sueldo desconocido) se queda: esconderla
    // haría desaparecer horas trabajadas sin decir nada.
    const sinCero = (lista) => lista.filter((p) => p.monto || p.horas);
    return {
        diario,
        porHora,
        sujetos: [
            { rotulo: `Salario ordinario · ${r2(e.days_worked)} días × ${diario.toFixed(2)}`, monto: r2(e.ordinary_salary) },
        ],
        subtotalA: r2(e.subtotal_a),
        noSujetos: sinCero([
            { rotulo: 'Horas nocturnas ordinarias (25%)', horas: r2(e.night_hours_ordinary), monto: r2(e.night_hours_ordinary * porHora * 0.25) },
            { rotulo: 'Horas nocturnas extra (50%)',      horas: r2(e.night_hours_extra),    monto: r2(e.night_hours_extra * porHora * 0.5) },
            { rotulo: 'Horas extra diurnas (×2)',         horas: r2(e.extra_hours_diurnal),  monto: r2(e.extra_hours_diurnal * porHora * 2) },
            { rotulo: 'Horas extra nocturnas (×2.25)',    horas: r2(e.extra_hours_nocturnal), monto: r2(e.extra_hours_nocturnal * porHora * 2.25) },
            { rotulo: 'Recargo de asuetos',     monto: r2(e.holiday_surcharge) },
            { rotulo: 'Bonificaciones',         monto: r2(e.bonifications) },
            { rotulo: 'Bono vacacional (30%)',  monto: r2(e.vacation_bonus) },
            { rotulo: 'Viáticos',               monto: r2(e.viaticos) },
        ]),
        subtotalB: r2(e.subtotal_b),
        retenciones: sinCero([
            { rotulo: `ISSS · ${r2(e.ordinary_salary).toFixed(2)} × 3%`,    monto: r2(e.isss_deduction) },
            { rotulo: `AFP · ${r2(e.ordinary_salary).toFixed(2)} × 7.25%`,  monto: r2(e.afp_deduction) },
            { rotulo: 'Renta',                                              monto: r2(e.renta_deduction) },
        ]),
        otrosDescuentos: sinCero([
            { rotulo: 'Orden de descuento', monto: r2(e.order_discount) },
            { rotulo: `Otros descuentos · ${rotuloDeOtrosDescuentos(e.other_discounts_concepto, e.other_discounts_detalle)}`, monto: r2(e.other_discounts) },
            { rotulo: 'Adelanto salarial',  monto: r2(e.salary_advance) },
        ]),
        totalDescuentos: r2(e.total_deductions),
        liquido: r2(e.net_pay),
    };
}

// `quincenaPorDefecto` vive en `./quincena` y se re-exporta acá (2026-10-24):
// el portal la usa al ABRIR el formulario de período nuevo, o sea en el
// arranque, y por ella el arranque cargaba este archivo entero.
export { quincenaPorDefecto };

// ─── Las quincenas: 1–15 y 16–fin de mes (decisión del dueño, 2026-10-22) ────
//
// «planilla, 15 y 16, me refiero, del 1 al 15 y del 16 al 30 o 31.» Cada
// quincena paga la MITAD del sueldo mensual aunque la segunda tenga 13, 14, 15
// o 16 días: se pagan 15 días de sueldo diario (mensual / 30, la base que ya
// usaba `calcPayrollEntry`), menos las ausencias que se descuentan. Antes se
// contaban los días con marcación: los descansos semanales (Art. 19) y los
// asuetos no trabajados no se pagaban, y sin marcaciones se pagaban los días
// de calendario —16 en octubre, 13 en febrero— (auditoría 2026-10-21, H3).

/** Los días de sueldo que paga una quincena entera. */
export const DIAS_DE_QUINCENA = 15;

/** ¿El período es una quincena bien formada? 1–15, o 16–último día del mismo mes. */
export function esQuincena(start, end) {
    if (!start || !end) return false;
    const s = String(start).slice(0, 10);
    const dia = Number(s.slice(8, 10));
    if (dia !== 1 && dia !== 16) return false;
    return quincenaPorDefecto(s).end_date === String(end).slice(0, 10);
}

/** El motivo por el que un período no es una quincena, o `null` si lo es. */
export function problemaDeQuincena(start, end) {
    if (!start || !end) return 'Elige el inicio y el fin de la quincena.';
    if (esQuincena(start, end)) return null;
    return 'Una quincena va del 1 al 15, o del 16 al último día del mes.';
}

/**
 * ¿Esta fila de asistencia se descuenta? Sólo la ausencia sin justificar. Las
 * ausencias con tipo (vacaciones, incapacidad, permiso) no. La suspensión
 * tampoco se decide acá: si lleva descuento lo decide Talento Humano en el
 * propio evento («las sanciones pueden ser o no descontadas», el dueño,
 * 2026-10-22), y eso lo lee `diasPagadosDeQuincena` por `suspensiones`.
 */
export function esAusenciaDescontable(ts) {
    if (!ts) return false;
    return !!ts.is_absent && !ts.absence_type;
}

// ── Contrato dentro de la quincena (2026-10-22) ──────────────────────────────
// «Según días trabajados»: quien entra o sale a mitad de quincena cobra sólo los
// días en que estaba contratado, a sueldo diario (mensual / 30). Quien cubre la
// quincena entera sigue cobrando 15, aunque el período tenga 13 o 16 días.

/**
 * Los días de la quincena en que la persona estaba contratada.
 * `ingreso` es su `hire_date`; `baja` es la fecha del evento TERMINATION, que
 * es el día en que se FIRMA la renuncia o el despido (regla del dueño,
 * 2026-10-22): ese día todavía cuenta y se paga. Que el cron la deje INACTIVO
 * esa madrugada no cambia la planilla.
 * Una baja anterior o igual al ingreso es de un contrato viejo (recontratación)
 * y no cuenta.
 *
 * Devuelve `{ dias, desde, hasta }`; `dias = 0` si no estuvo contratada.
 */
export function contratoEnQuincena({ start, end }, ingreso = null, baja = null) {
    const ing = diaDe(ingreso);
    const bj  = diaDe(baja);
    const desde = ing && ing > start ? ing : start;
    const ultimo = bj && (!ing || bj > ing) ? bj : null;
    const hasta = ultimo && ultimo < end ? ultimo : end;
    if (hasta < desde) return { dias: 0, desde, hasta };
    if (desde === start && hasta === end) return { dias: DIAS_DE_QUINCENA, desde, hasta };
    return { dias: Math.min(DIAS_DE_QUINCENA, diasEntre(desde, hasta) + 1), desde, hasta };
}

const enAlgunRango = (dia, rangos) => (rangos || []).some(r => r.desde <= dia && dia <= r.hasta);
const rangoDe = (desde, hasta) => {
    const d = diaDe(desde);
    if (!d) return null;
    const h = diaDe(hasta) || d;
    return { desde: d, hasta: h < d ? d : h };
};
const metaDe = (x) => (x?.metadata && typeof x.metadata === 'object') ? x.metadata : {};
const eventoAnulado = (ev) => {
    const m = metaDe(ev);
    return m.status === 'CANCELLED' || m.status === 'SUPERSEDED' || m.applyStatus === 'SKIPPED';
};

/**
 * Los días que paga la quincena para UNA persona: los días contratados (15 si
 * cubre la quincena entera) menos los que se descuentan, nunca menos de 0. Un
 * día sin fila —el descanso, un asueto, no haber marcado nunca— se paga. Un
 * mismo día contado dos veces no descuenta dos.
 *
 * Talento Humano tiene la última palabra (decisiones del dueño, 2026-10-22):
 *
 *  · Incapacidad: un día ausente que cae en una incapacidad VALIDADA se paga;
 *    uno que cae en una todavía SIN DECISIÓN no se descuenta pero se cuenta en
 *    `pendientes`. Una rechazada no está en ninguna lista: el día se descuenta.
 *  · Suspensión: cada día de una suspensión (salga o no en la asistencia) se
 *    descuenta si Talento Humano la marcó CON descuento, se paga si la marcó
 *    SIN, y si nadie decidió va a `suspensionPendiente`.
 *
 * La planilla no se aprueba mientras haya días pendientes de cualquiera de
 * las dos: ni se pagan ni se descuentan en silencio.
 *
 * @param {Array} timesheets  filas de la persona en la quincena
 * @param {{ contratados?: number, desde?: string, hasta?: string,
 *           incapacidadesValidadas?: Array<{desde, hasta}>,
 *           incapacidadesPendientes?: Array<{desde, hasta}>,
 *           suspensiones?: Array<{desde, hasta, descuento: boolean|null}> }} [opciones]
 */
export function diasPagadosDeQuincena(timesheets, opciones = {}) {
    const { contratados = DIAS_DE_QUINCENA, desde = null, hasta = null,
            incapacidadesValidadas = [], incapacidadesPendientes = [], suspensiones = [] } = opciones;
    const dentro = (dia) => !((desde && dia < desde) || (hasta && dia > hasta));
    const descontar = new Set();
    const pendientes = new Set();
    const suspPendientes = new Set();
    const enSuspension = new Set();
    for (const s of suspensiones || []) {
        if (!s?.desde) continue;
        const fin = s.hasta && s.hasta >= s.desde ? s.hasta : s.desde;
        for (let dia = s.desde; dia <= fin; dia = sumarDias(dia, 1)) {
            if (!dentro(dia)) continue;
            enSuspension.add(dia);
            if (s.descuento === true) descontar.add(dia);
            else if (s.descuento == null) suspPendientes.add(dia);
        }
    }
    // Un día descontado por otra suspensión ya no queda pendiente.
    for (const dia of descontar) suspPendientes.delete(dia);
    for (const ts of timesheets || []) {
        if (!esAusenciaDescontable(ts)) continue;
        const dia = ts.work_date ? String(ts.work_date).slice(0, 10) : null;
        if (dia && !dentro(dia)) continue;
        if (dia && enSuspension.has(dia)) continue;   // lo decide la suspensión
        const clave = dia || `sin-fecha-${descontar.size + pendientes.size}`;
        if (dia) {
            if (enAlgunRango(dia, incapacidadesValidadas)) continue;
            if (enAlgunRango(dia, incapacidadesPendientes)) { pendientes.add(clave); continue; }
        }
        descontar.add(clave);
    }
    const tope = Math.max(0, Math.min(DIAS_DE_QUINCENA, contratados));
    const descontados = Math.min(tope, descontar.size);
    return { dias: tope - descontados, descontados, pendientes: pendientes.size, suspensionPendiente: suspPendientes.size };
}

/**
 * Lo que un renglón espera de Talento Humano, en palabras, o `null` si nada.
 * Lo pintan la planilla web y la app junto al nombre.
 */
export function pendienteDeTH(entry) {
    const inc = Number(entry?.incapacidad_pendiente_dias) || 0;
    const sus = Number(entry?.suspension_pendiente_dias) || 0;
    const partes = [];
    if (inc) partes.push(`${inc} ${inc === 1 ? 'día' : 'días'} de incapacidad sin validar`);
    if (sus) partes.push(`${sus} ${sus === 1 ? 'día' : 'días'} de suspensión sin decidir el descuento`);
    return partes.length ? partes.join(' · ') : null;
}

/**
 * Por qué no se puede aprobar la planilla, o `null` si se puede. Recibe los
 * renglones con algo pendiente de Talento Humano.
 */
//
// Tiene que caber en un aviso: el toast descarta como «volcado» todo texto de
// más de 240 caracteres, y la versión anterior pasaba de ese largo con los dos
// pendientes a la vez — la pantalla decía «No se pudo actualizar el estado.»
// sin explicar nada (prueba en vivo, 2026-10-22). Las cifras cuentan PERSONAS
// (un renglón por persona), y cada parte lleva su propio sustantivo: la versión
// anterior decía «hay 1 persona 1 con suspensión…».
export function mensajeDePendientesDeTH(renglones) {
    const lista = (renglones || []).filter(r => pendienteDeTH(r));
    if (!lista.length) return null;
    const inc = lista.filter(r => Number(r.incapacidad_pendiente_dias) > 0).length;
    const sus = lista.filter(r => Number(r.suspension_pendiente_dias) > 0).length;
    const personas = (n) => `${n} ${n === 1 ? 'persona' : 'personas'}`;
    const que = [
        inc ? `${personas(inc)} con incapacidad sin validar (en Solicitudes)` : null,
        sus ? `${personas(sus)} con suspensión sin decidir el descuento (en su historial)` : null,
    ].filter(Boolean).join(' y ');
    return `Falta que Talento Humano decida: ${que}. Después vuelve a generar la planilla.`;
}

// `descuentoDeSuspension` vive en `./quincena` y se re-exporta acá
// (2026-10-24): la ficha de la persona la pinta en su historial, y por ella
// cargaba este archivo de nómina entero.
export { descuentoDeSuspension };

/**
 * Las suspensiones de cada persona con su decisión de descuento. Una revocada
 * por el reclamo del Art. 77 no cuenta: dejó de existir. Devuelve
 * `Map(employee_id → [{ desde, hasta, descuento, eventoId }])`.
 */
export function suspensionesPorPersona(eventos) {
    const porPersona = new Map();
    for (const ev of eventos || []) {
        if (ev?.type !== 'SUSPENSION' || eventoAnulado(ev)) continue;
        const m = metaDe(ev);
        if (m.reclamo?.estado === 'REVOCADA') continue;
        const r = rangoDe(ev.date, m.endDate);
        if (!r) continue;
        const k = String(ev.employee_id);
        if (!porPersona.has(k)) porPersona.set(k, []);
        porPersona.get(k).push({ ...r, descuento: descuentoDeSuspension(ev), eventoId: ev.id });
    }
    return porPersona;
}


/**
 * Las incapacidades de cada persona, separadas por la decisión de Talento
 * Humano. VALIDADA: una novedad DISABILITY en el legajo (la registra Talento
 * Humano, o nace al aprobar la solicitud) o una solicitud DISABILITY APROBADA
 * —esas solicitudes van directo a Talento Humano—. PENDIENTE: una solicitud
 * DISABILITY todavía PENDING. Las rechazadas no figuran.
 *
 * Devuelve `Map(employee_id → { validadas: [{desde,hasta}], pendientes: [...] })`.
 */
export function incapacidadesPorPersona(eventos, solicitudes) {
    const porPersona = new Map();
    const de = (id) => {
        const k = String(id);
        if (!porPersona.has(k)) porPersona.set(k, { validadas: [], pendientes: [] });
        return porPersona.get(k);
    };
    for (const ev of eventos || []) {
        if (ev?.type !== 'DISABILITY' || eventoAnulado(ev)) continue;
        const r = rangoDe(ev.date, metaDe(ev).endDate);
        if (r) de(ev.employee_id).validadas.push(r);
    }
    for (const req of solicitudes || []) {
        if (req?.type !== 'DISABILITY') continue;
        const m = metaDe(req);
        const r = rangoDe(m.startDate || m.date, m.endDate);
        if (!r) continue;
        if (req.status === 'APPROVED') de(req.employee_id).validadas.push(r);
        else if (req.status === 'PENDING') de(req.employee_id).pendientes.push(r);
    }
    return porPersona;
}

/**
 * La fecha efectiva de baja de cada persona dentro de la quincena: el evento
 * TERMINATION no anulado con fecha DENTRO de la quincena (el día de la firma se
 * paga, así que una baja el día 1 deja ese día). Si hay varias, la
 * primera. Devuelve `Map(employee_id → 'AAAA-MM-DD')`.
 */
export function bajasEnQuincena(eventos, { start, end }) {
    const porPersona = new Map();
    for (const ev of eventos || []) {
        if (ev?.type !== 'TERMINATION' || eventoAnulado(ev)) continue;
        const dia = diaDe(ev.date);
        if (!dia || dia < start || dia > end) continue;
        const k = String(ev.employee_id);
        if (!porPersona.has(k) || dia < porPersona.get(k)) porPersona.set(k, dia);
    }
    return porPersona;
}

/**
 * El día (El Salvador) en que se aprobó una solicitud. La aprobación final deja
 * su `approvedAt` en `approvals`; si no hay (filas viejas), `metadata.decidido_at`
 * y en último caso `updated_at`, que es posterior o igual a la aprobación.
 */
export function diaDeAprobacion(req) {
    if (!req) return null;
    const ap = Array.isArray(req.approvals) && req.approvals.length
        ? req.approvals[req.approvals.length - 1]?.approvedAt
        : null;
    const meta = (req.metadata && typeof req.metadata === 'object') ? req.metadata : {};
    return diaDe(ap ?? meta.decidido_at ?? req.updated_at ?? null);
}

/** La quincena (`start_date`) en la que cae un día. */
const inicioDeQuincena = (dia) => quincenaPorDefecto(dia).start_date;

/**
 * Los anticipos que descuenta una quincena (auditoría 2026-10-21, H5), una sola
 * vez cada uno:
 *
 *  1. Los aprobados en un DÍA (El Salvador) de esta quincena. Antes se elegían
 *     por cuándo se PIDIERON: uno pedido el 14 y aprobado el 17 no caía en ninguna.
 *  2. Los REZAGADOS (decisión del dueño, 2026-10-22): aprobados en una quincena
 *     anterior cuyo período ya está cerrado (aprobado o pagado) sin haberlos
 *     descontado. Pasan a la primera quincena abierta posterior: ésta, si no
 *     hay otra abierta entre su quincena y ésta. Si su quincena sigue en
 *     borrador, se descuentan ahí al regenerarla; si nunca se abrió un período
 *     para ella, no se arrastran (serían anticipos de antes de la planilla).
 *
 * `yaDescontados` es un `Map(request_id → period_id)`: uno ligado a OTRO
 * período se salta; uno ligado a ESTE vuelve a entrar (regenerar lo recalcula).
 * `periodos` es la lista de `payroll_periods` (id, start_date, status), para
 * saber qué quincenas están cerradas.
 *
 * Devuelve `Map(employee_id → { monto, solicitudes: [{ id, monto, rezagado }] })`.
 */
export function anticiposDeLaQuincena(solicitudes, { periodId, start, end }, yaDescontados = new Map(), periodos = []) {
    const quincenas = (periodos || []).filter(p => (p.period_type || 'QUINCENA') === 'QUINCENA');
    const estadoDe = new Map(quincenas.map(p => [String(p.start_date).slice(0, 10), p.status || 'DRAFT']));
    const abiertas = quincenas.filter(p => (p.status || 'DRAFT') === 'DRAFT' && String(p.id) !== String(periodId))
        .map(p => String(p.start_date).slice(0, 10));

    const porPersona = new Map();
    for (const req of solicitudes || []) {
        if (req?.status && req.status !== 'APPROVED') continue;
        const dia = diaDeAprobacion(req);
        if (!dia || dia > end) continue;
        let rezagado = false;
        if (dia < start) {
            const suya = inicioDeQuincena(dia);
            const estado = estadoDe.get(suya);
            if (!estado || estado === 'DRAFT') continue;
            // Otra quincena abierta en el medio la recibe primero.
            if (abiertas.some(a => a > suya && a < start)) continue;
            rezagado = true;
        }
        const otro = yaDescontados.get(String(req.id));
        if (otro != null && String(otro) !== String(periodId)) continue;
        const monto = parseFloat(Number(req.metadata?.amount || 0).toFixed(2));
        if (!(monto > 0)) continue;
        const key = String(req.employee_id);
        const acc = porPersona.get(key) || { monto: 0, solicitudes: [] };
        acc.monto = parseFloat((acc.monto + monto).toFixed(2));
        acc.solicitudes.push({ id: req.id, monto, rezagado });
        porPersona.set(key, acc);
    }
    return porPersona;
}

/**
 * Por qué se puede descontar en «Otros descuentos» (2026-10-28). Antes era un
 * monto sin nombre, y por ahí podía entrar un faltante de caja, que el Código
 * de Trabajo no deja descontar del salario. La lista es la del usuario; «otro»
 * existe para lo que no está, pero exige el detalle escrito. La base tiene el
 * mismo freno (CHECK `payroll_entries_otros_descuentos_con_concepto`): si se
 * cambia uno, se cambia el otro.
 */
export const CONCEPTOS_DE_OTROS_DESCUENTOS = [
    { value: 'prestamo_banco',      label: 'Préstamo de banco' },
    { value: 'cooperativa',         label: 'Cooperativa' },
    { value: 'aseguradora',         label: 'Aseguradora' },
    { value: 'embargo_judicial',    label: 'Embargo judicial' },
    { value: 'pension_alimenticia', label: 'Pensión alimenticia' },
    { value: 'cuota_sindical',      label: 'Cuota sindical' },
    { value: 'otro',                label: 'Otro' },
];

/** El rótulo de un descuento: «Préstamo de banco», o el detalle si es «otro». */
export function rotuloDeOtrosDescuentos(concepto, detalle) {
    if (concepto === 'otro') return String(detalle || '').trim() || 'Otro';
    return CONCEPTOS_DE_OTROS_DESCUENTOS.find((c) => c.value === concepto)?.label || 'Otros descuentos';
}

/** Lo que falta para poder guardar el descuento, o `null` si está completo. */
export function problemaDeOtrosDescuentos(monto, concepto, detalle) {
    if (!(Number(monto) > 0)) return null;
    if (!CONCEPTOS_DE_OTROS_DESCUENTOS.some((c) => c.value === concepto)) {
        return 'Elige el motivo de «Otros descuentos».';
    }
    if (concepto === 'otro' && String(detalle || '').trim().length < 3) {
        return 'Escribe de qué es el descuento.';
    }
    return null;
}

/** Los campos de una fila que se editan a mano, en el orden del formulario. */
export const CAMPOS_EDITABLES_DE_PLANILLA = [
    { key: 'night_hours_ordinary',  label: 'Horas nocturnas ordinarias (25%)', grupo: 'horas' },
    { key: 'night_hours_extra',     label: 'Horas nocturnas extra (50%)',      grupo: 'horas' },
    { key: 'extra_hours_diurnal',   label: 'Horas extra diurnas',              grupo: 'horas' },
    { key: 'extra_hours_nocturnal', label: 'Horas extra nocturnas',            grupo: 'horas' },
    { key: 'holiday_surcharge',     label: 'Recargo de asuetos ($)',           grupo: 'ingresos' },
    { key: 'bonifications',         label: 'Bonificaciones ($)',               grupo: 'ingresos' },
    { key: 'vacation_bonus',        label: 'Bono vacacional ($)',              grupo: 'ingresos' },
    { key: 'viaticos',              label: 'Viáticos ($)',                     grupo: 'ingresos' },
    { key: 'order_discount',        label: 'Orden de descuento ($)',           grupo: 'descuentos' },
    { key: 'other_discounts',       label: 'Otros descuentos ($)',             grupo: 'descuentos' },
    { key: 'salary_advance',        label: 'Adelanto salarial ($)',            grupo: 'descuentos' },
];

/**
 * Lo que queda en el banco de horas extra de una persona, por tipo. Cada fila
 * suma si se GANÓ y resta si se canjeó; nunca baja de cero.
 */
export function saldoDeBancoDeHoras(filas) {
    let diurnal = 0, nocturnal = 0;
    for (const row of filas || []) {
        const sign = row.type === 'EARNED' ? 1 : -1;
        if (row.subtype === 'NOCTURNAL') nocturnal += sign * Number(row.hours || 0);
        else diurnal += sign * Number(row.hours || 0);
    }
    const r = (n) => parseFloat(Math.max(0, n).toFixed(2));
    return { diurnal: r(diurnal), nocturnal: r(nocturnal) };
}

/**
 * Las filas del CSV que se lleva el banco: nombre, banco, cuenta, tipo y
 * monto. Sin la llave de aprobar la planilla, la cuenta sale como `****`.
 */
export function csvDelBanco(entries, { cuentasVisibles }) {
    const r2 = (n) => parseFloat((Number(n) || 0).toFixed(2));
    const filas = (entries || []).map((e) => {
        const emp = e.employee || {};
        const acct = cuentasVisibles ? (emp.account_number || '') : '****';
        return `${emp.name || ''},${emp.bank_name || ''},${acct},${emp.account_type || ''},${r2(e.net_pay).toFixed(2)}`;
    });
    return `Nombre,Banco,Cuenta,Tipo,Monto\n${filas.join('\n')}`;
}
