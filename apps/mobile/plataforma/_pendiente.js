// Lo que la app todavía no hace, dicho en voz alta: un adaptador que devuelve
// un vacío en silencio se lee como «no hay datos», que es justo el modo de
// falla que el núcleo portable vino a cerrar.
export function pendiente(que) {
  const e = new Error(`Todavía no disponible en la app: ${que}.`);
  e.code = 'PENDIENTE_EN_LA_APP';
  return e;
}
