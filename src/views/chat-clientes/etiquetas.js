// Cómo se rotula a un cliente en el chat: su tipo y su nivel del programa de
// puntos. Módulo aparte —sin componentes— para no romper el fast refresh.

// Las claves de `puntos_niveles` (vip es el primer nivel y se llama Bronce).
export const NIVELES = {
    vip:     { label: 'Bronce',  variant: 'chart-4' },
    plata:   { label: 'Plata',   variant: 'neutral' },
    oro:     { label: 'Oro',     variant: 'warning' },
    platino: { label: 'Platino', variant: 'info' },
};

/** «Team» (es del equipo), «Mayoreo <rango>» o «Cliente». */
export function tipoDeCliente(c) {
    if (c?.es_team) return { label: 'Team', variant: 'chart-1' };
    if (c?.es_mayoreo) return { label: `Mayoreo${c.rango ? ` ${c.rango}` : ''}`, variant: 'chart-9' };
    return { label: 'Cliente', variant: 'neutral' };
}

/** Dos iniciales del nombre del cliente, para cuando no tiene foto. */
export function inicialesDeCliente(nombre) {
    const partes = String(nombre ?? '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    return ((partes[0][0] ?? '') + (partes.length > 2 ? partes[2][0] : partes[1]?.[0] ?? '')).toUpperCase();
}

/** El nombre del cliente con mayúscula inicial (la ficha lo guarda en mayúsculas). */
export function nombreDeCliente(nombre) {
    return String(nombre ?? '').trim().toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase()) || 'Cliente';
}
