import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { faseActual, faseAlMenos } from '../lib/fase';
import { fechaLarga, fechaCorta, descargarIcs, enlaceGoogleCalendar } from '../lib/fechas';
import { api } from '../lib/api';
import { t, useIdioma, contenido, BotonIdioma } from '../lib/idioma';
import Countdown from '../components/Countdown';
import Mapa from '../components/Mapa';
import Visor from '../components/Visor';
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
    setInv(undefined);
    window.scrollTo(0, 0);
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
          <a href="#inicio" className="marca">{novios.ella[0]} & {novios.el[0]}</a>
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
        <div className="portada-foto"><img src={boda.portada} alt={t(`${novios.ella} y ${novios.el}`, `${novios.ella} and ${novios.el}`)} fetchpriority="high" /></div>
        <div className="portada-texto">
          {inv?.grupo && <p className="saludo">{t('Para', 'For')} {inv.grupo.nombre}</p>}
          <p className="etiqueta versalita">{titulo}</p>
          <h1><span>{novios.ella}</span><span className="y" aria-label={t('y', 'and')}>&</span><span>{novios.el}</span></h1>
          <p className="fecha">{fase === 'save-the-date' ? fechaCorta() : fechaLarga()}</p>
          {fase !== 'recuerdos' && <Countdown />}
          <div className="acciones">
            {fase === 'boda' && <Link className="btn" to="/album">{t('Subir fotos al álbum', 'Upload photos to the album')}</Link>}
            {fase === 'recuerdos' && <Link className="btn" to="/album">{t('Ver el álbum', 'See the album')}</Link>}
            {fase === 'invitacion' && <a className="btn" href="#confirmar">{t('Confirmar asistencia', 'RSVP')}</a>}
            {(fase === 'save-the-date' || fase === 'invitacion') && <>
              <a className="btn claro" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">Google Calendar</a>
              <button className="btn claro" onClick={descargarIcs}>Apple / Outlook</button>
            </>}
          </div>
        </div>
      </header>

      {fase === 'boda' && (
        <Seccion id="hoy" titulo={t('Hoy', 'Today')} bajada={t('Toma fotos y súbelas al álbum compartido: así juntamos los momentos que nosotros no alcanzamos a ver.',
          "Take photos and upload them to the shared album, so we can collect the moments we didn't get to see.")} variante="alterna" dividida>
          <p><Link to="/album" className="btn">{t('Abrir el álbum', 'Open the album')}</Link></p>
          <p className="suave">{t('Usa', 'Use')} {novios.hashtag} {t('en redes sociales.', 'on social media.')}</p>
        </Seccion>
      )}

      {codigo && faseAlMenos(fase, 'invitacion') && (
        <Seccion id="confirmar" titulo={fase === 'recuerdos' ? t('Tu invitación', 'Your invitation') : t('Confirma tu asistencia', 'RSVP')} variante="oliva" angosta>
          {inv === undefined && <p>{t('Cargando tu invitación…', 'Loading your invitation…')}</p>}
          {inv === null && <BuscarCodigo error={t('No encontramos esa invitación. Revisa el código.', "We couldn't find that invitation. Please check the code.")} />}
          {inv && <Rsvp key={codigo} codigo={codigo} invitacion={inv} alResponder={setInv} cerrado={fase === 'recuerdos'} />}
        </Seccion>
      )}

      {codigo && fase === 'save-the-date' && inv && (
        <Seccion id="tuya" titulo={t('Reserva la fecha', 'Save the date')} variante="oliva" angosta>
          <p style={{ fontSize: '1.25rem' }}>{inv.grupo.nombre}: {t('queremos que estés con nosotros. Pronto te llegará la invitación formal con todos los detalles.',
            'we want you there with us. The formal invitation with all the details is coming soon.')}</p>
          <p style={{ color: 'var(--oliva-claro)' }}>
            {t('Tu invitación incluye', 'Your invitation includes')} {inv.grupo.pases} {inv.grupo.pases === 1 ? t('lugar', 'seat') : t('lugares', 'seats')}.
          </p>
        </Seccion>
      )}

      {/* ── Historia ── */}
      <Seccion id="historia" titulo={t('Nuestra historia', 'Our story')} dividida>
        <Revelar as="p" className="frase">{boda.frase}</Revelar>
        <ol className="hitos">
          {boda.historia.map((h, i) => (
            <Revelar as="li" key={i} className="hito">
              <span className="anio">{h.fecha}</span>
              <div><h3>{h.titulo}</h3><p>{h.texto}</p></div>
            </Revelar>
          ))}
        </ol>
      </Seccion>

      <Seccion id="fotos" titulo={t('Nosotros', 'Us')} variante="alterna">
        <GaleriaNosotros fotos={boda.galeria} />
      </Seccion>

      {faseAlMenos(fase, 'invitacion') && <>
        {/* ── Evento y mapa ── */}
        <Seccion id="evento" titulo={t('Dónde y cuándo', 'Where and when')} bajada={fechaLarga()} dividida>
          <div className="lugares">
            {boda.lugares.map((l, i) => (
              <Revelar key={l.id} className="lugar">
                <span className="num" aria-hidden>{i + 1}</span>
                <p className="tipo versalita">{l.tipo}</p>
                <h3>{l.nombre}</h3>
                <p className="detalle"><b>{l.hora}</b> · {l.direccion}</p>
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

        <Seccion id="programa" titulo={t('Programa', 'Schedule')} variante="alterna" dividida>
          <ol className="itinerario">
            {boda.itinerario.map((p, i) => (
              <Revelar as="li" key={i}>
                <span className="hora">{p.hora}</span><span className="que">{p.titulo}</span>
              </Revelar>
            ))}
          </ol>
        </Seccion>

        {/* ── Detalles ── */}
        <Seccion id="detalles" titulo={t('Detalles', 'Details')} dividida>
          <div className="detalles">
            <Revelar className="detalle-bloque">
              <h3>{t('Vestimenta', 'Dress code')}</h3>
              <p className="grande">{boda.vestimenta.codigo}</p>
              <p>{boda.vestimenta.detalle}</p>
              <div className="paleta" role="img" aria-label={t('Colores sugeridos', 'Suggested colors')}>{boda.vestimenta.paleta.map((c) => <span key={c} style={{ background: c }} />)}</div>
            </Revelar>
            <Revelar className="detalle-bloque">
              <h3>{t('Regalos', 'Gifts')}</h3>
              <p>{boda.regalos.texto}</p>
              {boda.regalos.opciones.map((o, i) => (
                <div key={i} className="opcion">
                  <b>{o.titulo}</b>
                  <div className="suave">{o.detalle}</div>
                  {o.copiar && <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><code>{o.copiar}</code> <Copiar texto={o.copiar}>{t('Copiar', 'Copy')}</Copiar></div>}
                  {o.enlace && <a className="btn claro chico" style={{ marginTop: 8 }} href={o.enlace} target="_blank" rel="noreferrer">{t('Ver', 'View')}</a>}
                </div>
              ))}
            </Revelar>
            {boda.hospedaje.length > 0 && (
              <Revelar className="detalle-bloque">
                <h3>{t('Hospedaje', 'Accommodation')}</h3>
                {boda.hospedaje.map((h, i) => (
                  <div key={i} className="opcion">
                    <b>{h.nombre}</b>
                    <div className="suave">{h.detalle}</div>
                    {h.enlace && <a href={h.enlace} target="_blank" rel="noreferrer">{t('Reservar', 'Book')}</a>}
                  </div>
                ))}
              </Revelar>
            )}
          </div>
          <div style={{ marginTop: 'clamp(48px, 8vw, 88px)' }}>
            <h3 style={{ marginBottom: 12 }}>{t('Preguntas frecuentes', 'FAQ')}</h3>
            {boda.preguntas.map((q, i) => (
              <details className="faq" key={i}><summary>{q.p}</summary><p>{q.r}</p></details>
            ))}
            {boda.playlist && (
              <p style={{ marginTop: 24 }}>
                <a className="btn claro" href={boda.playlist} target="_blank" rel="noreferrer">{t('Agrega canciones a nuestra playlist', 'Add songs to our playlist')}</a>
              </p>
            )}
          </div>
        </Seccion>

        {!codigo && fase !== 'recuerdos' && (
          <Seccion id="confirmar" titulo={t('Confirma tu asistencia', 'RSVP')} variante="oliva" angosta>
            <BuscarCodigo />
          </Seccion>
        )}

        <Seccion id="firmas" titulo={t('Libro de firmas', 'Guestbook')} bajada={t('Déjanos unas palabras. Las vamos a leer muchas veces.', "Leave us a few words. We'll read them again and again.")} variante="alterna" angosta>
          <LibroFirmas />
        </Seccion>
      </>}

      <footer className="pie-sitio">
        <div className="contenedor">
          <p className="nombres">{novios.ella} & {novios.el}</p>
          <p>{fechaLarga()}</p>
          <p>{novios.hashtag}</p>
          {boda.contacto?.whatsapp && (
            <p style={{ marginTop: 24 }}>
              {t('¿Dudas?', 'Questions?')} <a href={`https://wa.me/${boda.contacto.whatsapp}`} target="_blank" rel="noreferrer">
                {t(`Escríbele a ${boda.contacto.nombre} por WhatsApp`, `Message ${boda.contacto.nombre} on WhatsApp`)}
              </a>
            </p>
          )}
        </div>
      </footer>
    </>
  );
}

function GaleriaNosotros({ fotos }) {
  const [i, setI] = useState(null);
  const items = fotos.map((url) => ({ url }));
  return (
    <>
      <div className="galeria-nosotros">
        {items.map((f, n) => (
          <Revelar as="button" key={f.url} type="button" onClick={() => setI(n)} aria-label={t(`Ver foto ${n + 1}`, `View photo ${n + 1}`)}>
            <img src={f.url} alt="" loading="lazy" decoding="async" />
          </Revelar>
        ))}
      </div>
      {i != null && <Visor items={items} indice={i} alCambiar={setI} alCerrar={() => setI(null)} />}
    </>
  );
}

function BuscarCodigo({ error }) {
  const [c, setC] = useState('');
  const ir = useNavigate();
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (c.trim()) ir(`/i/${c.trim().toUpperCase()}`); }}>
      {error && <p className="aviso error">{error}</p>}
      <p style={{ maxWidth: '46ch' }}>{t('Tu invitación trae un enlace personal. Si no lo tienes a mano, escribe el código que aparece en ella.',
        "Your invitation includes a personal link. If you don't have it handy, type the code printed on it.")}</p>
      <div className="buscar-codigo">
        <input value={c} onChange={(e) => setC(e.target.value)} placeholder="K7M2QX" autoCapitalize="characters" autoComplete="off" maxLength={8} aria-label={t('Código de invitación', 'Invitation code')} />
        <button className="btn">{t('Abrir', 'Open')}</button>
      </div>
    </form>
  );
}
