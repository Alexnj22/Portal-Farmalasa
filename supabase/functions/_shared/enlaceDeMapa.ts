// ─────────────────────────────────────────────────────────────────────────────
// El enlace de Google Maps → el punto que marca.
// ─────────────────────────────────────────────────────────────────────────────
//
// Lo usa `maps-proxy` (acción `ubicar`) y lo prueba `tests/unit/enlaceDeMapa`.
// Sin dependencias de Deno a propósito: así la prueba lo importa tal cual.
//
// ── Un enlace trae DOS coordenadas, y sólo una es la de la farmacia ─────────
// Medido el 2026-10-29 con el enlace de La Popular (`maps.app.goo.gl/Bytum…`),
// que redirige a:
//
//   …/place/Farmacia+La+Popular/@14.1862594,-89.5326519,11z/data=…!3d14.1862698!4d-89.2277867…
//
// `@lat,lng,zoom` es el CENTRO DE LA VISTA de quien copió el enlace — acá a
// 30 km de la farmacia, porque tenía el mapa alejado. `!3d…!4d…` es el PIN del
// lugar. Leer el primero que aparece (el `@`) habría puesto la sucursal en el
// medio del campo. Por eso el orden de preferencia es pin → consulta → vista,
// y la vista se devuelve marcada como tal para que la pantalla avise.

/** Los dominios desde los que se acepta un enlace — y los únicos a los que se sigue una redirección. */
// El sufijo va CERRADO (`com`, `com.sv`, `co.uk`, `de`): con `google\.[a-z.]+`
// pasaba `google.com.evil.io`, y el servidor habría seguido una redirección a
// cualquier sitio — la prueba lo cazó.
const SUFIJO = '(?:com|com\\.[a-z]{2}|co\\.[a-z]{2}|[a-z]{2})';
const DOMINIOS = [
  /^maps\.app\.goo\.gl$/,
  /^goo\.gl$/,
  new RegExp(`^(?:www\\.|maps\\.|consent\\.)?google\\.${SUFIJO}$`),
];

export function esDominioDeMapa(host: string): boolean {
  const h = String(host || '').toLowerCase();
  return DOMINIOS.some((re) => re.test(h));
}

export type Precision = 'pin' | 'consulta' | 'vista';
export interface Coordenadas { lat: number; lng: number; precision: Precision }

const valido = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

const par = (a: string, b: string): [number, number] => [Number(a), Number(b)];
const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

/**
 * Las coordenadas que trae un enlace largo de Google Maps, o `null`.
 * No sigue redirecciones: eso es trabajo del servidor (el enlace corto no
 * trae ninguna coordenada hasta que se abre).
 */
export function coordenadasDeEnlace(enlace: string): Coordenadas | null {
  let texto = String(enlace || '').trim();
  if (!texto) return null;
  // La pantalla de consentimiento envuelve el destino en `continue=`.
  try {
    const u = new URL(texto);
    const sigue = u.searchParams.get('continue');
    if (sigue && /consent\./.test(u.hostname)) texto = sigue;
  } catch { /* no es una URL completa: se busca en el texto igual */ }
  try { texto = decodeURIComponent(texto); } catch { /* ya venía decodificado */ }

  // 1 · el pin del lugar — el ÚLTIMO, por si el enlace trae varios (ruta).
  const pines = [...texto.matchAll(new RegExp(`!3d${NUM}!4d${NUM}`, 'g'))];
  for (let i = pines.length - 1; i >= 0; i--) {
    const [lat, lng] = par(pines[i][1], pines[i][2]);
    if (valido(lat, lng)) return { lat, lng, precision: 'pin' };
  }

  // 2 · una consulta por coordenadas: ?q=, query=, ll=, destination=, /search/…
  const consultas = [
    new RegExp(`[?&](?:q|query|ll|destination|daddr|center)=${NUM}\\s*,\\s*\\+?${NUM}`),
    new RegExp(`/(?:search|place|dir)/${NUM}\\s*,\\s*\\+?${NUM}`),
  ];
  for (const re of consultas) {
    const m = texto.match(re);
    if (m) {
      const [lat, lng] = par(m[1], m[2]);
      if (valido(lat, lng)) return { lat, lng, precision: 'consulta' };
    }
  }

  // 3 · el centro de la vista — sirve, pero puede estar lejos del lugar.
  const vista = texto.match(new RegExp(`@${NUM},${NUM}`));
  if (vista) {
    const [lat, lng] = par(vista[1], vista[2]);
    if (valido(lat, lng)) return { lat, lng, precision: 'vista' };
  }
  return null;
}

/** El nombre del lugar que trae el enlace (`/place/Farmacia+La+Popular/`), o `null`. */
export function lugarDeEnlace(enlace: string): string | null {
  const m = String(enlace || '').match(/\/place\/([^/@?]+)/);
  if (!m) return null;
  try {
    const nombre = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
    // Un `/place/14.18,-89.22` es una coordenada, no un nombre.
    return nombre && !/^-?\d/.test(nombre) ? nombre : null;
  } catch { return null; }
}
