/**
 * Carnés del día — los carnés de papel vivos, con su persona, y agrupados por
 * sucursal. Vivía en `CarnesDelDiaView`; se mudó el 2026-10-05 para que la app
 * muestre la misma lista.
 */
import { shortEmployeeName } from './nameUtils';

export const SIN_SUCURSAL = 'Sin sucursal';

/**
 * Cada carné con quién lo tiene, de qué sala es, por dónde salió el papel y
 * quién lo entregó. La sala es la de la PERSONA, no la de la ticketera: lo que
 * se busca es «quién de tal sala anda con papel». `impreso_en` en null
 * significa «la computadora de quien lo emitió» — se dice así y no se deja en
 * blanco, porque acá sí se sabe.
 */
export function carnesConPersona(vigentes, empleados, sucursales) {
    const porId = new Map((empleados || []).map((e) => [e.id, e]));
    const sala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name || '';
    return (vigentes || []).map((c) => {
        const emp = porId.get(c.employee_id);
        const quien = porId.get(c.emitido_por);
        return {
            ...c,
            empleado: emp || null,
            nombre: emp ? shortEmployeeName(emp) : 'Alguien que ya no está en la lista',
            cargo: emp?.role || '',
            foto: emp?.photo || null,
            sala: sala(emp?.branchId) || SIN_SUCURSAL,
            impresoEn: c.impreso_en ? (sala(c.impreso_en) || `Sucursal ${c.impreso_en}`) : 'La computadora de quien lo emitió',
            loEntrego: quien ? shortEmployeeName(quien) : '—',
        };
    });
}

/** Agrupados por sala, cada grupo por nombre; «Sin sucursal» al final. */
export function carnesPorSala(filas) {
    const mapa = new Map();
    for (const c of filas || []) {
        if (!mapa.has(c.sala)) mapa.set(c.sala, []);
        mapa.get(c.sala).push(c);
    }
    return [...mapa.entries()]
        .map(([sala, items]) => ({ sala, items: [...items].sort((a, b) => a.nombre.localeCompare(b.nombre)) }))
        .sort((a, b) => Number(a.sala === SIN_SUCURSAL) - Number(b.sala === SIN_SUCURSAL) || a.sala.localeCompare(b.sala));
}
