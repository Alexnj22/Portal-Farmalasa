import { useState } from 'react';
import { Link } from 'react-router-dom';
import { contenido, t, useIdioma } from '../../lib/idioma';
import { fechaLarga, descargarIcs, enlaceGoogleCalendar } from '../../lib/fechas';
import { faseActual } from '../../lib/fase';
import { PaginaApp } from '../../components/AppMarco';
import Mapa from '../../components/Mapa';
import Copiar from '../../components/Copiar';
import Icono from '../../components/Iconos';

/** Todo lo práctico de la boda en una pantalla: dónde, a qué hora, qué ponerse. */
export default function Evento() {
  const idioma = useIdioma();
  const boda = contenido(idioma);
  const fase = faseActual();
  const [lugar, setLugar] = useState(null);
  return (
    <PaginaApp titulo={<>{t('Dónde y', 'Where and')} <em>{t('cuándo', 'when')}</em></>} bajada={fechaLarga()}>
      <div className="saltos" role="navigation" aria-label={t('En esta página', 'On this page')}>
        <a href="#lugares">{t('Lugar', 'Venue')}</a><a href="#programa">{t('Programa', 'Schedule')}</a>
        <a href="#vestimenta">{t('Vestimenta', 'Dress code')}</a><a href="#regalos">{t('Regalos', 'Gifts')}</a><a href="#preguntas">{t('Preguntas', 'FAQ')}</a>
      </div>

      <section id="lugares" className="bloque-app">
        {boda.lugares.map((l, i) => (
          <article key={l.id} className="lugar-app">
            <span className="num" aria-hidden>{i + 1}</span>
            <p className="versalita suave">{l.tipo} · {l.hora}</p>
            <h2>{l.nombre}</h2>
            <p className="suave">{l.direccion}</p>
            <div className="botones-app">
              <a className="btn" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`}><Icono n="lugar" tam={20} /> {t('Cómo llegar', 'Directions')}</a>
              <a className="btn claro" target="_blank" rel="noreferrer" href={`https://waze.com/ul?ll=${l.lat},${l.lng}&navigate=yes`}>Waze</a>
              <button type="button" className="btn claro" onClick={() => setLugar(l.id)}>{t('Ver en el mapa', 'Show on map')}</button>
            </div>
          </article>
        ))}
        <Mapa lugares={boda.lugares} enfocado={lugar} />
        {fase !== 'recuerdos' && (
          <div className="botones-app" style={{ marginTop: 16 }}>
            <a className="btn claro" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer"><Icono n="calendario" tam={20} /> Google Calendar</a>
            <button type="button" className="btn claro" onClick={descargarIcs}><Icono n="calendario" tam={20} /> Apple / Outlook</button>
          </div>
        )}
      </section>

      <section id="programa" className="bloque-app">
        <h2 className="sub-app">{t('Programa', 'Schedule')}</h2>
        <ol className="itinerario">
          {boda.itinerario.map((p, i) => <li key={i}><span className="hora">{p.hora}</span><span className="que">{p.titulo}</span></li>)}
        </ol>
      </section>

      <section id="vestimenta" className="bloque-app">
        <h2 className="sub-app">{t('Vestimenta', 'Dress code')}</h2>
        <p className="grande-app">{boda.vestimenta.codigo}</p>
        <p>{boda.vestimenta.detalle}</p>
        <div className="paleta" role="img" aria-label={t('Colores sugeridos', 'Suggested colors')}>{boda.vestimenta.paleta.map((c) => <span key={c} style={{ background: c }} />)}</div>
      </section>

      <section id="regalos" className="bloque-app">
        <h2 className="sub-app">{t('Regalos', 'Gifts')}</h2>
        <p>{boda.regalos.texto}</p>
        {boda.regalos.opciones.map((o, i) => (
          <div key={i} className="opcion">
            <b>{o.titulo}</b>
            <div className="suave">{o.detalle}</div>
            {o.copiar && <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><code>{o.copiar}</code> <Copiar texto={o.copiar}>{t('Copiar', 'Copy')}</Copiar></div>}
            {o.enlace && <a className="btn claro chico" style={{ marginTop: 8 }} href={o.enlace} target="_blank" rel="noreferrer">{t('Ver', 'View')}</a>}
          </div>
        ))}
        {boda.hospedaje.length > 0 && <>
          <h3 style={{ marginTop: 28 }}>{t('Hospedaje', 'Accommodation')}</h3>
          {boda.hospedaje.map((h, i) => (
            <div key={i} className="opcion"><b>{h.nombre}</b><div className="suave">{h.detalle}</div>{h.enlace && <a href={h.enlace} target="_blank" rel="noreferrer">{t('Reservar', 'Book')}</a>}</div>
          ))}
        </>}
      </section>

      <section id="preguntas" className="bloque-app">
        <h2 className="sub-app">{t('Preguntas frecuentes', 'FAQ')}</h2>
        {boda.preguntas.map((q, i) => <details className="faq" key={i}><summary>{q.p}</summary><p>{q.r}</p></details>)}
        {fase !== 'recuerdos' && <p style={{ marginTop: 24 }}><Link className="btn claro" to="/canciones"><Icono n="musica" tam={20} /> {t('Pide una canción', 'Request a song')}</Link></p>}
      </section>
    </PaginaApp>
  );
}
