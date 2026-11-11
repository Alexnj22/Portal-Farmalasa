import { useEffect, useRef, useState } from 'react';
import { boda } from '../config';
import { api, esVideo } from '../lib/api';
import QR from '../components/QR';
import { Ranking } from './Juego';

// Presentación en vivo para el proyector del salón: rota las fotos y salta a
// cada foto nueva apenas alguien la sube. Abrir en /pantalla y poner pantalla completa.
export default function Pantalla() {
  return new URLSearchParams(window.location.search).get('modo') === 'juego' ? <PantallaJuego /> : <PantallaFotos />;
}

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];
/** El juego en el proyector: la pregunta, las barras en vivo y los ganadores. */
function PantallaJuego() {
  const preguntas = boda.juego?.preguntas || [];
  const [e, setE] = useState(null);
  useEffect(() => {
    const cargar = () => api.estadoJuego().then(setE).catch(() => {});
    cargar();
    return api.suscribirJuego(cargar);
  }, []);
  const q = e && preguntas[e.pregunta];
  const enlace = `${window.location.origin}/juego`;
  const max = Math.max(1, ...Object.values(e?.conteo || {}));
  return (
    <div className="pantalla pantalla-juego" onDoubleClick={() => document.documentElement.requestFullscreen?.()}>
      <div className="juego-cabeza"><span className="script">{boda.novios.firma}</span><span>{boda.juego?.titulo}</span></div>
      {!e || (!q && e.fase !== 'final') ? (
        <div className="juego-centro"><p className="juego-grande">{boda.juego?.titulo}</p><p>Escanea el código y escribe tu nombre para jugar</p></div>
      ) : e.fase === 'final' ? (
        <div className="juego-centro"><p className="juego-grande">¡Ganadores!</p><Ranking ranking={e.ranking.slice(0, 5)} /></div>
      ) : (
        <div className="juego-centro">
          <p className="juego-num">Pregunta {e.pregunta + 1} de {preguntas.length} · {e.total} respuestas</p>
          <p className="juego-grande">{q.p}</p>
          <div className="barras-juego">
            {q.opciones.map((o, i) => {
              const n = e.conteo?.[i] || 0;
              const ok = e.fase === 'revelada' && i === q.correcta;
              return (
                <div key={i} className={`barra-juego ${e.fase === 'revelada' ? (ok ? 'correcta' : 'apagada') : ''}`}>
                  <span className="letra-op">{LETRAS[i]}</span><span className="texto-op">{o}</span>
                  <span className="relleno" style={{ transform: `scaleX(${e.fase === 'revelada' ? n / max : 0})` }} />
                  <b>{e.fase === 'revelada' ? n : ''}{ok ? ' ✓' : ''}</b>
                </div>
              );
            })}
          </div>
          {e.fase === 'revelada' && e.ranking.length > 0 && <div className="ranking-lado"><Ranking ranking={e.ranking.slice(0, 5)} /></div>}
        </div>
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
