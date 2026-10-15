// Las fichas de apertura de las cajas («Las cajas» arriba de los cortes):
// quién abrió cada caja, desde cuándo, el cruce con su marcación de entrada,
// la venta del día y las piezas del cajón. Vivía dentro de
// `components/cortes/FichasDeCaja.jsx`; la app lo dibuja igual, así que las
// cuentas viven acá y las dos pantallas sólo pintan. El porqué de cada regla
// está en el encabezado de ese componente.
import { formatMoney } from './formatNumber';
import { diaSV, relojSV } from './fecha';

/** «06:55:49» y una marcación → cuántos minutos antes (o después) se marcó. */
export function minutosAntes(abiertaA, marcaIso) {
    if (!abiertaA || !marcaIso) return null;
    const marca = new Date(marcaIso);
    const [h, m] = String(abiertaA).split(':').map(Number);
    // La marcación se compara en hora de sala, que es la del `abierta_a`.
    const enSala = relojSV(marca);
    const minutosMarca = enSala.getUTCHours() * 60 + enSala.getUTCMinutes();
    return (h * 60 + m) - minutosMarca;
}

/** De dónde sale el efectivo del cajón, en una línea y sólo lo que NO es cero. */
export function detalleDelCajon(pz) {
    if (!pz) return '';
    const partes = [];
    const cero = (v) => Math.abs(Number(v) || 0) < 0.005;
    if (!cero(pz.apertura)) partes.push(`abrió con ${formatMoney(pz.apertura)}`);
    if (!cero(pz.entradas)) partes.push(`+${formatMoney(pz.entradas)} de ingresos`);
    if (!cero(pz.vales)) partes.push(`−${formatMoney(pz.vales)} de vales`);
    if (!cero(pz.en_bolsas)) partes.push(`−${formatMoney(pz.en_bolsas)} en bolsas`);
    return partes.join(' · ');
}

/** La PRIMERA marcación de entrada de cada persona en cada día (`id:día` → instante). */
export function primeraEntradaPorPersona(entradas) {
    const pp = new Map();
    for (const e of entradas || []) {
        const clave = `${e.employee_id}:${diaSV(e.timestamp)}`;
        if (!pp.has(clave)) pp.set(clave, e.timestamp);
    }
    return pp;
}

/** Lo vendido por sala y DÍA (`sala:fecha`): efectivo, otras formas y documentos. */
export function ventasPorSalaYDia(ventas) {
    const m = new Map();
    for (const v of ventas || []) {
        const clave = `${v.branch_id}:${v.fecha}`;
        const acc = m.get(clave) || { efectivo: 0, otras: 0, documentos: 0 };
        const monto = Number(v.total) || 0;
        if (String(v.tipo_pago).toLowerCase() === 'efectivo') acc.efectivo += monto;
        else acc.otras += monto;
        acc.documentos += Number(v.documentos) || 0;
        m.set(clave, acc);
    }
    return m;
}

/** Las piezas del cajón por sala y día, tal como las suma la base. */
export const piezasPorSalaYDia = (piezas) => new Map((piezas || []).map((p) => [`${p.branch_id}:${p.fecha}`, p.piezas]));

/** Las abiertas primero, luego la más reciente, luego por sala; a lo sumo 12. */
export function aperturasOrdenadas(aperturas, salas, tope = 12) {
    return [...(aperturas || [])]
        .sort((a, b) => (Number(!!a.cerrada_at) - Number(!!b.cerrada_at))
            || String(b.abierta_el).localeCompare(String(a.abierta_el))
            || String(salas?.get(a.branch_id) || '').localeCompare(String(salas?.get(b.branch_id) || ''), 'es'))
        .slice(0, tope);
}

/** Lo que la ficha dice debajo de quién abrió. */
export function lineaDeQuien({ quien, hayConQueCruzar, dif, apertura }) {
    if (!quien) return 'se abrió desde la caja · no se sabe quién';
    if (!hayConQueCruzar) return `turno ${apertura.turno ?? '—'} · caja ${apertura.caja_erp ?? '—'}`;
    if (dif == null) return 'no marcó entrada';
    return dif >= 0 ? `marcó entrada ${dif} min antes` : `marcó entrada ${Math.abs(dif)} min después`;
}
