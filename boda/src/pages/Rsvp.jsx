import { useState } from 'react';
import { api } from '../lib/api';
import { boda, fechaBoda } from '../config';
import { limiteConfirmar, plazoVencido, diasParaConfirmar, descargarIcs, enlaceGoogleCalendar } from '../lib/fechas';
import { t, locale } from '../lib/idioma';
import { enlaceInvitacion } from '../lib/codigo';
import QR from '../components/QR';
import { useFacil } from '../lib/facil';

/*
 * Confirmación de una invitación.
 *
 * Casos que tiene que resolver sin que el invitado dude:
 *   · confirmar a todos, a algunos o a nadie (menos personas que pases es normal);
 *   · agregar acompañantes hasta completar los pases, y quitarlos;
 *   · una invitación sin nombres cargados (el primero es «tu nombre»);
 *   · cambiar la respuesta hasta la fecha límite.
 * La base vuelve a juzgar todo (pases, plazo): esto es sólo la conversación.
 */

let clave = 0;
const nuevaClave = () => `f${++clave}`;

function filasIniciales(personas) {
  const f = personas.map((p) => ({ ...p, clave: p.id, restriccion: p.restriccion || '', abrirRestriccion: !!p.restriccion, quitar: false, nuevo: false }));
  if (!f.length) f.push({ clave: nuevaClave(), id: null, nombre: '', asistira: null, restriccion: '', nuevo: true, primero: true });
  return f;
}

export default function Rsvp({ codigo, invitacion, alResponder, cerrado }) {
  const { grupo, personas } = invitacion;
  const limite = invitacion.limite || undefined;
  const vencido = plazoVencido(limite);
  const [editando, setEditando] = useState(!grupo.respondido_at);
  const [filas, setFilas] = useState(() => filasIniciales(personas));
  const [mensaje, setMensaje] = useState(grupo.mensaje || '');
  const [cancion, setCancion] = useState(grupo.cancion || '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const facil = useFacil();
  const visibles = filas.filter((f) => !f.quitar);
  const libres = grupo.pases - visibles.length;
  const cambiar = (k, campo, v) => setFilas((fs) => fs.map((f) => (f.clave === k ? { ...f, [campo]: v } : f)));
  const agregar = () => setFilas((fs) => [...fs, { clave: nuevaClave(), id: null, nombre: '', asistira: true, restriccion: '', nuevo: true }]);
  const quitar = (f) => setFilas((fs) => (f.id ? fs.map((x) => (x.clave === f.clave ? { ...x, quitar: true } : x)) : fs.filter((x) => x.clave !== f.clave)));
  const todos = (v) => setFilas((fs) => fs.map((f) => (f.quitar ? f : { ...f, asistira: v })));

  const conNombre = visibles.filter((f) => f.id || f.nombre.trim());
  const cuenta = {
    van: conNombre.filter((f) => f.asistira === true).length,
    no: conNombre.filter((f) => f.asistira === false).length,
    faltan: conNombre.filter((f) => f.asistira == null),
  };

  async function enviar(e) {
    e.preventDefault();
    setError('');
    const sinNombre = visibles.find((f) => f.nuevo && !f.nombre.trim() && f.asistira);
    if (sinNombre) { setError(sinNombre.primero ? t('Escribe tu nombre.', 'Please write your name.') : t('Escribe el nombre de tu acompañante, o quítalo.', "Write your guest's name, or remove them.")); return; }
    if (cuenta.faltan.length) {
      setError(t(`Falta responder por ${cuenta.faltan.map((f) => f.nombre || 'tu acompañante').join(', ')}.`,
        `Please answer for ${cuenta.faltan.map((f) => f.nombre || 'your guest').join(', ')}.`));
      return;
    }
    const envio = [
      ...visibles.filter((f) => f.id || f.nombre.trim())
        .map(({ id, nombre, asistira, restriccion }) => ({ id, nombre, asistira, restriccion: asistira ? restriccion : '' })),
      ...filas.filter((f) => f.quitar && f.id).map((f) => ({ id: f.id, quitar: true })),
    ];
    if (!envio.some((f) => !f.quitar)) { setError(t('Indica quién asistirá.', "Tell us who's coming.")); return; }
    setEnviando(true);
    try {
      const r = await api.responder(codigo, { personas: envio, mensaje, cancion });
      alResponder(r);
      setFilas(filasIniciales(r.personas));
      setEditando(false);
      document.getElementById('confirmar')?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      setError(err.message || t('No se pudo enviar. Intenta de nuevo.', 'Could not send. Please try again.'));
    } finally {
      setEnviando(false);
    }
  }

  const dias = diasParaConfirmar(limite);
  const cabeza = (
    <div className="rsvp-cabeza">
      <p className="para versalita">{t('Invitación para', 'Invitation for')}</p>
      <h3>{grupo.nombre}</h3>
      <p className="meta">
        <span><b>{grupo.pases}</b> {grupo.pases === 1 ? t('lugar reservado', 'seat reserved') : t('lugares reservados', 'seats reserved')}</span>
        {!vencido && !cerrado && (
          <span className={dias <= 14 ? 'plazo-cerca' : ''}>
            {t('Confirma antes del', 'Reply by')} <b>{limiteConfirmar(limite)}</b>
            {dias <= 14 && dias >= 0 && ` · ${dias === 0 ? t('es hoy', 'today') : t(`faltan ${dias} ${dias === 1 ? 'día' : 'días'}`, `${dias} ${dias === 1 ? 'day' : 'days'} left`)}`}
          </span>
        )}
      </p>
    </div>
  );

  // ── Ya respondió ─────────────────────────────────────────────
  if (!editando) {
    const van = personas.filter((p) => p.asistira);
    const mesas = [...new Set(van.map((p) => p.mesa).filter(Boolean))];
    const dia = fechaBoda.toLocaleDateString(locale(), { day: 'numeric', month: 'long', timeZone: boda.zonaHoraria });
    return (
      <div className="rsvp-hecho">
        {cabeza}
        {van.length ? <>
          <p className="titular">{t(`¡Nos vemos el ${dia}!`, `See you on ${dia}!`)}</p>
          <p>{van.length < grupo.pases
            ? t(`Confirmaron ${van.length} de ${grupo.pases} lugares. Gracias por avisarnos: nos ayuda mucho a organizar.`,
              `You confirmed ${van.length} of ${grupo.pases} seats. Thank you for letting us know, it really helps us plan.`)
            : t('Gracias por confirmar.', 'Thank you for confirming.')}</p>
        </> : <>
          <p className="titular">{t('Gracias por avisarnos', 'Thank you for letting us know')}</p>
          <p>{t('Los vamos a extrañar. Si algo cambia, aquí mismo pueden cambiar su respuesta.', "We'll miss you. If anything changes, you can update your answer right here.")}</p>
        </>}
        <ul className="lista-final">
          {personas.map((p) => (
            <li key={p.id} className={p.asistira ? 'va' : ''}>
              <span>{p.nombre}</span>
              <span className="estado">{p.asistira ? `✓ ${t('Asiste', 'Attending')}` : t('No asiste', 'Not attending')}</span>
            </li>
          ))}
        </ul>
        {van.length > 0 && <>
          {mesas.length > 0
            ? <p className="mesa-grande">{t('Mesa', 'Table')}: {mesas.join(t(' y ', ' and '))}</p>
            : <p className="chico" style={{ color: 'var(--oliva-claro)' }}>{t('Unos días antes de la boda verás aquí tu mesa.', 'A few days before the wedding you will see your table here.')}</p>}
          <div className="pase-entrada">
            <QR texto={enlaceInvitacion(codigo)} tam={120} />
            <div>
              <p><b>{t('Tu pase de entrada', 'Your entry pass')}</b></p>
              <p className="chico suave">{t('Muéstralo al llegar. También sirve el código', 'Show it when you arrive. You can also give the code')}</p>
              <p className="codigo">{codigo}</p>
            </div>
          </div>
        </>}
        <div className="botones">
          {van.length > 0 && <>
            <a className="btn claro" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">{t('Google Calendar', 'Google Calendar')}</a>
            <button type="button" className="btn claro" onClick={descargarIcs}>{t('Apple / Outlook', 'Apple / Outlook')}</button>
          </>}
          {!cerrado && !vencido && <button type="button" className="btn" onClick={() => setEditando(true)}>{t('Cambiar mi respuesta', 'Change my answer')}</button>}
        </div>
        {!cerrado && vencido && <p className="chico" style={{ marginTop: 16, color: 'var(--oliva-claro)' }}>{t('El plazo para cambiar la respuesta terminó. Si necesitas algo, escríbenos.', 'The deadline to change your answer has passed. If you need anything, message us.')}</p>}
      </div>
    );
  }

  // ── Plazo vencido sin respuesta ──────────────────────────────
  if (vencido || cerrado) {
    return <>{cabeza}<p className="aviso">
      {t(`El plazo para confirmar terminó el ${limiteConfirmar(limite)}. Si aún quieres confirmar, escríbenos directamente.`,
        `The RSVP deadline was ${limiteConfirmar(limite)}. If you still want to confirm, please message us directly.`)}
    </p></>;
  }

  // ── Modo fácil: de a una pregunta ────────────────────────────
  if (facil) {
    return (
      <PasoAPaso cabeza={cabeza} visibles={visibles} libres={libres} cambiar={cambiar} agregar={agregar} quitar={quitar}
        enviar={() => enviar({ preventDefault() {} })} enviando={enviando} error={error} />
    );
  }

  // ── Formulario ───────────────────────────────────────────────
  const resumen = cuenta.van
    ? t(`Asisten ${cuenta.van} de ${grupo.pases}`, `${cuenta.van} of ${grupo.pases} attending`)
    : cuenta.no && !cuenta.faltan.length ? t('Nadie podrá asistir', 'No one can attend') : t('Elige quién asistirá', "Choose who's coming");
  const detalleResumen = cuenta.faltan.length
    ? t(`Falta responder por ${cuenta.faltan.length === 1 ? (cuenta.faltan[0].nombre || 'tu acompañante') : `${cuenta.faltan.length} personas`}`,
      `${cuenta.faltan.length === 1 ? (cuenta.faltan[0].nombre || 'your guest') : `${cuenta.faltan.length} people`} still to answer`)
    : [cuenta.no ? t(`${cuenta.no} no ${cuenta.no === 1 ? 'asiste' : 'asisten'}`, `${cuenta.no} not attending`) : '',
      grupo.pases - cuenta.van - cuenta.no > 0 && cuenta.van ? t(`${grupo.pases - cuenta.van - cuenta.no} ${grupo.pases - cuenta.van - cuenta.no === 1 ? 'lugar sin usar' : 'lugares sin usar'}`, `${grupo.pases - cuenta.van - cuenta.no} unused`) : '',
    ].filter(Boolean).join(' · ');
  const textoBoton = enviando ? t('Enviando…', 'Sending…')
    : cuenta.van ? t(`Confirmar ${cuenta.van} ${cuenta.van === 1 ? 'persona' : 'personas'}`, `Confirm ${cuenta.van} ${cuenta.van === 1 ? 'guest' : 'guests'}`)
    : cuenta.no && !cuenta.faltan.length ? t('Avisar que no podremos ir', "Let them know we can't go")
    : t('Enviar respuesta', 'Send answer');

  return (
    <form onSubmit={enviar} noValidate>
      {cabeza}
      {visibles.length > 1 && (
        <div className="rapido">
          <button type="button" className="btn enlace" onClick={() => todos(true)}>{t('Todos asistimos', "We're all coming")}</button>
          <button type="button" className="btn enlace" onClick={() => todos(false)}>{t('Ninguno podrá asistir', 'None of us can attend')}</button>
        </div>
      )}
      <ul className="personas-lista">
        {visibles.map((f) => {
          const nombreVisible = f.nombre || (f.primero ? t('Tú', 'You') : t('Acompañante', 'Guest'));
          const editable = f.nuevo || f.agregado;
          return (
            <li className="persona" key={f.clave}>
              <div className="fila">
                <div className="quien">
                  {editable
                    ? <input value={f.nombre} onChange={(e) => cambiar(f.clave, 'nombre', e.target.value)} maxLength={80} autoComplete="name"
                        placeholder={f.primero ? t('Tu nombre y apellido', 'Your full name') : t('Nombre de tu acompañante', "Your guest's name")}
                        aria-label={f.primero ? t('Tu nombre', 'Your name') : t('Nombre del acompañante', "Guest's name")} />
                    : <b>{f.nombre}</b>}
                  {f.es_nino && <span className="nota">{t('Niño/a', 'Child')}</span>}
                  {editable && !f.primero && <span className="nota">{t('Acompañante', 'Plus-one')}</span>}
                </div>
                <div className="eleccion" role="group" aria-label={`${nombreVisible}: ${t('¿asiste?', 'attending?')}`}>
                  <button type="button" className="si" aria-pressed={f.asistira === true} onClick={() => cambiar(f.clave, 'asistira', true)}>{t('Asiste', 'Attending')}</button>
                  <button type="button" className="no" aria-pressed={f.asistira === false} onClick={() => cambiar(f.clave, 'asistira', false)}>{t('No asiste', 'Not attending')}</button>
                </div>
              </div>
              {(f.asistira || (editable && !f.primero)) && (
                <div className="extra">
                  {f.asistira && (f.abrirRestriccion
                    ? <input value={f.restriccion} onChange={(e) => cambiar(f.clave, 'restriccion', e.target.value)} maxLength={200} autoFocus={!f.restriccion}
                        placeholder={t('Alergias, vegetariano, sin gluten…', 'Allergies, vegetarian, gluten-free…')} aria-label={`${t('Alergias o restricciones de', 'Dietary needs for')} ${nombreVisible}`} />
                    : null)}
                  <div className="acciones-persona">
                    {f.asistira && !f.abrirRestriccion && (
                      <button type="button" className="btn enlace chico" onClick={() => cambiar(f.clave, 'abrirRestriccion', true)}>{t('+ Alergia o restricción alimentaria', '+ Allergy or dietary need')}</button>
                    )}
                    {editable && !f.primero && (
                      <button type="button" className="btn enlace chico" onClick={() => quitar(f)}>{t('Quitar acompañante', 'Remove guest')}</button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {libres > 0 && (
        <button type="button" className="agregar-acompanante" onClick={agregar}>
          + {t('Agregar acompañante', 'Add a guest')} <span style={{ opacity: .75, fontWeight: 400 }}>({libres === 1 ? t('queda 1 lugar', '1 seat left') : t(`quedan ${libres} lugares`, `${libres} seats left`)})</span>
        </button>
      )}

      <details className="mas-detalles" open={!!(mensaje || cancion)}>
        <summary>{t('Una canción y un mensaje (opcional)', 'A song and a message (optional)')}</summary>
        <label className="campo"><span>{t('Una canción que no puede faltar', 'A song that must be played')}</span>
          <input value={cancion} onChange={(e) => setCancion(e.target.value)} maxLength={200} placeholder={t('Canción – Artista', 'Song – Artist')} />
        </label>
        <label className="campo"><span>{t(`Un mensaje para ${boda.novios.ella} y ${boda.novios.el}`, `A message for ${boda.novios.ella} and ${boda.novios.el}`)}</span>
          <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={1000} />
        </label>
      </details>

      {error && <p className="aviso error" role="alert" style={{ marginTop: 16 }}>{error}</p>}
      <div className="rsvp-resumen" aria-live="polite">
        <div className="cuenta-rsvp"><b>{resumen}</b>{detalleResumen && <span>{detalleResumen}</span>}</div>
        <button className="btn" disabled={enviando}>{textoBoton}</button>
      </div>
    </form>
  );
}

/*
 * Confirmación para los abuelos: una sola pregunta en pantalla, dos botones
 * enormes, y al final la lista de lo que van a enviar para revisarla.
 */
function PasoAPaso({ cabeza, visibles, libres, cambiar, agregar, quitar, enviar, enviando, error }) {
  const [paso, setPaso] = useState(0);
  const [extra, setExtra] = useState(null); // null | 'pregunta' | 'nombre'
  const actual = visibles[paso];
  const total = visibles.length;
  const siguiente = () => setPaso((n) => n + 1);

  // Pantalla de una persona
  if (actual && extra !== 'pregunta') {
    const sinNombre = (actual.nuevo || actual.primero) && !actual.nombre.trim();
    const pidiendoNombre = actual.nuevo && (actual.primero || extra === 'nombre') && actual.asistira !== false && !actual.listo;
    return (
      <div className="paso">
        {paso === 0 && cabeza}
        <p className="paso-cuenta">{t(`Pregunta ${paso + 1} de ${total}`, `Question ${paso + 1} of ${total}`)}</p>
        {pidiendoNombre ? <>
          <label className="paso-pregunta" htmlFor="nombre-paso">{actual.primero ? t('¿Cómo te llamas?', "What's your name?") : t('¿Cómo se llama tu acompañante?', "What's your guest's name?")}</label>
          <input id="nombre-paso" className="paso-campo" value={actual.nombre} onChange={(e) => cambiar(actual.clave, 'nombre', e.target.value)} autoComplete="name" maxLength={80} autoFocus />
          <div className="paso-botones">
            <button type="button" className="btn enorme" disabled={sinNombre} onClick={() => {
              cambiar(actual.clave, 'listo', true);
              if (extra === 'nombre') { cambiar(actual.clave, 'asistira', true); setExtra(null); siguiente(); }
            }}>{t('Seguir', 'Continue')}</button>
            {!actual.primero && <button type="button" className="btn enorme claro" onClick={() => { quitar(actual); setExtra(null); }}>{t('Mejor no', 'Never mind')}</button>}
          </div>
        </> : <>
          <p className="paso-pregunta">{actual.primero ? t('¿Vas a venir?', 'Are you coming?') : t(`¿${actual.nombre} va a venir?`, `Is ${actual.nombre} coming?`)}</p>
          <div className="paso-botones">
            <button type="button" className={`btn enorme ${actual.asistira === true ? 'elegido' : ''}`} onClick={() => { cambiar(actual.clave, 'asistira', true); siguiente(); }}>{t('Sí, va', 'Yes')}</button>
            <button type="button" className={`btn enorme claro ${actual.asistira === false ? 'elegido' : ''}`} onClick={() => { cambiar(actual.clave, 'asistira', false); siguiente(); }}>{t('No puede', 'No')}</button>
          </div>
        </>}
        {paso > 0 && <button type="button" className="btn enlace paso-atras" onClick={() => setPaso((n) => n - 1)}>← {t('Volver a la anterior', 'Back')}</button>}
      </div>
    );
  }

  // ¿Alguien más? (sólo si quedan lugares y alguien va)
  if (!actual && libres > 0 && extra !== 'listo' && visibles.some((f) => f.asistira)) {
    return (
      <div className="paso">
        <p className="paso-pregunta">{t('¿Viene alguien más con ustedes?', 'Is anyone else coming with you?')}</p>
        <p className="paso-nota">{libres === 1 ? t('Queda 1 lugar en la invitación.', 'There is 1 seat left.') : t(`Quedan ${libres} lugares en la invitación.`, `There are ${libres} seats left.`)}</p>
        <div className="paso-botones">
          <button type="button" className="btn enorme" onClick={() => { agregar(); setExtra('nombre'); }}>{t('Sí', 'Yes')}</button>
          <button type="button" className="btn enorme claro" onClick={() => setExtra('listo')}>{t('No, nadie más', 'No one else')}</button>
        </div>
      </div>
    );
  }

  // Revisar y enviar
  const van = visibles.filter((f) => f.asistira && (f.nombre.trim() || f.id));
  return (
    <div className="paso">
      <p className="paso-pregunta">{t('¿Está bien así?', 'Is this right?')}</p>
      <ul className="paso-resumen">
        {visibles.filter((f) => f.nombre.trim() || f.id).map((f) => (
          <li key={f.clave}><span>{f.nombre}</span><b>{f.asistira ? `✓ ${t('Va', 'Coming')}` : t('No va', 'Not coming')}</b></li>
        ))}
      </ul>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <div className="paso-botones">
        <button type="button" className="btn enorme" disabled={enviando} onClick={enviar}>
          {enviando ? t('Enviando…', 'Sending…') : van.length ? t('Sí, enviar mi respuesta', 'Yes, send my answer') : t('Sí, avisar que no podemos', "Yes, tell them we can't")}
        </button>
        <button type="button" className="btn enorme claro" onClick={() => { setPaso(0); setExtra(null); }}>{t('Cambiar algo', 'Change something')}</button>
      </div>
    </div>
  );
}
