import { useEffect, useRef, useState } from 'react';
import { boda } from '../config';
import { api, esVideo } from '../lib/api';
import QR from '../components/QR';

// Presentación en vivo para el proyector del salón: rota las fotos y salta a
// cada foto nueva apenas alguien la sube. Abrir en /pantalla y poner pantalla completa.
export default function Pantalla() {
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
        {f?.autor && <div>📸 {f.autor}{f.momento ? ` · ${f.momento}` : ''}</div>}
      </div>
      <div className="qr-esquina">
        <QR texto={enlace} tam={130} />
        <div>Sube tus fotos</div>
      </div>
    </div>
  );
}
