// Los kioscos de una sucursal, escritos UNA vez para el portal y para la app:
// cuántos puede tener, cuáles cuentan como vinculados y qué sucursales los
// llevan. Vivían como `3` y `status === 'ACTIVE'` sueltos en `branchSlice`,
// `FormDispositivos`, `BranchDetailView` y la ficha de la app.
//
// Dos tipos desde el 2026-11-17 (`kiosk_devices.tipo`, plan del kiosco de
// caja): el MARCADOR de asistencia y el kiosco de CAJA, que además marca. El
// tope es por tipo y lo decidió el usuario: hasta 3 marcadores y 1 caja por
// sucursal. La base pone el mismo tope (`kiosk_devices_tope`).

export const TIPOS_DE_KIOSCO = Object.freeze({ MARCACION: 'marcacion', CAJA: 'caja' });

/** Tope de equipos vinculados a la vez, por tipo. */
export const LIMITES_DE_KIOSCO = Object.freeze({ marcacion: 3, caja: 1 });

/** Tope de marcadores por sucursal (lo frena `registerKioskDevice`). */
export const LIMITE_KIOSCOS = LIMITES_DE_KIOSCO.marcacion;

/** El tipo de un equipo; uno sin tipo es de antes del 2026-11-17: marcador. */
export const tipoDeKiosco = (k) => (k?.tipo === TIPOS_DE_KIOSCO.CAJA ? TIPOS_DE_KIOSCO.CAJA : TIPOS_DE_KIOSCO.MARCACION);

/** Cómo se nombra cada tipo en pantalla. */
export const rotuloDeKiosco = (tipo) => (tipo === TIPOS_DE_KIOSCO.CAJA ? 'Kiosco de caja' : 'Marcador');

/**
 * Sólo los vinculados de ese tipo: un equipo revocado no marca y no ocupa
 * cupo. Sin tipo, cuenta los marcadores, que es lo que contaban todos los que
 * llamaban esto antes de que existiera la caja. `null` = todos los tipos.
 */
export const kioscosActivos = (lista, tipo = TIPOS_DE_KIOSCO.MARCACION) =>
    (lista ?? []).filter((k) => k?.status === 'ACTIVE' && (tipo === null || tipoDeKiosco(k) === tipo));

/** «N / tope» del tipo y si ya no cabe otro equipo. */
export function cupoDeKioscos(lista, tipo = TIPOS_DE_KIOSCO.MARCACION) {
    const activos = kioscosActivos(lista, tipo).length;
    const limite = LIMITES_DE_KIOSCO[tipo] ?? LIMITE_KIOSCOS;
    return { activos, limite, lleno: activos >= limite, rotulo: `${activos} / ${limite}` };
}

/** Las salas donde se marca: farmacias y bodega. Las demás no llevan kiosco. */
export const sucursalLlevaKiosco = (tipo) => tipo === 'FARMACIA' || tipo === 'BODEGA';
