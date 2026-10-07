// Los kioscos de marcación de una sucursal, escritos UNA vez para el portal y
// para la app: cuántos puede tener, cuáles cuentan como vinculados y qué
// sucursales los llevan. Vivían como `3` y `status === 'ACTIVE'` sueltos en
// `branchSlice`, `FormDispositivos`, `BranchDetailView` y la ficha de la app.

/** Tope de equipos vinculados a la vez por sucursal (lo frena `registerKioskDevice`). */
export const LIMITE_KIOSCOS = 3;

/** Sólo los vinculados: un equipo revocado no marca y no ocupa cupo. */
export const kioscosActivos = (lista) => (lista ?? []).filter((k) => k?.status === 'ACTIVE');

/** «N / 3» y si ya no cabe otro equipo. */
export function cupoDeKioscos(lista) {
    const activos = kioscosActivos(lista).length;
    return { activos, limite: LIMITE_KIOSCOS, lleno: activos >= LIMITE_KIOSCOS, rotulo: `${activos} / ${LIMITE_KIOSCOS}` };
}

/** Las salas donde se marca: farmacias y bodega. Las demás no llevan kiosco. */
export const sucursalLlevaKiosco = (tipo) => tipo === 'FARMACIA' || tipo === 'BODEGA';
