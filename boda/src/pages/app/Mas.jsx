import { Link } from 'react-router-dom';
import { contenido, t, useIdioma, IDIOMAS, idioma as idiomaActual, cambiarIdioma } from '../../lib/idioma';
import { faseActual, faseAlMenos } from '../../lib/fase';
import { cambiarFacil } from '../../lib/facil';
import { useInvitacion } from '../../lib/miInvitacion';
import { PaginaApp } from '../../components/AppMarco';
import Icono from '../../components/Iconos';

/** Todo el sitio en una lista, como los ajustes del teléfono. */
export default function Mas() {
  const idioma = useIdioma();
  const boda = contenido(idioma);
  const fase = faseActual();
  const { inv } = useInvitacion();
  const Fila = ({ a, href, i, txt, sub, onClick }) => {
    const cuerpo = <><span className="fila-icono"><Icono n={i} tam={22} /></span><span className="fila-texto"><b>{txt}</b>{sub && <span>{sub}</span>}</span><Icono n="flecha" tam={18} className="fila-flecha" /></>;
    if (a) return <Link to={a} className="fila-mas">{cuerpo}</Link>;
    if (href) return <a href={href} className="fila-mas" target="_blank" rel="noreferrer">{cuerpo}</a>;
    return <button type="button" className="fila-mas" onClick={onClick}>{cuerpo}</button>;
  };
  return (
    <PaginaApp titulo={t('Todo', 'Everything')} bajada={inv?.grupo ? t(`Invitación de ${inv.grupo.nombre}`, `Invitation for ${inv.grupo.nombre}`) : boda.novios.firma}>
      <div className="grupo-mas">
        <Fila a="/" i="inicio" txt={t('Inicio', 'Home')} sub={t('Nuestra historia y la cuenta regresiva', 'Our story and countdown')} />
        {faseAlMenos(fase, 'invitacion') && <Fila a="/evento" i="lugar" txt={t('Dónde y cuándo', 'Where and when')} sub={t('Mapa, programa, vestimenta, regalos', 'Map, schedule, dress code, gifts')} />}
        <Fila a="/confirmar" i="confirmar" txt={t('Mi invitación', 'My invitation')} sub={inv?.grupo?.respondido_at ? t('Ya respondiste', 'Replied') : t('Confirmar asistencia', 'RSVP')} />
        {fase === 'boda' && <Fila a="/hoy" i="hoy" txt={t('Hoy', 'Today')} sub={t('Programa en vivo y tu mesa', 'Live schedule and your table')} />}
      </div>
      <div className="grupo-mas">
        {faseAlMenos(fase, 'boda') && <Fila a="/album" i="fotos" txt={t('Álbum de fotos', 'Photo album')} sub={t('Las fotos de todos', "Everyone's photos")} />}
        {faseAlMenos(fase, 'invitacion') && fase !== 'recuerdos' && <Fila a="/canciones" i="musica" txt={t('Canciones', 'Songs')} sub={t('Pide y vota', 'Request and vote')} />}
        {faseAlMenos(fase, 'invitacion') && fase !== 'recuerdos' && <Fila a="/juego" i="juego" txt={t('Juegos', 'Games')} sub={t('Trivia, bingo y retos', 'Trivia, bingo and challenges')} />}
        {faseAlMenos(fase, 'invitacion') && <Fila a="/mensajes" i="mensajes" txt={t('Libro de firmas', 'Guestbook')} sub={t('Escrito o de voz', 'Written or voice')} />}
      </div>
      <div className="grupo-mas">
        <Fila i="letra" txt={t('Letra grande', 'Large text')} sub={t('Más fácil de leer y usar', 'Easier to read and use')} onClick={() => cambiarFacil(true)} />
        {IDIOMAS.length > 1 && <Fila i="mensajes" txt={idiomaActual() === 'es' ? 'English' : 'Español'} sub={t('Cambiar idioma', 'Change language')} onClick={() => cambiarIdioma(idiomaActual() === 'es' ? 'en' : 'es')} />}
        {boda.contacto?.whatsapp && <Fila href={`https://wa.me/${boda.contacto.whatsapp}`} i="whatsapp" txt={t(`Escribir a ${boda.contacto.nombre}`, `Message ${boda.contacto.nombre}`)} sub="WhatsApp" />}
      </div>
    </PaginaApp>
  );
}
