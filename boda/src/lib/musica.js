// Búsqueda de canciones sin cuentas ni claves:
//   · el catálogo de Apple (iTunes Search API) o el de Deezer dan título,
//     artista, carátula, enlace y una muestra de 30 s;
//   · un enlace pegado de Spotify, YouTube o Apple Music se lee con oEmbed
//     (noembed.com) para sacar el título y la carátula.
// Spotify y YouTube no tienen búsqueda pública sin cuenta: se ofrecen como
// enlaces de búsqueda para el DJ.

// En el iPhone, el catálogo de Apple redirige a la app Música (`musics://`) y
// el navegador corta la respuesta. Entonces se busca en Deezer, que también es
// público y sin cuenta, por JSONP (no manda cabecera CORS).
let jsonpN = 0;
function jsonp(url, senal) {
  return new Promise((ok, mal) => {
    const nombre = `__musica${++jsonpN}`;
    const s = document.createElement('script');
    const fin = () => { delete window[nombre]; s.remove(); clearTimeout(reloj); };
    const reloj = setTimeout(() => { fin(); mal(new Error('No se pudo buscar')); }, 8000);
    window[nombre] = (d) => { fin(); ok(d); };
    s.onerror = () => { fin(); mal(new Error('No se pudo buscar')); };
    senal?.addEventListener('abort', () => { fin(); mal(new DOMException('abortado', 'AbortError')); });
    s.src = `${url}${url.includes('?') ? '&' : '?'}callback=${nombre}`;
    document.head.appendChild(s);
  });
}

async function enApple(q, senal) {
  const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=10&country=US&term=${encodeURIComponent(q)}`, { signal: senal });
  if (!r.ok) throw new Error('No se pudo buscar');
  const { results } = await r.json();
  return results.map((x) => ({
    titulo: x.trackName, artista: x.artistName,
    portada: x.artworkUrl100?.replace('100x100', '300x300') || null,
    enlace: x.trackViewUrl || null, muestra: x.previewUrl || null,
  }));
}
async function enDeezer(q, senal) {
  const d = await jsonp(`https://api.deezer.com/search?limit=10&output=jsonp&q=${encodeURIComponent(q)}`, senal);
  if (d.error) throw new Error('No se pudo buscar');
  return (d.data || []).map((x) => ({
    titulo: x.title, artista: x.artist?.name || null,
    portada: x.album?.cover_medium || null, enlace: x.link || null, muestra: x.preview || null,
  }));
}

const esIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function buscarCanciones(q, { senal } = {}) {
  const orden = esIphone() ? [enDeezer, enApple] : [enApple, enDeezer];
  let ultimo;
  for (const buscar of orden) {
    try { return (await buscar(q, senal)).filter((x) => x.titulo); } catch (e) {
      if (e.name === 'AbortError') throw e;
      ultimo = e;
    }
  }
  throw ultimo;
}

const FUENTES = [
  [/open\.spotify\.com\/(intl-\w+\/)?track\//, 'spotify'],
  [/(youtube\.com\/(watch|shorts)|youtu\.be\/|music\.youtube\.com)/, 'youtube'],
  [/music\.apple\.com\//, 'apple'],
];
export const fuenteDeEnlace = (u) => FUENTES.find(([re]) => re.test(u))?.[1] || null;

export async function leerEnlace(url) {
  const fuente = fuenteDeEnlace(url);
  if (!fuente) throw new Error('Pega un enlace de una canción de Spotify, YouTube o Apple Music.');
  const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
  const d = await r.json();
  if (d.error || !d.title) throw new Error('No pudimos leer ese enlace. Escribe el nombre de la canción.');
  // YouTube suele traer «Artista - Canción (Video oficial)».
  let titulo = d.title.replace(/\s*[([](official|video|lyric|audio|oficial|letra)[^)\]]*[)\]]/gi, '').trim();
  let artista = d.author_name?.replace(/ - Topic$/, '') || null;
  const partes = titulo.split(/\s[-–]\s/);
  if (fuente === 'youtube' && partes.length === 2) { [artista, titulo] = partes; }
  return { titulo, artista, portada: d.thumbnail_url || null, enlace: url, muestra: null };
}

const q = (c) => encodeURIComponent(`${c.titulo} ${c.artista || ''}`.trim());
export const enlaceSpotify = (c) => (fuenteDeEnlace(c.enlace || '') === 'spotify' ? c.enlace : `https://open.spotify.com/search/${q(c)}`);
export const enlaceYoutube = (c) => (fuenteDeEnlace(c.enlace || '') === 'youtube' ? c.enlace : `https://www.youtube.com/results?search_query=${q(c)}`);
export const enlaceApple = (c) => (fuenteDeEnlace(c.enlace || '') === 'apple' ? c.enlace : `https://music.apple.com/search?term=${q(c)}`);
