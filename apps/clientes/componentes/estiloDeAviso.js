// El ícono y el color de cada clase de aviso (2026-10-09). Lo usan la bandeja
// (app/notificaciones.js) y el banner que sale con la app abierta
// (componentes/AvisoEnApp.js): escrito una vez para que un mismo aviso se vea
// igual en los dos sitios. Los colores salen de los acentos del tema.
//
// `tipo` es el de `app_cliente_avisos.tipo` (lo escribe `avisos-clientes`).
// El push no trae el tipo —sólo `data.url`—, así que el banner lo deduce de
// la pantalla a la que lleva (`tipoDeUrl`).

// [SF Symbol, respaldo de texto, acento del tema]
const ESTILOS = {
  ganado: ['star.fill', '★', 'verde'],
  restado: ['creditcard.fill', '$', 'azul'],
  nivel: ['crown.fill', '♛', 'violeta'],
  // Mayoreo: subir de rango, pasar a Mayoreo Plus, ser aprobado.
  mayoreo: ['diamond.fill', '◆', 'azul'],
  cumpleanos: ['birthday.cake.fill', '🎂', 'magenta'],
  vence: ['hourglass', '⏳', 'naranja'],
  vencimiento: ['hourglass', '⏳', 'naranja'],
  inyeccion: ['syringe.fill', '+', 'azul'],
  tratamiento: ['pills.fill', '💊', 'verde'],
  reserva: ['bag.fill', '•', 'naranja'],
  encargo: ['shippingbox.fill', '•', 'naranja'],
  oferta: ['tag.fill', '%', 'magenta'],
  historia: ['sparkles', '✦', 'magenta'],
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
  if (url.includes('cumple=')) return 'cumpleanos';
  if (url.includes('nivel=')) return 'nivel';
  if (url.includes('rango=') || url.includes('precio=') || url.includes('mayoreo=')) return 'mayoreo';
  if (url.startsWith('/puntos')) return 'ganado';
  return null;
}
