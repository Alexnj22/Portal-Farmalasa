/* Las reglas de pago de las horas — decididas por el usuario el 2026-11-23.
 *
 * Base legal (textos en `docs/legal/`): Código de Trabajo (CT) y Reglamento
 * Interno de Trabajo (RIT). Cada regla lleva su artículo al lado, y la versión
 * larga vive en `docs/reglas/reglas-de-pago.md`.
 *
 *  · Horas de más — CT Art. 169: recargo del 100 % sobre el salario básico por
 *    hora; Art. 170: sólo ocasionales. Talento Humano decide en CADA caso si
 *    van a PAGO o al BANCO de horas. Sin decidir, la planilla ni las paga ni
 *    las banca (antes iban al banco solas).
 *  · Nocturno — CT Art. 168: un mínimo de 25 % sobre el salario diurno, desde
 *    las 19:00.
 *  · Día de descanso trabajado — CT Art. 175 / RIT Art. 30: salario básico más
 *    un mínimo de 50 % por las horas trabajadas, y un día de descanso
 *    compensatorio remunerado en la misma semana o la siguiente (CT Art. 176).
 *  · Asueto trabajado — CT Art. 192: salario ordinario más un recargo del
 *    100 %.
 *  · Extra o nocturno EN descanso o asueto — CT Arts. 175 y 192 (inciso 2): el
 *    recargo se calcula sobre el salario extraordinario de ese día.
 *  · Tardanza — RIT Arts. 23 y 26 / CT Art. 171: se suman los minutos tarde de
 *    la SEMANA con 10 de tolerancia; si pasa de 10, o la semana no se completó
 *    sin causa justificada (RIT Art. 25), se PROPONE que pierde el pago del
 *    descanso semanal y Talento Humano lo confirma o lo justifica. Nunca se
 *    descuentan minutos ni horas. Las amonestaciones (RIT Art. 82) no son
 *    automáticas.
 *
 * Interpretación escrita (para revisar con el contador): el sueldo es mensual
 * y ya incluye el pago del descanso y del asueto (CT Art. 174 inciso 2 y
 * Art. 190). Trabajarlos agrega, encima del sueldo, el salario de esas horas
 * con su recargo: × 1,5 en descanso y × 2 en asueto. El compensatorio del
 * descanso (Art. 176) se da como un día libre pagado, que el sueldo ya cubre.
 *
 * Sin dependencias, como `turnoDelDia.js`: lo importan la planilla y la
 * pantalla de asistencia.
 */

export const RECARGO_NOCTURNO = 0.25;   // CT Art. 168
export const RECARGO_EXTRA    = 1.00;   // CT Art. 169
export const RECARGO_DESCANSO = 0.50;   // CT Art. 175 / RIT Art. 30
export const RECARGO_ASUETO   = 1.00;   // CT Art. 192
export const TOLERANCIA_SEMANAL_MIN = 10; // RIT Art. 26

export const DECISION_EXTRA = { PAGO: 'PAGO', BANCO: 'BANCO' };
export const DECISION_DESCANSO = { PIERDE: 'PIERDE', JUSTIFICADO: 'JUSTIFICADO' };

const n = (x) => Number(x) || 0;
const r2 = (x) => Math.round(x * 100) / 100;

/** Qué clase de día fue, para los recargos. El asueto gana si coinciden. */
export function claseDeDia(ts) {
    if (ts?.is_holiday_worked) return 'ASUETO';
    if (ts?.is_rest_day_worked) return 'DESCANSO';
    return 'NORMAL';
}

/** El salario de una hora de ese día, como múltiplo del básico por hora:
 *  1 normal; 1,5 en descanso (Art. 175); 2 en asueto (Art. 192). */
export function factorDelDia(clase) {
    if (clase === 'ASUETO') return 1 + RECARGO_ASUETO;
    if (clase === 'DESCANSO') return 1 + RECARGO_DESCANSO;
    return 1;
}

/**
 * Lo que un día consolidado (`timesheets`) aporta a la planilla.
 *
 * Los días normales devuelven HORAS (las nocturnas ordinarias y las extra
 * pagadas), que `calcPayrollEntry` ya convierte con sus factores. Los de
 * descanso o asueto devuelven un MONTO (`montoDiaEspecial`), porque su base es
 * el salario extraordinario de ese día y no la del día normal. El mismo monto
 * sale también separado por clase —`montoAsueto` (CT Art. 192) o
 * `montoDescanso` (CT Arts. 175 y 176)—: en la boleta son dos renglones
 * (2026-11-23). Un día es de una sola clase, así que uno de los dos es cero y
 * la suma es `montoDiaEspecial`, al centavo.
 */
export function pagoDelDia(ts, tarifaHora) {
    const clase = claseDeDia(ts);
    const f = factorDelDia(clase);
    const regulares = n(ts?.regular_hours);
    const nocturnas = n(ts?.nocturnal_hours);
    const extra = n(ts?.overtime_hours);
    const extraNocturna = Math.min(extra, n(ts?.nocturnal_overtime_hours));
    const extraDiurna = Math.max(0, extra - extraNocturna);
    const decision = ts?.extra_decision ?? null;

    const out = {
        clase,
        horasNocturnasOrdinarias: 0,
        horasExtraPagoDiurnas: 0,
        horasExtraPagoNocturnas: 0,
        montoDiaEspecial: 0,
        montoAsueto: 0,
        montoDescanso: 0,
        bancoDiurnas: 0,
        bancoNocturnas: 0,
        horasPorDecidir: 0,
        compensatorio: clase === 'DESCANSO',   // CT Art. 176
    };

    if (clase === 'NORMAL') {
        out.horasNocturnasOrdinarias = nocturnas;                       // Art. 168
    } else {
        out.montoDiaEspecial += regulares * tarifaHora * f;             // Art. 175 / 192
        out.montoDiaEspecial += nocturnas * tarifaHora * f * RECARGO_NOCTURNO;
    }

    if (extra > 0) {
        if (decision === DECISION_EXTRA.PAGO) {
            if (clase === 'NORMAL') {
                out.horasExtraPagoDiurnas = extraDiurna;               // Art. 169: × 2
                out.horasExtraPagoNocturnas = extraNocturna;           // + Art. 168: × 2,5 (2 + 0,5)
            } else {
                // Arts. 175 / 192 inciso 2: sobre el salario extraordinario del día.
                out.montoDiaEspecial += extraDiurna * tarifaHora * f * (1 + RECARGO_EXTRA);
                // El nocturno se calcula sobre la hora extra: 2 × 1,25 = 2,5.
                out.montoDiaEspecial += extraNocturna * tarifaHora * f * (1 + RECARGO_EXTRA) * (1 + RECARGO_NOCTURNO);
            }
        } else if (decision === DECISION_EXTRA.BANCO) {
            out.bancoDiurnas = extraDiurna;
            out.bancoNocturnas = extraNocturna;
        } else {
            out.horasPorDecidir = extra;                                // ni pago ni banco
        }
    }
    out.montoDiaEspecial = r2(out.montoDiaEspecial);
    if (clase === 'ASUETO') out.montoAsueto = out.montoDiaEspecial;
    if (clase === 'DESCANSO') out.montoDescanso = out.montoDiaEspecial;
    return out;
}

/** La suma de `pagoDelDia` para los días de una persona. */
export function pagoDeLosDias(timesheets, tarifaHora) {
    const t = {
        horasNocturnasOrdinarias: 0, horasExtraPagoDiurnas: 0, horasExtraPagoNocturnas: 0,
        montoDiasEspeciales: 0, montoAsuetos: 0, montoDescansos: 0, bancoDiurnas: 0, bancoNocturnas: 0, horasPorDecidir: 0,
        compensatorios: 0,
    };
    for (const ts of timesheets || []) {
        const d = pagoDelDia(ts, tarifaHora);
        t.horasNocturnasOrdinarias += d.horasNocturnasOrdinarias;
        t.horasExtraPagoDiurnas += d.horasExtraPagoDiurnas;
        t.horasExtraPagoNocturnas += d.horasExtraPagoNocturnas;
        t.montoDiasEspeciales += d.montoDiaEspecial;
        t.montoAsuetos += d.montoAsueto;
        t.montoDescansos += d.montoDescanso;
        t.bancoDiurnas += d.bancoDiurnas;
        t.bancoNocturnas += d.bancoNocturnas;
        t.horasPorDecidir += d.horasPorDecidir;
        if (d.compensatorio) t.compensatorios += 1;
    }
    for (const k of Object.keys(t)) if (k !== 'compensatorios') t[k] = r2(t[k]);
    return t;
}

// ── El descanso semanal (RIT Arts. 23, 25, 26; CT Art. 171) ──────────────────

const diaUTC = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);

/** El lunes (YYYY-MM-DD) de la semana de un día. */
export function lunesDe(fecha) {
    const d = diaUTC(fecha);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return iso(d);
}

/** El domingo de la semana que empieza en `lunes`. */
export function domingoDe(lunes) {
    const d = diaUTC(lunes);
    d.setUTCDate(d.getUTCDate() + 6);
    return iso(d);
}

/**
 * Las semanas en que se PROPONE que la persona pierde el pago del descanso,
 * con la decisión de Talento Humano si ya la hay.
 *
 * Una semana se cuenta en la quincena donde cae su DOMINGO (`desde`–`hasta`):
 * así cada semana se decide una sola vez. Motivos: más de 10 minutos tarde
 * sumando la semana (RIT Art. 26) o una ausencia sin causa justificada
 * (`is_absent` sin tipo: RIT Art. 25, CT Art. 171).
 *
 * @returns {Array<{ employee_id, semana, minutosTarde, incompleta, motivo, decision }>}
 */
export function semanasConDescansoEnDuda(timesheets, decisiones = [], { desde, hasta } = {}) {
    const porClave = new Map();
    for (const ts of timesheets || []) {
        if (!ts?.work_date || !ts?.employee_id) continue;
        const semana = lunesDe(ts.work_date);
        const dom = domingoDe(semana);
        if ((desde && dom < desde) || (hasta && dom > hasta)) continue;
        const clave = `${ts.employee_id}|${semana}`;
        if (!porClave.has(clave)) porClave.set(clave, { employee_id: ts.employee_id, semana, minutosTarde: 0, incompleta: false });
        const s = porClave.get(clave);
        s.minutosTarde += n(ts.late_minutes);
        if (ts.is_absent && !ts.absence_type) s.incompleta = true;
    }
    const dec = new Map((decisiones || []).map(d => [`${d.employee_id}|${String(d.semana).slice(0, 10)}`, d]));
    const out = [];
    for (const [clave, s] of porClave) {
        const tarde = s.minutosTarde > TOLERANCIA_SEMANAL_MIN;
        if (!tarde && !s.incompleta) continue;
        out.push({
            ...s,
            motivo: tarde && s.incompleta ? 'AMBOS' : (tarde ? 'TARDANZA' : 'SEMANA_INCOMPLETA'),
            decision: dec.get(clave)?.decision ?? null,
        });
    }
    return out.sort((a, b) => a.semana.localeCompare(b.semana) || String(a.employee_id).localeCompare(String(b.employee_id)));
}

/** En palabras, para la pantalla. */
export function motivoDelDescanso(s) {
    const tarde = `${s.minutosTarde} min tarde en la semana (tolerancia ${TOLERANCIA_SEMANAL_MIN})`;
    if (s.motivo === 'AMBOS') return `${tarde} y una ausencia sin justificar`;
    if (s.motivo === 'TARDANZA') return tarde;
    return 'Una ausencia sin justificar: la semana no se completó';
}
