import { useState } from 'react';
import { api } from '../lib/api';
import { limiteConfirmar, plazoVencido } from '../lib/fechas';
import { t } from '../lib/idioma';
import { enlaceInvitacion } from '../lib/codigo';
import QR from '../components/QR';

export default function Rsvp({ codigo, invitacion, alResponder, cerrado }) {
  const { grupo, personas } = invitacion;
  // La fecha límite la manda la base (es la que hace cumplir); el config es el respaldo.
  const limite = invitacion.limite || undefined;
  const vencido = plazoVencido(limite);
  const [editando, setEditando] = useState(!grupo.respondido_at);
  const [filas, setFilas] = useState(() => {
    const f = personas.map((p) => ({ ...p, restriccion: p.restriccion || '' }));
    for (let i = f.length; i < grupo.pases; i++) f.push({ id: null, nombre: '', asistira: null, restriccion: '', extra: true });
    return f;
  });
  const [mensaje, setMensaje] = useState(grupo.mensaje || '');
  const [cancion, setCancion] = useState(grupo.cancion || '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const cambiar = (i, k, v) => setFilas((f) => f.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  const todosNo = () => setFilas((f) => f.map((x) => ({ ...x, asistira: false })));

  async function enviar(e) {
    e.preventDefault();
    setError('');
    const validas = filas.filter((f) => !f.extra || f.nombre.trim());
    if (validas.some((f) => f.asistira == null)) { setError(t('Indica si cada persona asistirá.', 'Please tell us whether each person will attend.')); return; }
    if (filas.some((f) => f.extra && !f.nombre.trim() && f.asistira)) { setError(t('Escribe el nombre de tu acompañante.', "Please write your guest's name.")); return; }
    setEnviando(true);
    try {
      const r = await api.responder(codigo, {
        personas: validas.map(({ id, nombre, asistira, restriccion }) => ({ id, nombre, asistira, restriccion })),
        mensaje, cancion,
      });
      alResponder(r);
      setEditando(false);
      window.scrollTo({ top: document.getElementById('confirmar').offsetTop - 60, behavior: 'smooth' });
    } catch (err) {
      setError(err.message || t('No se pudo enviar. Intenta de nuevo.', 'Could not send. Please try again.'));
    } finally {
      setEnviando(false);
    }
  }

  const sobre = (
    <div className="sobre" style={{ marginBottom: 20 }}>
      <p className="suave chico" style={{ letterSpacing: '.2em', textTransform: 'uppercase' }}>{t('Invitación para', 'Invitation for')}</p>
      <p className="script" style={{ fontSize: '2.4rem', color: 'var(--oro)', margin: 0 }}>{grupo.nombre}</p>
      <p className="suave">
        {t('Hemos reservado', 'We have reserved')} <b>{grupo.pases} {grupo.pases === 1 ? t('lugar', 'seat') : t('lugares', 'seats')}</b> {t('en tu honor.', 'in your honor.')}
      </p>
    </div>
  );

  if (!editando) {
    const van = personas.filter((p) => p.asistira);
    const mesas = [...new Set(van.map((p) => p.mesa).filter(Boolean))];
    return (
      <>
        {sobre}
        <div className="tarjeta centro">
          {van.length ? <>
            <h3>{t('¡Gracias por confirmar! 🎉', 'Thank you for confirming! 🎉')}</h3>
            <p>{t('Te esperamos', 'We look forward to seeing you')}: {van.map((p) => p.nombre).join(', ')}.</p>
            {mesas.length > 0 && (
              <p style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem' }}>{t('Tu mesa', 'Your table')}: <b>{mesas.join(t(' y ', ' and '))}</b></p>
            )}
            {!mesas.length && <p className="suave chico">{t('Unos días antes de la boda verás aquí tu mesa asignada.', 'A few days before the wedding you will see your table here.')}</p>}
            <div className="pase-entrada">
              <QR texto={enlaceInvitacion(codigo)} tam={140} />
              <p className="chico suave" style={{ margin: '8px 0 0' }}>
                {t('Tu pase de entrada: muéstralo al llegar.', 'Your entry pass: show it when you arrive.')} <b style={{ letterSpacing: '.15em' }}>{codigo}</b>
              </p>
            </div>
          </> : <>
            <h3>{t('Gracias por avisarnos', 'Thank you for letting us know')}</h3>
            <p className="suave">{t('Lamentamos que no puedas acompañarnos. ¡Te vamos a extrañar!', "We're sorry you can't join us. We'll miss you!")}</p>
          </>}
          {!cerrado && !vencido && <button className="btn claro" onClick={() => setEditando(true)}>{t('Cambiar mi respuesta', 'Change my answer')}</button>}
          {!cerrado && vencido && <p className="suave chico">{t('Si necesitas cambiar algo, escríbenos.', 'If you need to change anything, message us.')}</p>}
        </div>
      </>
    );
  }

  if (vencido || cerrado) {
    return <>{sobre}<p className="aviso centro">
      {t(`El plazo para confirmar terminó el ${limiteConfirmar(limite)}. Si aún quieres confirmar, escríbenos directamente.`,
        `The RSVP deadline was ${limiteConfirmar(limite)}. If you still want to confirm, please message us directly.`)}
    </p></>;
  }

  return (
    <form onSubmit={enviar}>
      {sobre}
      <p className="centro suave">{t('Por favor confirma antes del', 'Please reply by')} <b>{limiteConfirmar(limite)}</b>.</p>
      {filas.map((f, i) => (
        <div className="persona" key={f.id ?? `extra-${i}`}>
          <div className="fila">
            {f.extra
              ? <input value={f.nombre} onChange={(e) => cambiar(i, 'nombre', e.target.value)} placeholder={t('Nombre de tu acompañante', "Your guest's name")} aria-label={t('Nombre del acompañante', "Guest's name")} style={{ flex: '1 1 180px' }} />
              : <b>{f.nombre}</b>}
            <div className="eleccion" role="group" aria-label={`${f.nombre || t('Acompañante', 'Guest')}: ${t('¿asistirá?', 'attending?')}`}>
              <button type="button" className={f.asistira === true ? 'si' : ''} onClick={() => cambiar(i, 'asistira', true)}>{t('Asistiré', 'Attending')}</button>
              <button type="button" className={f.asistira === false ? 'no' : ''} onClick={() => cambiar(i, 'asistira', false)}>{t('No podré', "Can't make it")}</button>
            </div>
          </div>
          {f.asistira && (
            <input value={f.restriccion} onChange={(e) => cambiar(i, 'restriccion', e.target.value)} placeholder={t('Alergias o restricción alimentaria (opcional)', 'Allergies or dietary restrictions (optional)')} aria-label={t('Restricción alimentaria', 'Dietary restriction')} />
          )}
        </div>
      ))}
      {filas.length > 1 && <p className="centro"><button type="button" className="btn claro chico" onClick={todosNo}>{t('Ninguno podrá asistir', 'None of us can attend')}</button></p>}
      <label className="campo"><span>{t('Una canción que no puede faltar 🎶', 'A song that must be played 🎶')}</span>
        <input value={cancion} onChange={(e) => setCancion(e.target.value)} placeholder={t('Canción – Artista', 'Song – Artist')} />
      </label>
      <label className="campo"><span>{t('Un mensaje para los novios', 'A message for the couple')}</span>
        <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={1000} />
      </label>
      {error && <p className="aviso error">{error}</p>}
      <div className="centro"><button className="btn oro" disabled={enviando}>{enviando ? t('Enviando…', 'Sending…') : t('Enviar confirmación', 'Send RSVP')}</button></div>
    </form>
  );
}
