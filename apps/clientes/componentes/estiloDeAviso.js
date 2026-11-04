// El ícono y el color de cada clase de aviso (2026-10-09). Lo usan la bandeja
// (app/notificaciones.js) y el banner que sale con la app abierta
// (componentes/AvisoEnApp.js): escrito una vez para que un mismo aviso se vea
// igual en los dos sitios. Los colores salen de los acentos del tema.
//
// `tipo` es el de `app_cliente_avisos.tipo` (lo escribe `avisos-clientes`).
// El push no trae el tipo —sólo `data.url`—, así que el banner lo deduce de
// la pantalla a la que lleva (`tipoDeUrl`).

// [SF Symbol, respaldo de texto, acento del tema]
//
// Un solo color (2026-11-03, «demasiados colores, unifica»): la bandeja era un
// arcoíris —azul, violeta, naranja, verde y magenta según el tipo— y el color
// no decía nada que el ícono no dijera ya. Ahora todo va en el magenta de la
// marca, como en Cuenta y el Inicio, y sólo dos conservan color porque ESE
// color es el dato: el verde de lo que se GANA (los puntos, el canon del logo)
// y el naranja de lo que está por VENCER (una advertencia).
const ESTILOS = {
  ganado: ['star.fill', '★', 'verde'],
  restado: ['creditcard.fill', '$', 'magenta'],
  nivel: ['crown.fill', '♛', 'magenta'],
  // Mayoreo: subir de rango, pasar a Mayoreo Plus, ser aprobado.
  mayoreo: ['diamond.fill', '◆', 'magenta'],
  cumpleanos: ['birthday.cake.fill', '🎂', 'magenta'],
  vence: ['hourglass', '⏳', 'naranja'],
  vencimiento: ['hourglass', '⏳', 'naranja'],
  inyeccion: ['syringe.fill', '+', 'magenta'],
  tratamiento: ['pills.fill', '💊', 'magenta'],
  reserva: ['bag.fill', '•', 'magenta'],
  encargo: ['shippingbox.fill', '•', 'magenta'],
  oferta: ['tag.fill', '%', 'magenta'],
  historia: ['sparkles', '✦', 'magenta'],
  // 2026-10-12: la receta revisada y la respuesta del chat.
  receta: ['doc.text.fill', '•', 'magenta'],
  chat: ['bubble.left.and.bubble.right.fill', '•', 'magenta'],
};
const GENERICO = ['bell.fill', '•', 'magenta'];

/** `{ sf, respaldo, fuerte, texto }` del aviso, con los colores del tema `t`. */
export function estiloDeAviso(t, tipo) {
  const [sf, respaldo, acento] = ESTILOS[tipo] ?? GENERICO;
  const a = t.acentos[acento] ?? t.acentos.magenta;
  return { sf, respaldo, fuerte: a.fuerte, texto: a.texto };
}

/** La clase de aviso a partir de la pantalla que abre (el push sólo trae la url). */
export function tipoDeUrl(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('/oferta')) return 'oferta';
  if (url.startsWith('/inyecciones')) return 'inyeccion';
  if (url.startsWith('/tratamientos')) return 'tratamiento';
  if (url.startsWith('/reservas')) return 'reserva';
  if (url.startsWith('/chat')) return 'chat';
  if (url.includes('cumple=')) return 'cumpleanos';
  if (url.includes('nivel=')) return 'nivel';
  if (url.includes('rango=') || url.includes('precio=') || url.includes('mayoreo=')) return 'mayoreo';
  if (url.startsWith('/puntos')) return 'ganado';
  return null;
}
