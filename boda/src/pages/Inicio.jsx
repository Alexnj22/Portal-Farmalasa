import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { boda } from '../config';
import { faseActual, faseAlMenos } from '../lib/fase';
import { fechaLarga, fechaCorta, descargarIcs, enlaceGoogleCalendar } from '../lib/fechas';
import { api } from '../lib/api';
import Countdown from '../components/Countdown';
import Mapa from '../components/Mapa';
import Mosaico from '../components/Mosaico';
import Seccion from '../components/Seccion';
import Revelar from '../components/Revelar';
import Copiar from '../components/Copiar';
import Rsvp from './Rsvp';
import LibroFirmas from './LibroFirmas';

const { novios } = boda;

export default function Inicio({ codigo }) {
  const fase = faseActual();
  const [inv, setInv] = useState(undefined); // undefined = cargando, null = no existe
  const [lugar, setLugar] = useState(null);

  useEffect(() => {
    if (!codigo) { setInv(null); return; }
    api.getInvitacion(codigo).then(setInv).catch(() => setInv(null));
  }, [codigo]);

  const secciones = useMemo(() => {
    const s = [];
    if (fase === 'boda') s.push(['hoy', 'Hoy']);
    if (codigo && faseAlMenos(fase, 'invitacion')) s.push(['confirmar', 'Confirmar']);
    s.push(['historia', 'Historia'], ['fotos', 'Fotos']);
    if (faseAlMenos(fase, 'invitacion')) s.push(['evento', 'Evento'], ['programa', 'Programa'], ['detalles', 'Detalles']);
    if (!codigo && faseAlMenos(fase, 'invitacion') && fase !== 'recuerdos') s.push(['confirmar', 'Confirmar']);
    if (faseAlMenos(fase, 'invitacion')) s.push(['firmas', 'Mensajes']);
    return s;
  }, [fase, codigo]);

  const titulo = fase === 'save-the-date' ? 'Save the date'
    : fase === 'recuerdos' ? '¡Gracias por acompañarnos!'
    : fase === 'boda' ? '¡Hoy nos casamos!' : 'Nos casamos';

  return (
    <>
      <nav className="nav">
        <div className="contenedor">
          <a href="#inicio" className="marca">{novios.el[0]} & {novios.ella[0]}</a>
          <ul>
            {secciones.map(([id, t]) => <li key={id}><a href={`#${id}`}>{t}</a></li>)}
            {faseAlMenos(fase, 'boda') && <li><Link to="/album">Álbum</Link></li>}
          </ul>
        </div>
      </nav>

      {/* ── Portada ── */}
      <header id="inicio" className="portada">
        <img className="fondo" src={boda.portada} alt="" fetchpriority="high" />
        <div className="contenedor">
          {inv?.grupo && <p style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontStyle: 'italic' }}>
            Querida {inv.grupo.nombre}:
          </p>}
          <div className="etiqueta">{titulo}</div>
          <h1>{novios.el} <span style={{ fontSize: '0.6em' }}>&</span> {novios.ella}</h1>
          <div className="fecha">{fase === 'save-the-date' ? fechaCorta() : fechaLarga()}</div>
          {fase !== 'recuerdos' && <Countdown />}
          <div className="acciones">
            {fase === 'boda' && <Link className="btn blanco" to="/album">📸 Sube tus fotos</Link>}
            {fase === 'recuerdos' && <Link className="btn blanco" to="/album">Ver el álbum</Link>}
            {(fase === 'save-the-date' || fase === 'invitacion') && <>
              <a className="btn blanco" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">Agregar a Google Calendar</a>
              <button className="btn vidrio" onClick={descargarIcs}>Apple / Outlook (.ics)</button>
            </>}
            {fase === 'invitacion' && <a className="btn vidrio" href="#confirmar">Confirmar asistencia</a>}
          </div>
        </div>
      </header>

      {fase === 'boda' && (
        <Seccion id="hoy" script="Hoy" titulo="Comparte el día con nosotros" angosta>
          <div className="tarjeta centro">
            <p>Toma fotos y súbelas al álbum compartido. Así juntamos todos los momentos que nosotros no alcanzamos a ver.</p>
            <Link to="/album" className="btn oro">Abrir el álbum</Link>
            <p className="suave chico" style={{ marginTop: 14 }}>Usa {boda.novios.hashtag} en redes sociales.</p>
          </div>
        </Seccion>
      )}

      {codigo && faseAlMenos(fase, 'invitacion') && (
        <Seccion id="confirmar" script="Tu invitación" titulo={fase === 'recuerdos' ? 'Tu invitación' : 'Confirma tu asistencia'} angosta>
          {inv === undefined && <p className="centro suave">Cargando tu invitación…</p>}
          {inv === null && <BuscarCodigo error="No encontramos esa invitación. Revisa el código." />}
          {inv && <Rsvp codigo={codigo} invitacion={inv} alResponder={setInv} cerrado={fase === 'recuerdos'} />}
        </Seccion>
      )}

      {codigo && fase === 'save-the-date' && inv && (
        <Seccion id="tuya" titulo="¡Reserva la fecha!" angosta>
          <div className="sobre">
            <p className="script" style={{ fontSize: '2rem', color: 'var(--oro)' }}>{inv.grupo.nombre}</p>
            <p>Queremos que estés con nosotros. Pronto te llegará la invitación formal con todos los detalles.</p>
            <p className="suave chico">Tu invitación incluye {inv.grupo.pases} {inv.grupo.pases === 1 ? 'pase' : 'pases'}.</p>
          </div>
        </Seccion>
      )}

      {/* ── Historia ── */}
      <Seccion id="historia" script="Nuestra" titulo="Historia" alterna>
        <Revelar as="p" className="centro angosto suave" style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontStyle: 'italic', marginBottom: 48 }}>
          {boda.frase}
        </Revelar>
        <div className="linea-tiempo">
          {boda.historia.map((h) => (
            <Revelar key={h.titulo} className="hito">
              <div className="anio">{h.fecha}</div>
              <h3>{h.titulo}</h3>
              <p className="suave">{h.texto}</p>
            </Revelar>
          ))}
        </div>
      </Seccion>

      <Seccion id="fotos" script="Momentos" titulo="Nosotros">
        <Mosaico items={boda.galeria.map((url) => ({ url }))} />
      </Seccion>

      {faseAlMenos(fase, 'invitacion') && <>
        {/* ── Evento y mapa ── */}
        <Seccion id="evento" script="Dónde y cuándo" titulo="El gran día" alterna>
          <div className="rejilla" style={{ marginBottom: 24 }}>
            {boda.lugares.map((l, i) => (
              <Revelar key={l.id} className="tarjeta lugar">
                <div className="tipo">{i + 1} · {l.tipo}</div>
                <h3>{l.nombre}</h3>
                <p className="suave" style={{ margin: 0 }}>{l.direccion}</p>
                <p style={{ margin: '4px 0 0', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>{l.hora}</p>
                <div className="botones">
                  <button className="btn claro chico" onClick={() => setLugar(l.id)}>Ver en el mapa</button>
                  <a className="btn claro chico" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`}>Google Maps</a>
                  <a className="btn claro chico" target="_blank" rel="noreferrer" href={`https://waze.com/ul?ll=${l.lat},${l.lng}&navigate=yes`}>Waze</a>
                </div>
              </Revelar>
            ))}
          </div>
          <Mapa lugares={boda.lugares} enfocado={lugar} />
        </Seccion>

        <Seccion id="programa" script="El" titulo="Programa">
          <ul className="itinerario">
            {boda.itinerario.map((p) => (
              <Revelar as="li" key={p.hora + p.titulo}>
                <span className="hora">{p.hora}</span><span className="ic" aria-hidden>{p.icono}</span><span>{p.titulo}</span>
              </Revelar>
            ))}
          </ul>
        </Seccion>

        {/* ── Detalles ── */}
        <Seccion id="detalles" script="Para tomar en cuenta" titulo="Detalles" alterna>
          <div className="rejilla">
            <Revelar className="tarjeta centro">
              <h3>Código de vestimenta</h3>
              <p style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', margin: 0 }}>{boda.vestimenta.codigo}</p>
              <p className="suave chico">{boda.vestimenta.detalle}</p>
              <div className="paleta">{boda.vestimenta.paleta.map((c) => <span key={c} style={{ background: c }} title={c} />)}</div>
            </Revelar>
            <Revelar className="tarjeta centro">
              <h3>Regalos</h3>
              <p className="suave chico">{boda.regalos.texto}</p>
              {boda.regalos.opciones.map((o) => (
                <div key={o.titulo} style={{ marginBottom: 14 }}>
                  <b>{o.titulo}</b>
                  <div className="suave chico">{o.detalle}</div>
                  {o.copiar && <div style={{ marginTop: 6 }}><code>{o.copiar}</code> <Copiar texto={o.copiar} /></div>}
                  {o.enlace && <a className="btn claro chico" href={o.enlace} target="_blank" rel="noreferrer">Ver</a>}
                </div>
              ))}
            </Revelar>
            {boda.hospedaje.length > 0 && (
              <Revelar className="tarjeta centro">
                <h3>Hospedaje</h3>
                {boda.hospedaje.map((h) => (
                  <div key={h.nombre} style={{ marginBottom: 12 }}>
                    <b>{h.nombre}</b>
                    <div className="suave chico">{h.detalle}</div>
                    {h.enlace && <a href={h.enlace} target="_blank" rel="noreferrer">Reservar</a>}
                  </div>
                ))}
              </Revelar>
            )}
          </div>
          <div className="angosto" style={{ marginTop: 48 }}>
            <h3 className="centro">Preguntas frecuentes</h3>
            {boda.preguntas.map((q) => (
              <details className="faq" key={q.p}><summary>{q.p}</summary><p>{q.r}</p></details>
            ))}
            {boda.playlist && (
              <p className="centro" style={{ marginTop: 24 }}>
                <a className="btn claro" href={boda.playlist} target="_blank" rel="noreferrer">🎵 Agrega canciones a nuestra playlist</a>
              </p>
            )}
          </div>
        </Seccion>

        {!codigo && fase !== 'recuerdos' && (
          <Seccion id="confirmar" script="¿Nos acompañas?" titulo="Confirma tu asistencia" angosta>
            <BuscarCodigo />
          </Seccion>
        )}

        <Seccion id="firmas" script="Libro de" titulo="Mensajes" alterna angosta>
          <LibroFirmas />
        </Seccion>
      </>}

      <footer className="pie-sitio">
        <div className="script">{novios.firma}</div>
        <div>{fechaLarga()}</div>
        <div className="chico" style={{ marginTop: 8 }}>{boda.novios.hashtag}</div>
        {boda.contacto?.whatsapp && (
          <p className="chico" style={{ marginTop: 16 }}>
            ¿Dudas? <a href={`https://wa.me/${boda.contacto.whatsapp}`} target="_blank" rel="noreferrer">Escríbele a {boda.contacto.nombre} por WhatsApp</a>
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
      <p>Tu invitación trae un enlace personal. Si no lo tienes a mano, escribe el código que aparece en ella:</p>
      <div style={{ display: 'flex', gap: 8, maxWidth: 360, margin: '0 auto' }}>
        <input value={c} onChange={(e) => setC(e.target.value)} placeholder="Ej. K7M2QX" autoCapitalize="characters" aria-label="Código de invitación" style={{ textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center' }} />
        <button className="btn">Abrir</button>
      </div>
    </form>
  );
}
