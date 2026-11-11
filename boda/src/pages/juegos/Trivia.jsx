import { useEffect, useRef, useState } from 'react';
import { boda } from '../../config';
import { api } from '../../lib/api';
import { t, useIdioma } from '../../lib/idioma';
import { miId, miNombre, guardarMiNombre } from '../../lib/yo';
import { useQuedan, Aro } from '../../lib/reloj-juego';
import { lanzar, vibrar } from '../../lib/confeti';
import { PaginaApp } from '../../components/AppMarco';

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];
const LS_RESP = 'boda-juego-mias';
const leerMias = () => { try { return JSON.parse(localStorage.getItem(LS_RESP)) || {}; } catch { return {}; } };
export const porcentaje = (conteo, i, total) => (total ? Math.round(((conteo?.[i] || 0) / total) * 100) : 0);

/** Trivia en vivo desde el teléfono: el proyector (o el panel) lanza cada pregunta. */
export default function Trivia() {
  useIdioma();
  const yo = miId();
  const juego = boda.juego || {};
  const preguntas = juego.preguntas || [];
  const [estado, setEstado] = useState(null);
  const [nombre, setNombre] = useState(miNombre);
  const [listo, setListo] = useState(() => !!miNombre());
  const [mias, setMias] = useState(leerMias);
  const [error, setError] = useState('');
  const quedan = useQuedan(estado, juego.segundos || 20);
  const celebrada = useRef(-1);

  useEffect(() => {
    const cargar = () => api.estadoJuego().then(setEstado).catch((e) => setError(e.message));
    cargar();
    return api.suscribirJuego(cargar);
  }, []);

  const q = estado && preguntas[estado.pregunta];
  const mia = estado ? mias[estado.pregunta] : null;
  const revelada = estado?.fase === 'revelada';
  // Al acertar: confeti y una vibración corta.
  useEffect(() => {
    if (revelada && q && q.tipo !== 'quien' && mia === q.correcta && celebrada.current !== estado.pregunta) {
      celebrada.current = estado.pregunta; vibrar([20, 40, 20]); lanzar({ cantidad: 90, y: innerHeight * 0.35 });
    }
  }, [revelada, q, mia, estado?.pregunta]);

  async function responder(op) {
    if (!estado || mias[estado.pregunta] != null || quedan === 0) return;
    setError(''); vibrar(12);
    try {
      await api.responderJuego(yo, nombre, op);
      const m = { ...mias, [estado.pregunta]: op };
      setMias(m);
      try { localStorage.setItem(LS_RESP, JSON.stringify(m)); } catch { /* privado */ }
    } catch (e) { setError(e.message); }
  }

  const yoEnRanking = estado?.ranking.find((r) => r.nombre === nombre.trim());
  const conPuntos = preguntas.filter((x) => x.tipo !== 'quien').length;

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
        {yoEnRanking && <p className="juego-puntos">{t(`Acertaste ${yoEnRanking.puntos} de ${conPuntos}`, `You got ${yoEnRanking.puntos} of ${conPuntos}`)}</p>}
        <Ranking ranking={estado.ranking} yo={nombre.trim()} />
      </div>
    );
  } else if (!q || estado.fase === 'cerrado') {
    cuerpo = (
      <div className="juego-espera">
        <span className="punto-vivo grande" aria-hidden />
        <p className="paso-pregunta">{t(`¡Listo, ${nombre.trim()}!`, `Ready, ${nombre.trim()}!`)}</p>
        <p>{t('Mira la pantalla del salón: la pregunta aparece aquí sola, y tienes', 'Watch the screen: the question shows up here by itself, and you have')} {juego.segundos || 20} {t('segundos para responder.', 'seconds to answer.')}</p>
        <button type="button" className="btn enlace" onClick={() => setListo(false)}>{t('Cambiar mi nombre', 'Change my name')}</button>
      </div>
    );
  } else {
    const quien = q.tipo === 'quien';
    const tiempo = quedan === 0 && !revelada;
    cuerpo = (
      <div className="juego-pregunta">
        <div className="fila-pregunta">
          <p className="paso-cuenta">{quien ? t('¿Quién es más probable?', 'Who is more likely?') : t(`Pregunta ${estado.pregunta + 1} de ${preguntas.length}`, `Question ${estado.pregunta + 1} of ${preguntas.length}`)}</p>
          {!revelada && <Aro quedan={quedan} total={juego.segundos || 20} tam={56} />}
        </div>
        <p className="paso-pregunta">{q.p}</p>
        <div className={`opciones-juego ${q.opciones.length === 2 ? 'dos' : ''}`}>
          {q.opciones.map((o, i) => {
            const clase = revelada
              ? (quien ? (i === mia ? 'elegida' : '') : i === q.correcta ? 'correcta' : i === mia ? 'fallada' : 'apagada')
              : i === mia ? 'elegida' : '';
            return (
              <button key={i} type="button" className={`opcion-juego ${clase}`} disabled={mia != null || revelada || tiempo} onClick={() => responder(i)}>
                <span className="letra-op">{LETRAS[i]}</span><span className="texto-op">{o}</span>
                {revelada && quien && <span className="marca-op">{porcentaje(estado.conteo, i, estado.total)}%</span>}
                {revelada && !quien && i === q.correcta && <span className="marca-op">✓</span>}
              </button>
            );
          })}
        </div>
        <p className="juego-estado" aria-live="polite">
          {revelada
            ? (quien ? (mia != null ? t(`Opinas como el ${porcentaje(estado.conteo, mia, estado.total)} % del salón`, `You agree with ${porcentaje(estado.conteo, mia, estado.total)}% of the room`) : t('Así votó el salón', 'This is how the room voted'))
              : mia === q.correcta ? t('¡Acertaste! +1', 'Correct! +1') : mia != null ? t('Esta no. ¡La próxima!', 'Not this one. Next time!') : t('No alcanzaste a responder.', "You didn't answer in time."))
            : tiempo ? t('¡Se acabó el tiempo!', "Time's up!")
              : mia != null ? t('¡Listo! Espera la respuesta en la pantalla.', 'Done! Wait for the answer on the screen.') : t('Toca tu respuesta', 'Tap your answer')}
        </p>
        {yoEnRanking && <p className="mis-puntos">{t('Tus puntos', 'Your points')}: <b>{yoEnRanking.puntos}</b></p>}
      </div>
    );
  }

  return (
    <PaginaApp titulo={juego.titulo} bajada={t('Trivia en vivo', 'Live trivia')}>
      {error && <p className="aviso error">{error}</p>}
      {cuerpo}
    </PaginaApp>
  );
}

export function Ranking({ ranking, yo }) {
  if (!ranking?.length) return null;
  return (
    <ol className="ranking">
      {ranking.map((r, i) => (
        <li key={i} className={r.nombre === yo ? 'soy-yo' : ''}><span className="puesto">{['🥇', '🥈', '🥉'][i] || i + 1}</span><span>{r.nombre}</span><b>{r.puntos}</b></li>
      ))}
    </ol>
  );
}
