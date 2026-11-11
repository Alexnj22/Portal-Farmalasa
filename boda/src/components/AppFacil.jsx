import { useEffect, useState } from 'react';
import { contenido, t, useIdioma } from '../lib/idioma';
import { faseActual, faseAlMenos } from '../lib/fase';
import { fechaBoda } from '../config';
import { useInvitacion, usarCodigo, actualizarInvitacion } from '../lib/miInvitacion';
import { cambiarFacil } from '../lib/facil';
import { api } from '../lib/api';
import { locale } from '../lib/idioma';
import { BotonEscuchar } from './Facil';
import Presentacion from './Presentacion';
import Icono from './Iconos';
import Rsvp from '../pages/Rsvp';

/*
 * La app para los abuelos: una pantalla, lo esencial y botones enormes.
 * Nada que deslizar de lado, nada escondido en menús: cada botón dice
 * exactamente lo que hace y lleva a una sola cosa, con «Volver» bien grande.
 */
export default function AppFacil() {
  const idioma = useIdioma();
  const boda = contenido(idioma);
  const fase = faseActual();
  const { inv } = useInvitacion();
  const [pantalla, setPantalla] = useState('inicio');
  const [fotos, setFotos] = useState(null);
  useEffect(() => { window.scrollTo(0, 0); }, [pantalla]);

  const volver = () => setPantalla('inicio');
  const lugar = boda.lugares[0];
  const g = inv?.grupo;
  const van = inv?.personas?.filter((p) => p.asistira) || [];
  const mesa = van.find((p) => p.mesa)?.mesa;
  const fechaTexto = fechaBoda.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: boda.zonaHoraria });
  const horaTexto = lugar?.hora;

  if (pantalla === 'confirmar' && inv) {
    return (
      <div className="facil-pantalla oliva-facil">
        <BotonVolver alVolver={volver} />
        <Rsvp key={g.codigo} codigo={g.codigo} invitacion={inv} alResponder={(r) => { actualizarInvitacion(r); }} cerrado={fase === 'recuerdos'} />
        {g.respondido_at && <button type="button" className="btn enorme claro" style={{ marginTop: 24 }} onClick={volver}>{t('Listo, volver al inicio', 'Done, back to start')}</button>}
      </div>
    );
  }
  if (pantalla === 'llegar') {
    return (
      <div className="facil-pantalla">
        <BotonVolver alVolver={volver} />
        <h1 className="facil-titulo">{t('Cómo llegar', 'How to get there')}</h1>
        {boda.lugares.map((l) => (
          <div key={l.id} className="facil-lugar">
            <p className="facil-etiqueta">{l.tipo} · {l.hora}</p>
            <p className="facil-grande">{l.nombre}</p>
            <p className="facil-texto">{l.direccion}</p>
            <a className="facil-boton principal" href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`} target="_blank" rel="noreferrer">
              <Icono n="lugar" tam={30} /><span>{t('Abrir el mapa', 'Open the map')}</span>
            </a>
            <a className="facil-boton" href={`https://waze.com/ul?ll=${l.lat},${l.lng}&navigate=yes`} target="_blank" rel="noreferrer">
              <Icono n="flecha" tam={30} /><span>{t('Abrir en Waze', 'Open in Waze')}</span>
            </a>
          </div>
        ))}
      </div>
    );
  }
  if (pantalla === 'codigo') {
    return <PedirCodigo alVolver={volver} alListo={(c) => { usarCodigo(c); setPantalla('inicio'); }} />;
  }

  // ── Inicio ────────────────────────────────────────────────
  return (
    <div className="facil-pantalla">
      {fotos && <Presentacion fotos={fotos} alCerrar={() => setFotos(null)} />}
      <p className="facil-hola">{g ? t(`Hola, ${g.nombre}`, `Hello, ${g.nombre}`) : t('Hola', 'Hello')}</p>

      <div className="facil-tarjeta">
        <p className="facil-etiqueta">{t('La boda de', 'The wedding of')}</p>
        <p className="facil-nombres">{boda.novios.ella} {t('y', 'and')} {boda.novios.el}</p>
        <p className="facil-dato"><Icono n="calendario" tam={30} /><span>{fechaTexto}</span></p>
        {horaTexto && <p className="facil-dato"><Icono n="hoy" tam={30} /><span>{horaTexto}</span></p>}
        {lugar && <p className="facil-dato"><Icono n="lugar" tam={30} /><span>{lugar.nombre}</span></p>}
      </div>

      {/* Lo único que hay que hacer, arriba de todo */}
      {fase === 'boda' && mesa && (
        <div className="facil-estado listo"><p className="facil-etiqueta">{t('Su mesa', 'Your table')}</p><p className="facil-mesa">{mesa}</p></div>
      )}
      {faseAlMenos(fase, 'invitacion') && fase !== 'recuerdos' && fase !== 'boda' && (
        inv === undefined ? null
          : !g ? (
            <button type="button" className="facil-boton principal" onClick={() => setPantalla('codigo')}><Icono n="confirmar" tam={32} /><span>{t('Confirmar si voy', 'Reply to the invitation')}</span></button>
          ) : !g.respondido_at ? (
            <button type="button" className="facil-boton principal enorme-facil" onClick={() => setPantalla('confirmar')}>
              <Icono n="confirmar" tam={34} /><span>{t('Confirmar si voy', 'Reply to the invitation')}</span>
            </button>
          ) : (
            <div className="facil-estado listo">
              <p className="facil-grande">✓ {t('Usted ya respondió', 'You already replied')}</p>
              <p className="facil-texto">{van.length ? `${t('Van', 'Coming')}: ${van.map((p) => p.nombre).join(', ')}` : t('Avisó que no puede ir.', "You said you can't come.")}</p>
              <button type="button" className="btn enlace facil-enlace" onClick={() => setPantalla('confirmar')}>{t('Cambiar mi respuesta', 'Change my answer')}</button>
            </div>
          )
      )}

      <div className="facil-lista">
        <BotonEscuchar boda={boda} inv={inv} className="facil-boton" />
        <button type="button" className="facil-boton" onClick={() => setPantalla('llegar')}><Icono n="lugar" tam={30} /><span>{t('Cómo llegar', 'How to get there')}</span></button>
        {boda.contacto?.whatsapp && <>
          <a className="facil-boton" href={`tel:+${boda.contacto.whatsapp}`}><Icono n="tel" tam={30} /><span>{t(`Llamar a ${boda.contacto.nombre}`, `Call ${boda.contacto.nombre}`)}</span></a>
          <a className="facil-boton" href={`https://wa.me/${boda.contacto.whatsapp}`} target="_blank" rel="noreferrer"><Icono n="whatsapp" tam={30} /><span>{t('Escribir por WhatsApp', 'Message on WhatsApp')}</span></a>
        </>}
        {faseAlMenos(fase, 'boda') && (
          <button type="button" className="facil-boton" onClick={() => api.listarFotos().then(setFotos).catch(() => {})}><Icono n="fotos" tam={30} /><span>{t('Ver las fotos', 'See the photos')}</span></button>
        )}
      </div>

      <button type="button" className="facil-salir" onClick={() => cambiarFacil(false)}>
        <Icono n="letra" tam={22} /> {t('Volver a la letra normal', 'Back to normal text')}
      </button>
    </div>
  );
}

function BotonVolver({ alVolver }) {
  return (
    <button type="button" className="facil-volver" onClick={alVolver}>
      <Icono n="atras" tam={30} grueso={2.4} /> {t('Volver', 'Back')}
    </button>
  );
}

function PedirCodigo({ alVolver, alListo }) {
  const [c, setC] = useState('');
  return (
    <div className="facil-pantalla">
      <BotonVolver alVolver={alVolver} />
      <h1 className="facil-titulo">{t('Escriba el código de su invitación', 'Type your invitation code')}</h1>
      <p className="facil-texto">{t('Son 6 letras y números. Vienen en la invitación que le enviaron.', 'Six letters and numbers, printed on your invitation.')}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (c.trim()) alListo(c); }}>
        <input className="facil-campo" value={c} onChange={(e) => setC(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" maxLength={8} aria-label={t('Código', 'Code')} autoFocus />
        <button className="facil-boton principal"><Icono n="confirmar" tam={30} /><span>{t('Seguir', 'Continue')}</span></button>
      </form>
    </div>
  );
}
