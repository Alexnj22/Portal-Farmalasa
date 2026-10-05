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
