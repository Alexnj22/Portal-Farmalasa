/**
 * El seguro de vida colectivo: la cuenta y el periodo. Puro — sin red.
 *
 * ── Lo que dijo el usuario (2026-10-14) ────────────────────────────────────
 *
 * «Se paga 6.50 por millar anual de la suma asegurada por persona (5,000)…
 * son 32.50, pero puede variar. El monto asegurado es el mismo para todos.»
 * Se paga cada NOVIEMBRE: el pago de noviembre de 2026 cubre hasta octubre de
 * 2027. Por eso el «año vigente» no es el del calendario — en marzo de 2027
 * el que cuenta todavía es el pago de 2026.
 */

/** La prima por persona: la escrita, o suma × tasa / 1000. */
export function primaPorPersona(poliza) {
    if (!poliza) return null;
    const escrita = poliza.prima_por_persona;
    if (escrita !== null && escrita !== undefined && escrita !== '') return Number(escrita);
    const suma = Number(poliza.suma_asegurada);
    const tasa = Number(poliza.tasa_por_millar);
    if (!Number.isFinite(suma) || !Number.isFinite(tasa)) return null;
    return Math.round(suma * tasa / 10) / 100;   // a centavos
}

/**
 * El año del pago que cubre la fecha dada. Con el pago en noviembre (mes 11):
 * del 1-nov-2026 al 31-oct-2027 → 2026.
 *
 * @param {Date} [hoy]
 * @param {number} [mesDePago] 1–12
 */
export function periodoVigente(hoy = new Date(), mesDePago = 11) {
    const anio = hoy.getFullYear();
    return hoy.getMonth() + 1 >= mesDePago ? anio : anio - 1;
}

/** «nov 2026 – oct 2027» para el pago de 2026. */
export function rotuloDelPeriodo(anio, mesDePago = 11) {
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const ini = MESES[mesDePago - 1];
    const fin = MESES[(mesDePago + 10) % 12];
    const anioFin = mesDePago === 1 ? anio : anio + 1;
    return `${ini} ${anio} – ${fin} ${anioFin}`;
}

/**
 * El estado de una persona frente al seguro.
 *
 * @param {string} employeeId
 * @param {{ anio: number, cubiertos: {employee_id: string|null}[] }|null} pagoVigente
 * @returns {{ clave: 'solvente'|'sin_pago'|'no_cubierto', label: string, variant: string }}
 */
export function estadoEnElSeguro(employeeId, pagoVigente) {
    if (!pagoVigente) {
        return { clave: 'sin_pago', label: 'Pago del año sin registrar', variant: 'warning' };
    }
    const esta = (pagoVigente.cubiertos || []).some(c => c.employee_id === employeeId);
    return esta
        ? { clave: 'solvente', label: `Solvente ${pagoVigente.anio}`, variant: 'success' }
        : { clave: 'no_cubierto', label: `No está en el listado ${pagoVigente.anio}`, variant: 'danger' };
}
