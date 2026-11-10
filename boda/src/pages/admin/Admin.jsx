import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, modoDemo } from '../../lib/api';
import { boda } from '../../config';
import Resumen from './Resumen';
import Invitados from './Invitados';
import Mesas from './Mesas';
import FotosAdmin from './FotosAdmin';
import MensajesAdmin from './MensajesAdmin';
import Compartir from './Compartir';

const PESTANAS = [
  ['resumen', 'Resumen'], ['invitados', 'Invitados'], ['mesas', 'Mesas'],
  ['album', 'Álbum'], ['mensajes', 'Mensajes'], ['compartir', 'QR y enlaces'],
];

export default function Admin() {
  const [usuario, setUsuario] = useState(undefined);
  const [pestana, setPestana] = useState(() => new URLSearchParams(window.location.search).get('p') || 'resumen');
  const [grupos, setGrupos] = useState([]);
  const [mesas, setMesas] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => { api.sesion().then(setUsuario).catch(() => setUsuario(null)); }, []);

  const recargar = useCallback(async () => {
    try {
      const [g, m] = await Promise.all([api.listarGrupos(), api.listarMesas()]);
      setGrupos(g); setMesas(m); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { if (usuario) recargar(); }, [usuario, recargar]);

  const irA = (p) => {
    setPestana(p);
    const u = new URL(window.location.href); u.searchParams.set('p', p);
    window.history.replaceState(null, '', u);
  };

  if (usuario === undefined) return <p className="centro suave" style={{ padding: 60 }}>Cargando…</p>;
  if (!usuario) return <Login alEntrar={setUsuario} />;

  const props = { grupos, mesas, recargar };
  return (
    <div className="admin contenedor">
      <div className="herramientas" style={{ justifyContent: 'space-between' }}>
        <div>
          <span className="script" style={{ fontSize: '2rem' }}>{boda.novios.firma}</span>
          <span className="suave chico" style={{ marginLeft: 10 }}>Panel de la boda</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn claro chico" to="/">Ver el sitio</Link>
          <button className="btn claro chico" onClick={async () => { await api.logout(); setUsuario(null); }}>Salir</button>
        </div>
      </div>
      <div className="pestanas" role="tablist">
        {PESTANAS.map(([id, t]) => (
          <button key={id} role="tab" aria-selected={pestana === id} className={pestana === id ? 'activo' : ''} onClick={() => irA(id)}>{t}</button>
        ))}
      </div>
      {error && <p className="aviso error">{error}</p>}
      {pestana === 'resumen' && <Resumen {...props} />}
      {pestana === 'invitados' && <Invitados {...props} />}
      {pestana === 'mesas' && <Mesas {...props} />}
      {pestana === 'album' && <FotosAdmin />}
      {pestana === 'mensajes' && <MensajesAdmin grupos={grupos} />}
      {pestana === 'compartir' && <Compartir mesas={mesas} />}
      {modoDemo && (
        <p className="chico suave centro" style={{ marginTop: 40 }}>
          <button className="btn peligro chico" onClick={() => { if (confirm('¿Borrar todo y volver a los datos de ejemplo?')) { api.reiniciarDemo(); recargar(); } }}>Reiniciar la demo</button>
        </p>
      )}
    </div>
  );
}

function Login({ alEntrar }) {
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  return (
    <div className="angosto" style={{ maxWidth: 400, padding: '80px 0' }}>
      <form className="tarjeta" onSubmit={async (e) => {
        e.preventDefault(); setCargando(true); setError('');
        try { await api.login(email, clave); alEntrar(email || 'demo'); }
        catch (err) { setError(err.message); }
        finally { setCargando(false); }
      }}>
        <h2 className="centro" style={{ fontSize: '2rem' }}>Panel de la boda</h2>
        {modoDemo && <p className="aviso">Modo demo: cualquier correo y la contraseña <b>demo</b>.</p>}
        <label className="campo"><span>Correo</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required={!modoDemo} autoComplete="username" /></label>
        <label className="campo"><span>Contraseña</span><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="current-password" /></label>
        {error && <p className="aviso error">{error}</p>}
        <button className="btn" style={{ width: '100%' }} disabled={cargando}>{cargando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
