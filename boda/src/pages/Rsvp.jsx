import { useState } from 'react';
import { boda } from '../config';
import { api } from '../lib/api';
import { limiteConfirmar } from '../lib/fechas';

const vencido = () => new Date() > new Date(`${boda.confirmarAntesDe}T23:59:59`);

export default function Rsvp({ codigo, invitacion, alResponder, cerrado }) {
  const { grupo, personas } = invitacion;
  const [editando, setEditando] = useState(!grupo.respondido_at);
  const [filas, setFilas] = useState(() => {
    const f = personas.map((p) => ({ ...p, restriccion: p.restriccion || '' }));
    for (let i = f.length; i < grupo.pases; i++) f.push({ id: null, nombre: '', asistira: null, restriccion: '', extra: true });
    return f;
  });
  const [mensaje, setMensaje] = useState(grupo.mensaje || '');
  const [cancion, setCancion] = useState(grupo.cancion || '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const cambiar = (i, k, v) => setFilas((f) => f.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  const todosNo = () => setFilas((f) => f.map((x) => ({ ...x, asistira: false })));

  async function enviar(e) {
    e.preventDefault();
    setError('');
    const validas = filas.filter((f) => !f.extra || f.nombre.trim());
    if (validas.some((f) => f.asistira == null)) { setError('Indica si cada persona asistirá.'); return; }
    if (filas.some((f) => f.extra && !f.nombre.trim() && f.asistira)) { setError('Escribe el nombre de tu acompañante.'); return; }
    setEnviando(true);
    try {
      const r = await api.responder(codigo, {
        personas: validas.map(({ id, nombre, asistira, restriccion }) => ({ id, nombre, asistira, restriccion })),
        mensaje, cancion,
      });
      alResponder(r);
      setEditando(false);
      window.scrollTo({ top: document.getElementById('confirmar').offsetTop - 60, behavior: 'smooth' });
    } catch (err) {
      setError(err.message || 'No se pudo enviar. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  const sobre = (
    <div className="sobre" style={{ marginBottom: 20 }}>
      <p className="suave chico" style={{ letterSpacing: '.2em', textTransform: 'uppercase' }}>Invitación para</p>
      <p className="script" style={{ fontSize: '2.4rem', color: 'var(--oro)', margin: 0 }}>{grupo.nombre}</p>
      <p className="suave">Hemos reservado <b>{grupo.pases} {grupo.pases === 1 ? 'lugar' : 'lugares'}</b> en tu honor.</p>
    </div>
  );

  if (!editando) {
    const van = personas.filter((p) => p.asistira);
    const mesas = [...new Set(van.map((p) => p.mesa).filter(Boolean))];
    return (
      <>
        {sobre}
        <div className="tarjeta centro">
          {van.length ? <>
            <h3>¡Gracias por confirmar! 🎉</h3>
            <p>Te esperamos: {van.map((p) => p.nombre).join(', ')}.</p>
            {mesas.length > 0 && (
              <p style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem' }}>Tu mesa: <b>{mesas.join(' y ')}</b></p>
            )}
            {!mesas.length && <p className="suave chico">Unos días antes de la boda verás aquí tu mesa asignada.</p>}
          </> : <>
            <h3>Gracias por avisarnos</h3>
            <p className="suave">Lamentamos que no puedas acompañarnos. ¡Te vamos a extrañar!</p>
          </>}
          {!cerrado && !vencido() && <button className="btn claro" onClick={() => setEditando(true)}>Cambiar mi respuesta</button>}
          {!cerrado && vencido() && <p className="suave chico">Si necesitas cambiar algo, escríbenos.</p>}
        </div>
      </>
    );
  }

  if (vencido() || cerrado) {
    return <>{sobre}<p className="aviso centro">El plazo para confirmar terminó el {limiteConfirmar()}. Si aún quieres confirmar, escríbenos directamente.</p></>;
  }

  return (
    <form onSubmit={enviar}>
      {sobre}
      <p className="centro suave">Por favor confirma antes del <b>{limiteConfirmar()}</b>.</p>
      {filas.map((f, i) => (
        <div className="persona" key={f.id ?? `extra-${i}`}>
          <div className="fila">
            {f.extra
              ? <input value={f.nombre} onChange={(e) => cambiar(i, 'nombre', e.target.value)} placeholder="Nombre de tu acompañante" aria-label="Nombre del acompañante" style={{ flex: '1 1 180px' }} />
              : <b>{f.nombre}</b>}
            <div className="eleccion" role="group" aria-label={`¿${f.nombre || 'Acompañante'} asistirá?`}>
              <button type="button" className={f.asistira === true ? 'si' : ''} onClick={() => cambiar(i, 'asistira', true)}>Asistiré</button>
              <button type="button" className={f.asistira === false ? 'no' : ''} onClick={() => cambiar(i, 'asistira', false)}>No podré</button>
            </div>
          </div>
          {f.asistira && (
            <input value={f.restriccion} onChange={(e) => cambiar(i, 'restriccion', e.target.value)} placeholder="Alergias o restricción alimentaria (opcional)" aria-label="Restricción alimentaria" />
          )}
        </div>
      ))}
      {filas.length > 1 && <p className="centro"><button type="button" className="btn claro chico" onClick={todosNo}>Ninguno podrá asistir</button></p>}
      <label className="campo"><span>Una canción que no puede faltar 🎶</span>
        <input value={cancion} onChange={(e) => setCancion(e.target.value)} placeholder="Canción – Artista" />
      </label>
      <label className="campo"><span>Un mensaje para los novios</span>
        <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={1000} />
      </label>
      {error && <p className="aviso error">{error}</p>}
      <div className="centro"><button className="btn oro" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar confirmación'}</button></div>
    </form>
  );
}
