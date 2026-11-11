import { useEffect, useRef, useState } from 'react';
import { boda } from '../config';
import { api, esVideo } from '../lib/api';
import QR from '../components/QR';
import { Ranking, porcentaje } from './juegos/Trivia';
import { useQuedan, Aro } from '../lib/reloj-juego';
import { t } from '../lib/idioma';

// Presentación en vivo para el proyector del salón: rota las fotos y salta a
// cada foto nueva apenas alguien la sube. Abrir en /pantalla y poner pantalla completa.
export default function Pantalla() {
  return new URLSearchParams(window.location.search).get('modo') === 'juego' ? <PantallaJuego /> : <PantallaFotos />;
}

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];
const PAUSA_REVELADA = 8; // segundos mostrando la respuesta antes de seguir

/**
 * El juego en el proyector. Con la sesión de los novios abierta en esta
 * computadora aparece «Empezar»: desde ahí corre solo (pregunta, tiempo,
 * respuesta, siguiente… y ganadores). También se puede manejar desde el panel.
 */
function PantallaJuego() {
  const juego = boda.juego || {};
  const preguntas = juego.preguntas || [];
  const seg = juego.segundos || 20;
  const [e, setE] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [auto, setAuto] = useState(false);
  const quedan = useQuedan(e, seg);
  useEffect(() => {
    const cargar = () => api.estadoJuego().then(setE).catch(() => {});
    cargar();
    api.sesion().then((u) => setAdmin(!!u)).catch(() => {});
    return api.suscribirJuego(cargar);
  }, []);

  // Piloto automático: cuando se acaba el tiempo, revela; tras la pausa, sigue.
  useEffect(() => {
    if (!auto || !e) return undefined;
    if (e.fase === 'abierta' && quedan === 0) { api.controlarJuego({ pregunta: e.pregunta, fase: 'revelada' }); return undefined; }
    if (e.fase === 'revelada') {
      const id = setTimeout(() => {
        if (e.pregunta + 1 < preguntas.length) api.controlarJuego({ pregunta: e.pregunta + 1, fase: 'abierta' });
        else { api.controlarJuego({ pregunta: e.pregunta, fase: 'final' }); setAuto(false); }
      }, PAUSA_REVELADA * 1000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [auto, e?.fase, e?.pregunta, quedan]); // eslint-disable-line react-hooks/exhaustive-deps

  const empezar = async () => {
    if (e?.pregunta >= 0) await api.reiniciarJuego();
    await api.controlarJuego({ pregunta: 0, fase: 'abierta' });
    setAuto(true);
  };

  const q = e && preguntas[e.pregunta];
  const enlace = `${window.location.origin}/juego/trivia`;
  const quien = q?.tipo === 'quien';
  const max = Math.max(1, ...Object.values(e?.conteo || {}));
  return (
    <div className="pantalla pantalla-juego" onDoubleClick={() => document.documentElement.requestFullscreen?.()}>
      <div className="juego-cabeza"><span className="script">{boda.novios.firma}</span><span>{juego.titulo}</span></div>
      {!e || (!q && e.fase !== 'final') ? (
        <div className="juego-centro portada-juego">
          <p className="juego-num">{t('Trivia en vivo', 'Live trivia')}</p>
          <p className="juego-grande">{juego.titulo}</p>
          <p className="juego-instruccion">Escanea el código, escribe tu nombre y prepárate: {preguntas.length} preguntas, {seg} segundos cada una.</p>
          {admin && <button type="button" className="btn-proyector" onClick={empezar}>Empezar el juego ▸</button>}
        </div>
      ) : e.fase === 'final' ? (
        <div className="juego-centro"><p className="juego-grande">¡Ganadores!</p><div className="podio"><Ranking ranking={e.ranking.slice(0, 5)} /></div>
          {admin && <button type="button" className="btn-proyector chico" onClick={empezar}>Jugar otra vez</button>}</div>
      ) : (
        <div className="juego-centro">
          <div className="fila-pregunta">
            <p className="juego-num">{quien ? '¿Quién es más probable?' : `Pregunta ${e.pregunta + 1} de ${preguntas.length}`} · {e.total} {e.total === 1 ? 'respuesta' : 'respuestas'}</p>
            {e.fase === 'abierta' && <Aro quedan={quedan} total={seg} tam={110} />}
          </div>
          <p className="juego-grande">{q.p}</p>
          <div className={`barras-juego ${q.opciones.length === 2 ? 'dos' : ''}`}>
            {q.opciones.map((o, i) => {
              const n = e.conteo?.[i] || 0;
              const rev = e.fase === 'revelada';
              const ok = rev && !quien && i === q.correcta;
              return (
                <div key={i} className={`barra-juego ${rev && !quien ? (ok ? 'correcta' : 'apagada') : ''}`}>
                  <span className="letra-op">{LETRAS[i]}</span><span className="texto-op">{o}</span>
                  <span className="relleno" style={{ transform: `scaleX(${rev ? n / max : 0})` }} />
                  <b>{rev ? (quien ? `${porcentaje(e.conteo, i, e.total)}%` : n) : ''}{ok ? ' ✓' : ''}</b>
                </div>
              );
            })}
          </div>
          {e.fase === 'revelada' && e.ranking.length > 0 && !quien && <div className="ranking-lado"><p className="juego-num">Van ganando</p><Ranking ranking={e.ranking.slice(0, 5)} /></div>}
        </div>
      )}
      {admin && e && e.pregunta >= 0 && e.fase !== 'final' && (
        <button type="button" className="btn-proyector esquina" onClick={() => setAuto((a) => !a)}>{auto ? '❚❚ Pausar' : '▸ Seguir solo'}</button>
      )}
      <div className="qr-esquina"><QR texto={enlace} tam={130} /><div>Juega aquí</div></div>
    </div>
  );
}

function PantallaFotos() {
  const [fotos, setFotos] = useState([]);
  const [i, setI] = useState(0);
  const nuevas = useRef([]);
  // La clave viene en ?k= (el panel la pone en el enlace); el invitado no la puede leer de la base.
  const [clave, setClave] = useState(() => new URLSearchParams(window.location.search).get('k') || '');

  useEffect(() => {
    api.listarFotos().then(setFotos).catch(() => {});
    if (!clave) api.leerClaveAlbum().then((c) => c && setClave(c)).catch(() => {});
    return api.suscribirFotos((f) => {
      nuevas.current.push(f);
      setFotos((xs) => [f, ...xs]);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fotosRef = useRef(fotos);
  fotosRef.current = fotos;
  useEffect(() => {
    const t = setInterval(() => {
      const xs = fotosRef.current;
      const nueva = nuevas.current.shift();
      if (nueva) setI(Math.max(0, xs.findIndex((x) => x.id === nueva.id)));
      else setI((n) => (xs.length ? (n + 1) % xs.length : 0));
    }, 6000);
    return () => clearInterval(t);
  }, []);

  const f = fotos[i];
  const enlace = `${window.location.origin}/album${clave ? `?k=${clave}` : ''}`;

  return (
    <div className="pantalla" onDoubleClick={() => document.documentElement.requestFullscreen?.()}>
      {f && (esVideo(f.ruta)
        ? <video key={f.id} src={f.url} autoPlay muted playsInline loop />
        : <>
            <img key={`b${f.id}`} className="fondo-borroso" src={f.mini || f.url} alt="" />
            <img key={f.id} src={f.url} alt="" />
          </>)}
      {!f && <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><p className="script" style={{ fontSize: '4rem' }}>{boda.novios.firma}</p></div>}
      <div className="rotulo">
        <div className="script">{boda.novios.firma}</div>
        {f?.autor && <div style={{ fontSize: '1.125rem', marginTop: 6 }}>{f.autor}{f.momento ? ` · ${f.momento}` : ''}</div>}
      </div>
      <div className="qr-esquina">
        <QR texto={enlace} tam={130} />
        <div>Sube tus fotos</div>
      </div>
    </div>
  );
}
