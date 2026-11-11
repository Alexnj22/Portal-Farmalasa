import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { boda } from '../config';
import { api } from '../lib/api';
import { t, useIdioma, BotonIdioma } from '../lib/idioma';
import { miId, miNombre, guardarMiNombre } from '../lib/yo';
import { BotonFacil } from '../components/Facil';

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];
const LS_RESP = 'boda-juego-mias';
const leerMias = () => { try { return JSON.parse(localStorage.getItem(LS_RESP)) || {}; } catch { return {}; } };

/** El juego desde el teléfono: los novios lanzan cada pregunta desde el panel. */
export default function Juego() {
  useIdioma();
  const yo = miId();
  const preguntas = boda.juego?.preguntas || [];
  const [estado, setEstado] = useState(null);
  const [nombre, setNombre] = useState(miNombre);
  const [listo, setListo] = useState(() => !!miNombre());
  const [mias, setMias] = useState(leerMias);
  const [error, setError] = useState('');

  useEffect(() => {
    const cargar = () => api.estadoJuego().then(setEstado).catch((e) => setError(e.message));
    cargar();
    return api.suscribirJuego(cargar);
  }, []);

  async function responder(op) {
    if (!estado || mias[estado.pregunta] != null) return;
    setError('');
    try {
      await api.responderJuego(yo, nombre, op);
      const m = { ...mias, [estado.pregunta]: op };
      setMias(m);
      try { localStorage.setItem(LS_RESP, JSON.stringify(m)); } catch { /* privado */ }
    } catch (e) { setError(e.message); }
  }

  const q = estado && preguntas[estado.pregunta];
  const mia = estado ? mias[estado.pregunta] : null;
  const yoEnRanking = estado?.ranking.find((r) => r.nombre === nombre.trim());

  let cuerpo;
  if (!listo) {
    cuerpo = (
      <form className="juego-nombre" onSubmit={(e) => { e.preventDefault(); if (nombre.trim()) { guardarMiNombre(nombre); setListo(true); } }}>
        <label className="paso-pregunta" htmlFor="nombre-juego">{t('¿Cómo te llamas?', "What's your name?")}</label>
        <input id="nombre-juego" className="paso-campo" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} autoComplete="given-name" required />
        <button className="btn enorme">{t('Jugar', 'Play')}</button>
      </form>
    );
  } else if (!estado) {
    cuerpo = <p className="suave">{t('Cargando…', 'Loading…')}</p>;
  } else if (estado.fase === 'final') {
    cuerpo = (
      <div className="juego-espera">
        <p className="paso-pregunta">{t('¡Terminó el juego!', 'Game over!')}</p>
        {yoEnRanking && <p className="juego-puntos">{t(`Hiciste ${yoEnRanking.puntos} de ${preguntas.length}`, `You got ${yoEnRanking.puntos} of ${preguntas.length}`)}</p>}
        <Ranking ranking={estado.ranking} yo={nombre.trim()} />
      </div>
    );
  } else if (!q || estado.fase === 'cerrado') {
    cuerpo = (
      <div className="juego-espera">
        <span className="punto-vivo grande" aria-hidden />
        <p className="paso-pregunta">{t(`Listo, ${nombre.trim()}.`, `Ready, ${nombre.trim()}.`)}</p>
        <p>{t('La pregunta aparece aquí cuando los novios la lancen. Mira la pantalla del salón.', 'The question shows up here when the couple launches it. Watch the screen in the hall.')}</p>
      </div>
    );
  } else {
    const revelada = estado.fase === 'revelada';
    cuerpo = (
      <div className="juego-pregunta">
        <p className="paso-cuenta">{t(`Pregunta ${estado.pregunta + 1} de ${preguntas.length}`, `Question ${estado.pregunta + 1} of ${preguntas.length}`)}</p>
        <p className="paso-pregunta">{q.p}</p>
        <div className="opciones-juego">
          {q.opciones.map((o, i) => {
            const clase = revelada ? (i === q.correcta ? 'correcta' : i === mia ? 'fallada' : 'apagada') : i === mia ? 'elegida' : '';
            return (
              <button key={i} type="button" className={`opcion-juego ${clase}`} disabled={mia != null || revelada} onClick={() => responder(i)}>
                <span className="letra-op">{LETRAS[i]}</span>{o}
                {revelada && i === q.correcta && <span className="marca-op">✓</span>}
              </button>
            );
          })}
        </div>
        <p className="juego-estado" aria-live="polite">
          {revelada ? (mia === q.correcta ? t('¡Acertaste!', 'Correct!') : mia != null ? t('Esta no. ¡La próxima!', 'Not this one. Next time!') : t('No alcanzaste a responder.', "You didn't answer in time."))
            : mia != null ? t('Respuesta enviada. Espera a que los novios la revelen.', 'Answer sent. Wait for the couple to reveal it.') : t('Elige una respuesta', 'Pick an answer')}
        </p>
      </div>
    );
  }

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
          <p className="versalita suave">{t('El juego', 'The game')}</p>
          <h1>{boda.juego?.titulo}</h1>
        </header>
        {error && <p className="aviso error">{error}</p>}
        {cuerpo}
      </main>
    </>
  );
}

export function Ranking({ ranking, yo }) {
  if (!ranking?.length) return null;
  return (
    <ol className="ranking">
      {ranking.map((r, i) => (
        <li key={i} className={r.nombre === yo ? 'soy-yo' : ''}><span className="puesto">{i + 1}</span><span>{r.nombre}</span><b>{r.puntos}</b></li>
      ))}
    </ol>
  );
}
