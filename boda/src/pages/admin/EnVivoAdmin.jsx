import { useEffect, useState } from 'react';
import { boda } from '../../config';
import { api } from '../../lib/api';
import { horaCorta } from '../../lib/fechas';

const RAPIDOS = ['La cena está servida', 'Los novios van a entrar', 'Empieza el primer baile', 'Foto de grupo en la terraza', 'Últimas canciones de la noche'];

/** El día de la boda: avisos a todos los teléfonos, el juego y las canciones. */
export default function EnVivoAdmin() {
  return (
    <div className="rejilla" style={{ alignItems: 'start' }}>
      <Avisos />
      <JuegoControl />
      <CancionesAdmin />
    </div>
  );
}

function Avisos() {
  const [avisos, setAvisos] = useState([]);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const cargar = () => api.listarAvisos().then(setAvisos).catch((e) => setError(e.message));
  useEffect(() => { cargar(); return api.suscribirAvisos(cargar); }, []);
  async function publicar(v) {
    if (!v.trim()) return;
    try { setError(''); await api.publicarAviso(v); setTexto(''); cargar(); } catch (e) { setError(e.message); }
  }
  return (
    <div className="tarjeta">
      <h3>Avisos a los invitados</h3>
      <p className="chico suave">Aparece arriba en el teléfono de todos los que tengan el sitio abierto, al instante. Se ve durante 6 horas.</p>
      <form onSubmit={(e) => { e.preventDefault(); publicar(texto); }} style={{ display: 'flex', gap: 8 }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={280} placeholder="Escribe el aviso…" aria-label="Aviso" style={{ flex: 1 }} />
        <button className="btn chico">Enviar</button>
      </form>
      <div className="chips-rapidos">{RAPIDOS.map((r) => <button key={r} type="button" className="btn claro chico" onClick={() => publicar(r)}>{r}</button>)}</div>
      {error && <p className="aviso error">{error}</p>}
      {avisos.map((a) => (
        <div key={a.id} className="fila-admin">
          <span>{a.texto} <span className="chico suave">· {horaCorta(a.created_at)}</span></span>
          <button className="btn claro chico" onClick={async () => { await api.borrarAviso(a.id); cargar(); }}>Quitar</button>
        </div>
      ))}
    </div>
  );
}

function JuegoControl() {
  const preguntas = boda.juego?.preguntas || [];
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState('');
  const cargar = () => api.estadoJuego().then(setEstado).catch((e) => setError(e.message));
  useEffect(() => { cargar(); return api.suscribirJuego(cargar); }, []);
  // Las respuestas buenas viven en config.js; la base guarda una copia para puntuar.
  useEffect(() => {
    api.guardarAjuste?.('juego_correctas', preguntas.map((q) => q.correcta).join(',')).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ir = async (cambio) => { try { setError(''); await api.controlarJuego(cambio); cargar(); } catch (e) { setError(e.message); } };
  if (!preguntas.length) return <div className="tarjeta"><h3>Juego</h3><p className="chico suave">Agrega preguntas en <code>juego.preguntas</code> de src/config.js.</p></div>;
  const p = estado?.pregunta ?? -1;
  const q = preguntas[p];
  const enlace = `${window.location.origin}/pantalla?modo=juego`;
  return (
    <div className="tarjeta">
      <h3>Juego: {boda.juego.titulo}</h3>
      <p className="chico suave">Los invitados juegan en <b>{window.location.origin}/juego</b>. En el proyector abran <a href={enlace} target="_blank" rel="noreferrer">la pantalla del juego</a>.</p>
      {estado && <p><b>{q ? `Pregunta ${p + 1} de ${preguntas.length}: ${q.p}` : estado.fase === 'final' ? 'Juego terminado' : 'Sin empezar'}</b><br />
        <span className="chico suave">{estado.fase === 'abierta' ? `Respondiendo… ${estado.total} respuestas` : estado.fase === 'revelada' ? `Respuesta mostrada (${q?.opciones[q.correcta]})` : ''}</span></p>}
      {error && <p className="aviso error">{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {estado?.fase === 'abierta' && <button className="btn chico" onClick={() => ir({ pregunta: p, fase: 'revelada' })}>Mostrar la respuesta</button>}
        {estado?.fase !== 'abierta' && p + 1 < preguntas.length && estado?.fase !== 'final' && (
          <button className="btn chico" onClick={() => ir({ pregunta: p + 1, fase: 'abierta' })}>{p < 0 ? 'Empezar: lanzar la pregunta 1' : `Lanzar la pregunta ${p + 2}`}</button>
        )}
        {estado?.fase === 'revelada' && p + 1 >= preguntas.length && <button className="btn chico" onClick={() => ir({ pregunta: p, fase: 'final' })}>Mostrar ganadores</button>}
        {p >= 0 && <button className="btn claro chico" onClick={async () => { if (confirm('¿Borrar todas las respuestas y empezar de cero?')) { await api.reiniciarJuego(); cargar(); } }}>Reiniciar</button>}
      </div>
    </div>
  );
}

function CancionesAdmin() {
  const [lista, setLista] = useState([]);
  const cargar = () => api.listarCanciones().then(setLista).catch(() => {});
  useEffect(() => { cargar(); return api.suscribirCanciones(cargar); }, []);
  const marcar = async (c, cambios) => { await api.marcarCancion(c.id, cambios); cargar(); };
  return (
    <div className="tarjeta">
      <h3>Canciones pedidas ({lista.filter((c) => !c.tocada).length})</h3>
      <p className="chico suave">Pídanle al DJ que abra <a href="/dj" target="_blank" rel="noreferrer">{window.location.origin}/dj</a>: se ordena sola por votos.</p>
      {lista.map((c) => (
        <div key={c.id} className="fila-admin" style={{ opacity: c.tocada ? 0.5 : 1 }}>
          <span><b>{c.titulo}</b>{c.artista ? ` · ${c.artista}` : ''} <span className="chico suave">♥ {c.votos}</span></span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn claro chico" onClick={() => marcar(c, { tocada: !c.tocada })}>{c.tocada ? 'Devolver' : 'Ya sonó'}</button>
            <button className="btn claro chico" onClick={() => marcar(c, { oculta: true })}>Quitar</button>
          </span>
        </div>
      ))}
    </div>
  );
}
