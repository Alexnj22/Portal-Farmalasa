import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { faseActual, faseAlMenos } from '../lib/fase';
import { fechaLarga, fechaCorta, descargarIcs, enlaceGoogleCalendar } from '../lib/fechas';
import { api } from '../lib/api';
import { t, useIdioma, contenido, BotonIdioma } from '../lib/idioma';
import Countdown from '../components/Countdown';
import Mapa from '../components/Mapa';
import Mosaico from '../components/Mosaico';
import Seccion from '../components/Seccion';
import Revelar from '../components/Revelar';
import Copiar from '../components/Copiar';
import CintaEntrada from '../components/CintaEntrada';
import Rsvp from './Rsvp';
import LibroFirmas from './LibroFirmas';

export default function Inicio({ codigo }) {
  const idioma = useIdioma();
  const boda = contenido(idioma);
  const { novios } = boda;
  const fase = faseActual();
  const [inv, setInv] = useState(undefined); // undefined = cargando, null = no existe
  const [lugar, setLugar] = useState(null);

  useEffect(() => {
    if (!codigo) { setInv(null); return; }
    api.getInvitacion(codigo).then(setInv).catch(() => setInv(null));
  }, [codigo]);

  const secciones = useMemo(() => {
    const s = [];
    if (fase === 'boda') s.push(['hoy', t('Hoy', 'Today')]);
    if (codigo && faseAlMenos(fase, 'invitacion')) s.push(['confirmar', t('Confirmar', 'RSVP')]);
    s.push(['historia', t('Historia', 'Our story')], ['fotos', t('Fotos', 'Photos')]);
    if (faseAlMenos(fase, 'invitacion')) s.push(['evento', t('Evento', 'Venue')], ['programa', t('Programa', 'Schedule')], ['detalles', t('Detalles', 'Details')]);
    if (!codigo && faseAlMenos(fase, 'invitacion') && fase !== 'recuerdos') s.push(['confirmar', t('Confirmar', 'RSVP')]);
    if (faseAlMenos(fase, 'invitacion')) s.push(['firmas', t('Mensajes', 'Guestbook')]);
    return s;
  }, [fase, codigo, idioma]); // eslint-disable-line react-hooks/exhaustive-deps

  const titulo = fase === 'save-the-date' ? 'Save the date'
    : fase === 'recuerdos' ? t('¡Gracias por acompañarnos!', 'Thank you for celebrating with us!')
    : fase === 'boda' ? t('¡Hoy nos casamos!', "Today we're getting married!") : t('Nos casamos', "We're getting married");

  return (
    <>
      <nav className="nav">
        <div className="contenedor">
          <a href="#inicio" className="marca">{novios.el[0]} & {novios.ella[0]}</a>
          <ul>
            {secciones.map(([id, txt]) => <li key={id}><a href={`#${id}`}>{txt}</a></li>)}
            {faseAlMenos(fase, 'boda') && <li><Link to="/album">{t('Álbum', 'Album')}</Link></li>}
          </ul>
          <BotonIdioma />
        </div>
      </nav>

      {codigo && <CintaEntrada codigo={codigo} />}

      {/* ── Portada ── */}
      <header id="inicio" className="portada">
        <img className="fondo" src={boda.portada} alt="" fetchpriority="high" />
        <div className="contenedor">
          {inv?.grupo && <p style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontStyle: 'italic' }}>
            {t('Querida', 'Dear')} {inv.grupo.nombre}:
          </p>}
          <div className="etiqueta">{titulo}</div>
          <h1>{novios.el} <span style={{ fontSize: '0.6em' }}>&</span> {novios.ella}</h1>
          <div className="fecha">{fase === 'save-the-date' ? fechaCorta() : fechaLarga()}</div>
          {fase !== 'recuerdos' && <Countdown />}
          <div className="acciones">
            {fase === 'boda' && <Link className="btn blanco" to="/album">📸 {t('Sube tus fotos', 'Upload your photos')}</Link>}
            {fase === 'recuerdos' && <Link className="btn blanco" to="/album">{t('Ver el álbum', 'See the album')}</Link>}
            {(fase === 'save-the-date' || fase === 'invitacion') && <>
              <a className="btn blanco" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">{t('Agregar a Google Calendar', 'Add to Google Calendar')}</a>
              <button className="btn vidrio" onClick={descargarIcs}>Apple / Outlook (.ics)</button>
            </>}
            {fase === 'invitacion' && <a className="btn vidrio" href="#confirmar">{t('Confirmar asistencia', 'RSVP')}</a>}
          </div>
        </div>
      </header>

      {fase === 'boda' && (
        <Seccion id="hoy" script={t('Hoy', 'Today')} titulo={t('Comparte el día con nosotros', 'Share the day with us')} angosta>
          <div className="tarjeta centro">
            <p>{t('Toma fotos y súbelas al álbum compartido. Así juntamos todos los momentos que nosotros no alcanzamos a ver.',
              "Take photos and upload them to the shared album. That way we can collect all the moments we didn't get to see.")}</p>
            <Link to="/album" className="btn oro">{t('Abrir el álbum', 'Open the album')}</Link>
            <p className="suave chico" style={{ marginTop: 14 }}>{t('Usa', 'Use')} {novios.hashtag} {t('en redes sociales.', 'on social media.')}</p>
          </div>
        </Seccion>
      )}

      {codigo && faseAlMenos(fase, 'invitacion') && (
        <Seccion id="confirmar" script={t('Tu invitación', 'Your invitation')} titulo={fase === 'recuerdos' ? t('Tu invitación', 'Your invitation') : t('Confirma tu asistencia', 'Please RSVP')} angosta>
          {inv === undefined && <p className="centro suave">{t('Cargando tu invitación…', 'Loading your invitation…')}</p>}
          {inv === null && <BuscarCodigo error={t('No encontramos esa invitación. Revisa el código.', "We couldn't find that invitation. Please check the code.")} />}
          {inv && <Rsvp codigo={codigo} invitacion={inv} alResponder={setInv} cerrado={fase === 'recuerdos'} />}
        </Seccion>
      )}

      {codigo && fase === 'save-the-date' && inv && (
        <Seccion id="tuya" titulo={t('¡Reserva la fecha!', 'Save the date!')} angosta>
          <div className="sobre">
            <p className="script" style={{ fontSize: '2rem', color: 'var(--oro)' }}>{inv.grupo.nombre}</p>
            <p>{t('Queremos que estés con nosotros. Pronto te llegará la invitación formal con todos los detalles.',
              'We want you there with us. The formal invitation with all the details is coming soon.')}</p>
            <p className="suave chico">
              {t('Tu invitación incluye', 'Your invitation includes')} {inv.grupo.pases} {inv.grupo.pases === 1 ? t('pase', 'seat') : t('pases', 'seats')}.
            </p>
          </div>
        </Seccion>
      )}

      {/* ── Historia ── */}
      <Seccion id="historia" script={t('Nuestra', 'Our')} titulo={t('Historia', 'Story')} alterna>
        <Revelar as="p" className="centro angosto suave" style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontStyle: 'italic', marginBottom: 48 }}>
          {boda.frase}
        </Revelar>
        <div className="linea-tiempo">
          {boda.historia.map((h, i) => (
            <Revelar key={i} className="hito">
              <div className="anio">{h.fecha}</div>
              <h3>{h.titulo}</h3>
              <p className="suave">{h.texto}</p>
            </Revelar>
          ))}
        </div>
      </Seccion>

      <Seccion id="fotos" script={t('Momentos', 'Moments')} titulo={t('Nosotros', 'Us')}>
        <Mosaico items={boda.galeria.map((url) => ({ url }))} />
      </Seccion>

      {faseAlMenos(fase, 'invitacion') && <>
        {/* ── Evento y mapa ── */}
        <Seccion id="evento" script={t('Dónde y cuándo', 'Where and when')} titulo={t('El gran día', 'The big day')} alterna>
          <div className="rejilla" style={{ marginBottom: 24 }}>
            {boda.lugares.map((l, i) => (
              <Revelar key={l.id} className="tarjeta lugar">
                <div className="tipo">{i + 1} · {l.tipo}</div>
                <h3>{l.nombre}</h3>
                <p className="suave" style={{ margin: 0 }}>{l.direccion}</p>
                <p style={{ margin: '4px 0 0', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>{l.hora}</p>
                <div className="botones">
                  <button className="btn claro chico" onClick={() => setLugar(l.id)}>{t('Ver en el mapa', 'Show on map')}</button>
                  <a className="btn claro chico" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`}>Google Maps</a>
                  <a className="btn claro chico" target="_blank" rel="noreferrer" href={`https://waze.com/ul?ll=${l.lat},${l.lng}&navigate=yes`}>Waze</a>
                </div>
              </Revelar>
            ))}
          </div>
          <Mapa lugares={boda.lugares} enfocado={lugar} />
        </Seccion>

        <Seccion id="programa" script={t('El', 'The')} titulo={t('Programa', 'Schedule')}>
          <ul className="itinerario">
            {boda.itinerario.map((p, i) => (
              <Revelar as="li" key={i}>
                <span className="hora">{p.hora}</span><span className="ic" aria-hidden>{p.icono}</span><span>{p.titulo}</span>
              </Revelar>
            ))}
          </ul>
        </Seccion>

        {/* ── Detalles ── */}
        <Seccion id="detalles" script={t('Para tomar en cuenta', 'Good to know')} titulo={t('Detalles', 'Details')} alterna>
          <div className="rejilla">
            <Revelar className="tarjeta centro">
              <h3>{t('Código de vestimenta', 'Dress code')}</h3>
              <p style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', margin: 0 }}>{boda.vestimenta.codigo}</p>
              <p className="suave chico">{boda.vestimenta.detalle}</p>
              <div className="paleta">{boda.vestimenta.paleta.map((c) => <span key={c} style={{ background: c }} title={c} />)}</div>
            </Revelar>
            <Revelar className="tarjeta centro">
              <h3>{t('Regalos', 'Gifts')}</h3>
              <p className="suave chico">{boda.regalos.texto}</p>
              {boda.regalos.opciones.map((o, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <b>{o.titulo}</b>
                  <div className="suave chico">{o.detalle}</div>
                  {o.copiar && <div style={{ marginTop: 6 }}><code>{o.copiar}</code> <Copiar texto={o.copiar} /></div>}
                  {o.enlace && <a className="btn claro chico" href={o.enlace} target="_blank" rel="noreferrer">{t('Ver', 'View')}</a>}
                </div>
              ))}
            </Revelar>
            {boda.hospedaje.length > 0 && (
              <Revelar className="tarjeta centro">
                <h3>{t('Hospedaje', 'Accommodation')}</h3>
                {boda.hospedaje.map((h, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <b>{h.nombre}</b>
                    <div className="suave chico">{h.detalle}</div>
                    {h.enlace && <a href={h.enlace} target="_blank" rel="noreferrer">{t('Reservar', 'Book')}</a>}
                  </div>
                ))}
              </Revelar>
            )}
          </div>
          <div className="angosto" style={{ marginTop: 48 }}>
            <h3 className="centro">{t('Preguntas frecuentes', 'FAQ')}</h3>
            {boda.preguntas.map((q, i) => (
              <details className="faq" key={i}><summary>{q.p}</summary><p>{q.r}</p></details>
            ))}
            {boda.playlist && (
              <p className="centro" style={{ marginTop: 24 }}>
                <a className="btn claro" href={boda.playlist} target="_blank" rel="noreferrer">🎵 {t('Agrega canciones a nuestra playlist', 'Add songs to our playlist')}</a>
              </p>
            )}
          </div>
        </Seccion>

        {!codigo && fase !== 'recuerdos' && (
          <Seccion id="confirmar" script={t('¿Nos acompañas?', 'Will you join us?')} titulo={t('Confirma tu asistencia', 'Please RSVP')} angosta>
            <BuscarCodigo />
          </Seccion>
        )}

        <Seccion id="firmas" script={t('Libro de', 'Our')} titulo={t('Mensajes', 'Guestbook')} alterna angosta>
          <LibroFirmas />
        </Seccion>
      </>}

      <footer className="pie-sitio">
        <div className="script">{novios.firma}</div>
        <div>{fechaLarga()}</div>
        <div className="chico" style={{ marginTop: 8 }}>{novios.hashtag}</div>
        {boda.contacto?.whatsapp && (
          <p className="chico" style={{ marginTop: 16 }}>
            {t('¿Dudas?', 'Questions?')} <a href={`https://wa.me/${boda.contacto.whatsapp}`} target="_blank" rel="noreferrer">
              {t(`Escríbele a ${boda.contacto.nombre} por WhatsApp`, `Message ${boda.contacto.nombre} on WhatsApp`)}
            </a>
          </p>
        )}
      </footer>
    </>
  );
}

function BuscarCodigo({ error }) {
  const [c, setC] = useState('');
  const ir = useNavigate();
  return (
    <form className="tarjeta centro" onSubmit={(e) => { e.preventDefault(); if (c.trim()) ir(`/i/${c.trim().toUpperCase()}`); }}>
      {error && <p className="aviso error">{error}</p>}
      <p>{t('Tu invitación trae un enlace personal. Si no lo tienes a mano, escribe el código que aparece en ella:',
        "Your invitation includes a personal link. If you don't have it handy, type the code printed on it:")}</p>
      <div style={{ display: 'flex', gap: 8, maxWidth: 360, margin: '0 auto' }}>
        <input value={c} onChange={(e) => setC(e.target.value)} placeholder={t('Ej. K7M2QX', 'E.g. K7M2QX')} autoCapitalize="characters" aria-label={t('Código de invitación', 'Invitation code')} style={{ textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center' }} />
        <button className="btn">{t('Abrir', 'Open')}</button>
      </div>
    </form>
  );
}
