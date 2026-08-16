/**
 * ¿Este `paste` lo pidió una PERSONA, o lo hizo un gestor de contraseñas?
 *
 * La pregunta existe porque bloquear el pegado en un formulario de
 * credenciales es fácil de escribir y fácil de romper: el 2026-08-16 el
 * bloqueo del login dejó al usuario sin poder entrar —el gestor rellenaba el
 * usuario y la contraseña quedaba vacía— y hubo que corregirlo dos veces.
 *
 * **`isTrusted` NO alcanza.** Fue el primer intento: la idea era que una
 * extensión dispara eventos sintéticos (`isTrusted: false`) y una persona no.
 * Pero muchos gestores rellenan con `document.execCommand('paste')`, y ese
 * evento lo genera el navegador: llega `isTrusted: true`, idéntico a un
 * Ctrl+V. Con esa regla el candado seguía cerrado para el gestor.
 *
 * **Lo que sí distingue a la persona es el ATAJO.** Su pegado viene precedido
 * por su propio `Ctrl/Cmd+V`, milisegundos antes. El del gestor no viene
 * precedido de nada. `isTrusted` se conserva como segunda condición: un
 * evento sintético nunca es de una persona, tenga o no un atajo cerca.
 *
 * Queda una rendija a propósito: pegar desde el menú contextual del navegador.
 * Cerrarla exigiría bloquear el clic derecho sobre el campo, que es justo
 * donde varios gestores ponen su «rellenar contraseña».
 */

// Margen entre el atajo y el evento de pegado. 400ms es holgado para el
// navegador y corto para que dos acciones distintas se confundan.
export const VENTANA_ATAJO_MS = 400;

/** ¿La tecla que se acaba de pulsar es el atajo de pegar? */
export const esAtajoDePegar = (evento) =>
    Boolean(evento && (evento.ctrlKey || evento.metaKey) && String(evento.key).toLowerCase() === 'v');

/**
 * @param {object} p
 * @param {boolean} p.confiable      `event.isTrusted` del evento de pegado
 * @param {number}  p.ahora          marca de tiempo del pegado
 * @param {number}  p.ultimoAtajo    marca de tiempo del último Ctrl/Cmd+V (0 si nunca)
 */
export const esPegadoDeUnaPersona = ({ confiable, ahora, ultimoAtajo }) =>
    !!confiable && Number.isFinite(ultimoAtajo) && (ahora - ultimoAtajo) < VENTANA_ATAJO_MS;
