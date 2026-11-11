import { useState } from 'react';
import { t, useIdioma } from '../../lib/idioma';
import { faseActual } from '../../lib/fase';
import { useInvitacion, usarCodigo, actualizarInvitacion, olvidarCodigo } from '../../lib/miInvitacion';
import { PaginaApp } from '../../components/AppMarco';
import Rsvp from '../Rsvp';

/** La confirmación, sola en su pestaña. Recuerda el código del enlace personal. */
export default function Confirmar() {
  useIdioma();
  const fase = faseActual();
  const { codigo, inv } = useInvitacion();
  const g = inv?.grupo;
  const titulo = fase === 'save-the-date' ? t('Tu lugar', 'Your seat') : fase === 'recuerdos' ? t('Tu invitación', 'Your invitation') : t('Confirma tu asistencia', 'RSVP');
  return (
    <PaginaApp titulo={titulo} variante="oliva-app">
      {inv === undefined && codigo && <p>{t('Cargando tu invitación…', 'Loading your invitation…')}</p>}
      {(!codigo || inv === null) && <BuscarCodigo error={codigo && inv === null ? t('No encontramos esa invitación. Revisa el código.', "We couldn't find that invitation. Please check the code.") : ''} />}
      {g && fase === 'save-the-date' && (
        <div>
          <p style={{ fontSize: '1.375rem' }}>{g.nombre}: {t('queremos que estés con nosotros. Pronto te llegará la invitación formal con todos los detalles.', 'we want you there with us. The formal invitation is coming soon.')}</p>
          <p>{t('Tu invitación incluye', 'Your invitation includes')} {g.pases} {g.pases === 1 ? t('lugar', 'seat') : t('lugares', 'seats')}.</p>
        </div>
      )}
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
