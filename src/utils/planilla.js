/**
 * Planilla — lo puro de la nómina: el orden por cargo, el estado de un período,
 * cómo se nombra la quincena y el monto en letras de la boleta. Vivía en
 * `PayrollView`; se mudó el 2026-10-05 para que la app diga lo mismo.
 */
import { fechaNumerica, fechaTexto } from './fecha';

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
            { rotulo: 'Otros descuentos',   monto: r2(e.other_discounts) },
            { rotulo: 'Adelanto salarial',  monto: r2(e.salary_advance) },
        ]),
        totalDescuentos: r2(e.total_deductions),
        liquido: r2(e.net_pay),
    };
}

/**
 * La quincena que se propone al abrir un período nuevo: la que corre hoy.
 * Del 1 al 15, o del 16 al último día del mes. `hoy` es 'AAAA-MM-DD' (hora de
 * El Salvador); el último día se calcula sin `toISOString`, que en UTC puede
 * caer en el mes siguiente.
 */
export function quincenaPorDefecto(hoy) {
    const [a, m, d] = String(hoy).split('-').map(Number);
    const mm = String(m).padStart(2, '0');
    if (d <= 15) return { start_date: `${a}-${mm}-01`, end_date: `${a}-${mm}-15` };
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    return { start_date: `${a}-${mm}-16`, end_date: `${a}-${mm}-${String(ultimo).padStart(2, '0')}` };
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
