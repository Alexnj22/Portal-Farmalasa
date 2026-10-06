// La pieza abierta y su mes: la lista los deja acá al tocar y la pantalla de
// la pieza los lee, para no volver a pedir lo que ya está en pantalla.
let elegida = null;
export const guardarPieza = (pieza, mes, firmas) => { elegida = { pieza, mes, firmas }; };
export const piezaElegida = () => elegida;
