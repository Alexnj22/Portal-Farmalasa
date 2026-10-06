// La encuesta interna (y, al capturar, la respuesta) abiertas: la lista las
// deja acá al tocar y la pantalla de edición las lee.
let abierta = null;
export const guardarEncuestaInterna = (encuesta, respuesta = null) => { abierta = { encuesta, respuesta }; };
export const encuestaInternaAbierta = () => abierta;
