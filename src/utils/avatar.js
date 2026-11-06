/**
 * La escala de la foto de una persona — una sola para el portal y la app
 * (decisión del usuario, 2026-11-05: «al final definiríamos los tamaños
 * aprobados y el diseño, y se usarían solo esos no más»).
 *
 *   20        FIRMA    — al lado de un nombre escrito. Sólo foto y aro.
 *   28 · 36   PERSONA  — aro separado de la foto, torta, «!».
 *   36        + el chip con el ícono del estado.
 *   48 · 64   + la medalla de antigüedad.
 *   104       RETRATO  — la cabecera del perfil de esa persona (2026-11-06).
 *
 * Y la geometría de las marcas, que las dos plataformas tienen que dibujar
 * igual: si cada una calculara su chip, la misma persona se vería distinta en
 * el teléfono y en la computadora.
 */
export const TAMANOS_DE_AVATAR = Object.freeze([20, 28, 36, 48, 64, 104]);

/** El tamaño aprobado más cercano (en empate, el mayor). */
export function tamanoDeAvatar(px) {
  const n = Number(px) || 36;
  return TAMANOS_DE_AVATAR.reduce((mejor, t) =>
    (Math.abs(t - n) < Math.abs(mejor - n) || (Math.abs(t - n) === Math.abs(mejor - n) && t > mejor)) ? t : mejor);
}

/** Qué marcas lleva una foto de `px` y de qué tamaño. */
export function geometriaDeAvatar(px) {
  const firma = px < 28;
  return {
    firma,
    // `aro`: hasta dónde llega el aro medido desde el borde de la foto, CON el
    // filo adentro (el trazo visible es `aro - filo`). Es la `spread` del
    // `box-shadow` del portal; la app lo dibuja igual. No es proporcional a
    // propósito: proporcional es lo que hace desaparecer un aro chico.
    aro: firma ? 1.5 : (px >= 48 ? 4.5 : 4),
    filo: firma ? 0 : 2,
    conChip: px >= 36,
    conMedalla: px >= 48,
    tamChip: Math.round(px * (px >= 48 ? 0.32 : 0.38)),
    tamPendiente: Math.max(13, Math.round(px * 0.26)),
  };
}
