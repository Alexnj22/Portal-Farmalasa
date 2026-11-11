import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { boda } from '../config';
import { api } from '../lib/api';
import { t, useIdioma, BotonIdioma } from '../lib/idioma';
import { miId, miNombre, guardarMiNombre } from '../lib/yo';
import { BotonFacil } from '../components/Facil';

/** Los invitados piden canciones y votan las de los demás. El DJ las ve en /dj. */
export default function Canciones() {
  useIdioma();
  const yo = miId();
  const [lista, setLista] = useState([]);
  const [mios, setMios] = useState(new Set());
  const [titulo, setTitulo] = useState('');
  const [artista, setArtista] = useState('');
  const [nombre, setNombre] = useState(miNombre);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = () => {
    api.listarCanciones().then(setLista).catch((e) => setError(e.message));
    api.misVotos(yo).then((v) => setMios(new Set(v))).catch(() => {});
  };
  useEffect(() => { cargar(); return api.suscribirCanciones(cargar); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function pedir(e) {
    e.preventDefault(); setError(''); setEnviando(true);
    try {
      if (nombre.trim()) guardarMiNombre(nombre);
      await api.pedirCancion({ titulo, artista, nombre }, yo);
      setTitulo(''); setArtista(''); cargar();
    } catch (err) { setError(err.message); } finally { setEnviando(false); }
  }
  async function votar(c) {
    const voto = !mios.has(c.id);
    setMios((s) => { const n = new Set(s); voto ? n.add(c.id) : n.delete(c.id); return n; });
    setLista((xs) => xs.map((x) => (x.id === c.id ? { ...x, votos: x.votos + (voto ? 1 : -1) } : x)));
    try { await api.votarCancion(c.id, yo); } catch (err) { setError(err.message); cargar(); }
  }

  const pendientes = lista.filter((c) => !c.tocada);
  const tocadas = lista.filter((c) => c.tocada);
  return (
    <>
      <nav className="nav">
        <div className="contenedor">
          <Link to="/" className="marca">{boda.novios.ella[0]} & {boda.novios.el[0]}</Link>
          <div className="nav-acciones"><BotonFacil /><BotonIdioma /></div>
        </div>
      </nav>
      <main className="contenedor pagina-juego">
        <header className="album-cabeza">
          <p className="versalita suave">{boda.novios.firma}</p>
          <h1>{t('Pide tu', 'Request your')} <em>{t('canción', 'song')}</em></h1>
          <p>{t('Vota las que quieres bailar. Las más votadas suenan primero.', 'Vote for the ones you want to dance to. The most voted play first.')}</p>
        </header>
        <form className="pedir-cancion sobre-oliva" onSubmit={pedir}>
          <label className="campo"><span>{t('Canción', 'Song')}</span><input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} required /></label>
          <label className="campo"><span>{t('Artista (opcional)', 'Artist (optional)')}</span><input value={artista} onChange={(e) => setArtista(e.target.value)} maxLength={80} /></label>
          <label className="campo"><span>{t('Tu nombre (opcional)', 'Your name (optional)')}</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} /></label>
          <button className="btn" disabled={enviando}>{enviando ? t('Enviando…', 'Sending…') : t('Pedirla', 'Request it')}</button>
        </form>
        {error && <p className="aviso error">{error}</p>}
        <ol className="lista-canciones">
          {pendientes.map((c, i) => (
            <li key={c.id}>
              <span className="puesto">{i + 1}</span>
              <span className="cancion-texto"><b>{c.titulo}</b>{c.artista && <small>{c.artista}</small>}</span>
              <button type="button" className={`voto ${mios.has(c.id) ? 'votado' : ''}`} onClick={() => votar(c)} aria-pressed={mios.has(c.id)}
                aria-label={mios.has(c.id) ? t(`Quitar mi voto a ${c.titulo}`, `Remove my vote for ${c.titulo}`) : t(`Votar por ${c.titulo}`, `Vote for ${c.titulo}`)}>
                <span aria-hidden>{mios.has(c.id) ? '♥' : '♡'}</span> {c.votos}
              </button>
            </li>
          ))}
        </ol>
        {!pendientes.length && <p className="suave">{t('Todavía no hay canciones. Pide la primera.', 'No songs yet. Request the first one.')}</p>}
        {tocadas.length > 0 && <>
          <h2 className="subtitulo-lista">{t('Ya sonaron', 'Already played')}</h2>
          <ul className="lista-canciones tocadas">{tocadas.map((c) => <li key={c.id}><span className="cancion-texto"><b>{c.titulo}</b>{c.artista && <small>{c.artista}</small>}</span></li>)}</ul>
        </>}
      </main>
    </>
  );
}
