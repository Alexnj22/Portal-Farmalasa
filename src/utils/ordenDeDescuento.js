/**
 * Orden de descuento: cuánto falta. Puro — sin red.
 *
 * «Así sabemos cuánto tiempo queda de pagar» (usuario, 2026-10-14). No se
 * guarda: se deriva de la fecha de fin y la cuota cada vez, porque un saldo
 * guardado envejece solo.
 */
import { bancoDelTexto } from '../constants/bancos';

const aFecha = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** Cuotas de `desde` a `hasta`, contando la del mes de `hasta`. */
function cuotasEntre(desde, hasta, periodicidad) {
    const meses = (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth()) + 1;
    if (meses <= 0) return 0;
    return periodicidad === 'QUINCENAL' ? meses * 2 : meses;
}

/**
 * @param {{ fecha_inicio?: string, fecha_fin?: string, cuota?: number|string,
 *           plazo_cuotas?: number, periodicidad?: string, estado?: string }} orden
 * @param {Date} [hoy]
 * @returns {{ cuotasRestantes: number|null, saldo: number|null, mesesRestantes: number|null,
 *             avance: number|null, terminada: boolean }}
 */
export function loQueFalta(orden, hoy = new Date()) {
    const fin = aFecha(orden?.fecha_fin);
    const ini = aFecha(orden?.fecha_inicio);
    const cuota = Number(orden?.cuota);
    const per = orden?.periodicidad || 'MENSUAL';
    if (orden?.estado && orden.estado !== 'VIGENTE') {
        return { cuotasRestantes: 0, saldo: 0, mesesRestantes: 0, avance: 1, terminada: true };
    }
    if (!fin) return { cuotasRestantes: null, saldo: null, mesesRestantes: null, avance: null, terminada: false };
    const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    // La cuota de ESTE mes todavía cuenta si no empezó a descontarse antes.
    const desde = ini && ini > hoy0 ? new Date(ini.getFullYear(), ini.getMonth(), 1) : hoy0;
    const restantes = fin < hoy0 ? 0 : cuotasEntre(desde, fin, per);
    const total = orden?.plazo_cuotas || (ini ? cuotasEntre(ini, fin, per) : null);
    return {
        cuotasRestantes: restantes,
        saldo: Number.isFinite(cuota) && cuota > 0 ? Math.round(restantes * cuota * 100) / 100 : null,
        mesesRestantes: per === 'QUINCENAL' ? Math.ceil(restantes / 2) : restantes,
        avance: total ? Math.min(1, Math.max(0, (total - restantes) / total)) : null,
        terminada: restantes === 0,
    };
}

/** Fecha de fin a partir del inicio y el plazo, cuando el papel no la trae. */
export function finDesdePlazo(fechaInicio, plazo, periodicidad = 'MENSUAL') {
    const ini = aFecha(fechaInicio);
    const n = Number(plazo);
    if (!ini || !Number.isInteger(n) || n <= 0) return '';
    const meses = periodicidad === 'QUINCENAL' ? Math.ceil(n / 2) : n;
    const fin = new Date(ini.getFullYear(), ini.getMonth() + meses - 1, ini.getDate());
    const p = (x) => String(x).padStart(2, '0');
    return `${fin.getFullYear()}-${p(fin.getMonth() + 1)}-${p(fin.getDate())}`;
}

const num = (v) => {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : '';
};
const fechaIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : '');

/**
 * Lo que devolvió el lector → los campos del formulario. Todo queda editable;
 * lo que no se leyó queda vacío, nunca inventado.
 */
export function camposDesdeLectura(leido) {
    if (!leido) return {};
    const per = String(leido.periodicidad || '').toUpperCase().includes('QUINC') ? 'QUINCENAL' : 'MENSUAL';
    const campos = {
        banco: bancoDelTexto(leido.banco) || '',
        banco_leido: leido.banco || '',
        referencia: leido.ref ? String(leido.ref) : '',
        monto_prestamo: num(leido.monto),
        tasa_interes: num(leido.tasa),
        cuota: num(leido.cuota),
        plazo_cuotas: Number.isInteger(Number(leido.plazo)) && Number(leido.plazo) > 0 ? Number(leido.plazo) : '',
        periodicidad: per,
        fecha_inicio: fechaIso(leido.inicio),
        fecha_fin: fechaIso(leido.fin),
        nombre_en_documento: leido.nombre ? String(leido.nombre).trim() : '',
    };
    if (!campos.fecha_fin && campos.fecha_inicio && campos.plazo_cuotas) {
        campos.fecha_fin = finDesdePlazo(campos.fecha_inicio, campos.plazo_cuotas, per);
    }
    return campos;
}
