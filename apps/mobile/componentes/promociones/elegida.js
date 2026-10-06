// La promoción tocada en la lista: el detalle la lee para tener su nombre,
// estado y tipo al instante (y para las acciones) sin volver a pedir la lista.
let elegida = null;
export const guardarPromocion = (p) => { elegida = p; };
export const promocionElegida = (id) => (elegida && String(elegida.id) === String(id) ? elegida : null);
