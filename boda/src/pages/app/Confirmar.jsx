import { useState } from 'react';
import { t, useIdioma } from '../../lib/idioma';
import { useFase, medianocheLugar } from '../../lib/fase';
import { boda } from '../../config';
import { locale } from '../../lib/idioma';
import { useInvitacion, usarCodigo, actualizarInvitacion, olvidarCodigo } from '../../lib/miInvitacion';
import { PaginaApp } from '../../components/AppMarco';
import Rsvp from '../Rsvp';

/** La confirmación, sola en su pestaña. Recuerda el código del enlace personal. */
export default function Confirmar() {
  useIdioma();
  const { fase } = useFase();
  const { codigo, inv } = useInvitacion();
  const g = inv?.grupo;
  const titulo = fase === 'save-the-date' ? t('Tu lugar', 'Your seat') : fase === 'recuerdos' ? t('Tu invitación', 'Your invitation') : t('Confirma tu asistencia', 'RSVP');
  return (
    <PaginaApp titulo={titulo} variante="oliva-app">
      {inv === undefined && codigo && <p>{t('Cargando tu invitación…', 'Loading your invitation…')}</p>}
      {fase !== 'save-the-date' && (!codigo || inv === null) && <BuscarCodigo error={codigo && inv === null ? t('No encontramos esa invitación. Revisa el código.', "We couldn't find that invitation. Please check the code.") : ''} />}
      {fase === 'save-the-date' && <LoQueViene nombre={g?.nombre} pases={g?.pases} />}
      {g && fase !== 'save-the-date' && <Rsvp key={g.codigo} codigo={g.codigo} invitacion={inv} alResponder={actualizarInvitacion} cerrado={fase === 'recuerdos'} />}
      {g && <p className="chico" style={{ marginTop: 40, opacity: .75 }}>{t(`¿No eres de ${g.nombre}?`, `Not ${g.nombre}?`)} <button type="button" className="btn enlace" onClick={olvidarCodigo}>{t('Usar otro código', 'Use another code')}</button></p>}
    </PaginaApp>
  );
}

export function BuscarCodigo({ error }) {
  const [c, setC] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (c.trim()) usarCodigo(c); }}>
      {error && <p className="aviso error">{error}</p>}
      <p style={{ maxWidth: '46ch', fontSize: '1.125rem' }}>{t('Tu invitación trae un enlace personal. Si no lo tienes a mano, escribe el código que aparece en ella.',
        "Your invitation includes a personal link. If you don't have it handy, type the code printed on it.")}</p>
      <div className="buscar-codigo">
        <input value={c} onChange={(e) => setC(e.target.value)} placeholder="K7M2QX" autoCapitalize="characters" autoComplete="off" maxLength={8} aria-label={t('Código de invitación', 'Invitation code')} />
        <button className="btn">{t('Abrir', 'Open')}</button>
      </div>
    </form>
  );
}

/**
 * Antes de que salgan las invitaciones, la pestaña no queda vacía ni pide un
 * código que todavía no sirve: dice cuándo se abre la confirmación y qué
 * viene, con los días que faltan.
 */
function LoQueViene({ nombre, pases }) {
  const abre = medianocheLugar(boda.invitacionesDesde);
  const dias = Math.max(0, Math.ceil((abre - Date.now()) / 864e5));
  const cuando = new Date(`${boda.invitacionesDesde}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
  const limite = boda.confirmarAntesDe ? new Date(`${boda.confirmarAntesDe}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long' }) : '';
  return (
    <div className="lo-que-viene">
      {nombre && <p className="lqv-para">{nombre}: {t('queremos que estés con nosotros.', 'we want you there with us.')}</p>}
      <div className="lqv-cuenta" aria-label={t(`Faltan ${dias} días para que se abra la confirmación`, `${dias} days until RSVP opens`)}>
        <b>{dias}</b>
        <span>{dias === 1 ? t('día para que se abra la confirmación', 'day until RSVP opens') : t('días para que se abra la confirmación', 'days until RSVP opens')}</span>
      </div>
      <ol className="lqv-pasos">
        <li><span className="versalita">{cuando}</span><p>{t('Te llega la invitación formal, con tu enlace personal.', 'Your formal invitation arrives, with your personal link.')}</p></li>
        <li><span className="versalita">{t('Desde ese día', 'From that day')}</span><p>{t('Aquí mismo confirmas quién va contigo, en un minuto.', 'Right here you confirm who is coming, in a minute.')}</p></li>
        {limite && <li><span className="versalita">{limite}</span><p>{t('Último día para confirmar.', 'Last day to RSVP.')}</p></li>}
      </ol>
      {pases ? <p className="lqv-pases">{t('Tu invitación incluye', 'Your invitation includes')} {pases} {pases === 1 ? t('lugar', 'seat') : t('lugares', 'seats')}.</p> : null}
    </div>
  );
}
