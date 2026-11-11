import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { t, useIdioma } from '../lib/idioma';
import { miId, miNombre, guardarMiNombre } from '../lib/yo';
import { buscarCanciones, leerEnlace, fuenteDeEnlace } from '../lib/musica';
import { PaginaApp } from '../components/AppMarco';
import Icono from '../components/Iconos';

/** Una sola muestra suena a la vez en toda la página. */
let sonando = null;
function Muestra({ url }) {
  const [on, setOn] = useState(false);
  const a = useRef(null);
  useEffect(() => () => a.current?.pause(), []);
  if (!url) return null;
  const alternar = (e) => {
    e.stopPropagation();
    if (!a.current) { a.current = new Audio(url); a.current.onended = () => setOn(false); a.current.onpause = () => setOn(false); }
    if (on) { a.current.pause(); return; }
    if (sonando && sonando !== a.current) sonando.pause();
    sonando = a.current; a.current.play().then(() => setOn(true)).catch(() => {});
  };
  return (
    <button type="button" className={`muestra ${on ? 'sonando' : ''}`} onClick={alternar} aria-label={on ? t('Pausar muestra', 'Pause preview') : t('Escuchar 30 segundos', 'Play 30-second preview')}>
      <Icono n={on ? 'pausa' : 'play'} tam={16} grueso={on ? 2.6 : 1.8} />
    </button>
  );
}

function Portada({ src }) {
  return src ? <img className="portada-cancion" src={src} alt="" loading="lazy" /> : <span className="portada-cancion vacia"><Icono n="musica" tam={20} /></span>;
}

/** Los invitados buscan, piden y votan canciones. El DJ las ve en /dj. */
export default function Canciones() {
  useIdioma();
  const yo = miId();
  const [lista, setLista] = useState([]);
  const [mios, setMios] = useState(new Set());
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState(null); // null = sin buscar
  const [buscando, setBuscando] = useState(false);
  const [sinRed, setSinRed] = useState(false);
  const [nombre, setNombre] = useState(miNombre);
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState('');

  const cargar = () => {
    api.listarCanciones().then(setLista).catch((e) => setError(e.message));
    api.misVotos(yo).then((v) => setMios(new Set(v))).catch(() => {});
  };
  useEffect(() => { cargar(); return api.suscribirCanciones(cargar); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Buscar mientras se escribe (o leer el enlace si pegaron uno).
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) { setResultados(null); return undefined; }
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      setBuscando(true); setError('');
      try {
        if (/^https?:\/\//.test(texto)) setResultados([await leerEnlace(texto)]);
        else { setResultados(await buscarCanciones(texto, { senal: ctl.signal })); setSinRed(false); }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (/^https?:/.test(texto)) setError(e.message); else { setSinRed(true); setResultados([]); }
      } finally { setBuscando(false); }
    }, 350);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q]);

  async function pedir(c) {
    setError('');
    try {
      if (nombre.trim()) guardarMiNombre(nombre);
      await api.pedirCancion({ ...c, nombre }, yo);
      setQ(''); setResultados(null); setHecho(c.titulo); setTimeout(() => setHecho(''), 3500);
      cargar();
    } catch (err) { setError(err.message); }
  }
  async function votar(c) {
    const voto = !mios.has(c.id);
    setMios((s) => { const n = new Set(s); voto ? n.add(c.id) : n.delete(c.id); return n; });
    setLista((xs) => xs.map((x) => (x.id === c.id ? { ...x, votos: x.votos + (voto ? 1 : -1) } : x)));
    try { await api.votarCancion(c.id, yo); } catch (err) { setError(err.message); cargar(); }
  }

  const pendientes = lista.filter((c) => !c.tocada);
  const tocadas = lista.filter((c) => c.tocada);
  const texto = q.trim();
  return (
    <PaginaApp titulo={<>{t('Pide tu', 'Request your')} <em>{t('canción', 'song')}</em></>} bajada={t('Búscala, escúchala y pídela. Las más votadas suenan primero.', 'Find it, preview it, request it. The most voted play first.')}>
      <div className="buscador-cancion">
        <label className="campo-busqueda">
          <Icono n="buscar" tam={22} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Canción o artista… o pega un enlace', 'Song or artist… or paste a link')}
            aria-label={t('Buscar canción', 'Search song')} enterKeyHint="search" autoComplete="off" />
          {q && <button type="button" className="limpiar" onClick={() => setQ('')} aria-label={t('Borrar', 'Clear')}>×</button>}
        </label>
        <p className="fuentes-musica">
          <span>{t('Funciona con', 'Works with')}</span>
          <b className="f-spotify">Spotify</b><b className="f-apple">Apple Music</b><b className="f-youtube">YouTube</b>
        </p>
        {hecho && <p className="aviso ok" role="status">✓ {t(`Pediste «${hecho}». ¡Gracias!`, `You requested “${hecho}”. Thanks!`)}</p>}
        {error && <p className="aviso error">{error}</p>}
        {buscando && <p className="suave">{t('Buscando…', 'Searching…')}</p>}
        {resultados && !buscando && (
          <ul className="resultados-cancion">
            {resultados.map((c, i) => (
              <li key={i}>
                <Portada src={c.portada} />
                <span className="cancion-texto"><b>{c.titulo}</b>{c.artista && <small>{c.artista}</small>}</span>
                <Muestra url={c.muestra} />
                <button type="button" className="btn chico" onClick={() => pedir(c)}>{t('Pedir', 'Request')}</button>
              </li>
            ))}
            {!resultados.length && texto && !/^https?:/.test(texto) && (
              <li className="sin-resultados">
                <span className="cancion-texto"><b>{sinRed ? t('No pudimos buscar ahora', "Couldn't search right now") : t('No la encontramos', "We didn't find it")}</b><small>{t('Pídela tal cual la escribiste', 'Request it as you typed it')}</small></span>
                <button type="button" className="btn chico" onClick={() => pedir({ titulo: texto })}>{t('Pedir', 'Request')} «{texto.slice(0, 24)}»</button>
              </li>
            )}
          </ul>
        )}
        <details className="mas-opciones">
          <summary>{t('Tu nombre (opcional)', 'Your name (optional)')}</summary>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder={t('Para que el DJ sepa quién la pidió', 'So the DJ knows who asked')} />
        </details>
      </div>

      <h2 className="sub-app">{t('Lo más pedido', 'Most requested')}</h2>
      <ol className="lista-canciones">
        {pendientes.map((c, i) => (
          <li key={c.id}>
            <span className="puesto">{i + 1}</span>
            <Portada src={c.portada} />
            <span className="cancion-texto"><b>{c.titulo}</b>{c.artista && <small>{c.artista}{fuenteDeEnlace(c.enlace || '') === 'spotify' ? ' · Spotify' : ''}</small>}</span>
            <Muestra url={c.muestra} />
            <button type="button" className={`voto ${mios.has(c.id) ? 'votado' : ''}`} onClick={() => votar(c)} aria-pressed={mios.has(c.id)}
              aria-label={mios.has(c.id) ? t(`Quitar mi voto a ${c.titulo}`, `Remove my vote for ${c.titulo}`) : t(`Votar por ${c.titulo}`, `Vote for ${c.titulo}`)}>
              <span aria-hidden>{mios.has(c.id) ? '♥' : '♡'}</span> {c.votos}
            </button>
          </li>
        ))}
      </ol>
      {!pendientes.length && <p className="suave">{t('Todavía no hay canciones. Pide la primera.', 'No songs yet. Request the first one.')}</p>}
      {tocadas.length > 0 && <>
        <h2 className="sub-app">{t('Ya sonaron', 'Already played')}</h2>
        <ul className="lista-canciones tocadas">{tocadas.map((c) => <li key={c.id}><Portada src={c.portada} /><span className="cancion-texto"><b>{c.titulo}</b>{c.artista && <small>{c.artista}</small>}</span></li>)}</ul>
      </>}
    </PaginaApp>
  );
}
