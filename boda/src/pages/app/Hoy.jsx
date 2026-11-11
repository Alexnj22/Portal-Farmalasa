import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { contenido, t, useIdioma } from '../../lib/idioma';
import { api } from '../../lib/api';
import { horaCorta } from '../../lib/fechas';
import { useInvitacion } from '../../lib/miInvitacion';
import { PaginaApp } from '../../components/AppMarco';
import { AhoraEnLaBoda, DondeMeSiento } from '../../components/EnVivo';
import Icono from '../../components/Iconos';

/** El día de la boda: qué pasa ahora, tu mesa y los avisos de los novios. */
export default function Hoy() {
  const idioma = useIdioma();
  const boda = contenido(idioma);
  const { inv } = useInvitacion();
  const [avisos, setAvisos] = useState([]);
  useEffect(() => {
    const cargar = () => api.listarAvisos().then(setAvisos).catch(() => {});
    cargar();
    return api.suscribirAvisos(cargar);
  }, []);
  const conMesa = (inv?.personas || []).filter((p) => p.asistira && p.mesa);
  return (
    <PaginaApp titulo={<>{t('Hoy nos', 'Today we')} <em>{t('casamos', 'marry')}</em></>}>
      {conMesa.length > 0 ? (
        <div className="mi-mesa">
          <p className="versalita">{t('Tu mesa', 'Your table')}</p>
          <p className="mi-mesa-nombre">{conMesa[0].mesa}</p>
          <p>{conMesa.map((p) => p.nombre).join(' · ')}</p>
        </div>
      ) : <DondeMeSiento />}
      <AhoraEnLaBoda itinerario={boda.itinerario} />
      {avisos.length > 0 && (
        <section className="bloque-app">
          <h2 className="sub-app">{t('Avisos de los novios', 'From the couple')}</h2>
          <ul className="lista-avisos">{avisos.slice(0, 6).map((a) => <li key={a.id}><span className="hora">{horaCorta(a.created_at)}</span>{a.texto}</li>)}</ul>
        </section>
      )}
      <div className="hoy-acciones">
        <Link to="/album" className="hoy-accion"><Icono n="camara" tam={28} /><b>{t('Sube tus fotos', 'Upload photos')}</b><span>{t('Al álbum de todos', 'To the shared album')}</span></Link>
        <Link to="/canciones" className="hoy-accion"><Icono n="musica" tam={28} /><b>{t('Pide una canción', 'Request a song')}</b><span>{t('Y vota las de los demás', 'And vote for others')}</span></Link>
        <Link to="/juego" className="hoy-accion"><Icono n="juego" tam={28} /><b>{t('Juegos', 'Games')}</b><span>{t('Trivia, bingo y retos', 'Trivia, bingo and challenges')}</span></Link>
      </div>
      <p className="suave">{t('Usa', 'Use')} {boda.novios.hashtag} {t('en redes sociales.', 'on social media.')}</p>
    </PaginaApp>
  );
}
