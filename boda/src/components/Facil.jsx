import { useEffect, useState } from 'react';
import { useFacil, cambiarFacil } from '../lib/facil';
import { t, idioma } from '../lib/idioma';
import { fechaLarga, limiteConfirmar } from '../lib/fechas';

/** Botón «Aa» de la barra: prende o apaga la letra grande. */
export function BotonFacil() {
  const facil = useFacil();
  return (
    <button type="button" className="btn claro chico boton-facil" aria-pressed={facil} onClick={() => cambiarFacil(!facil)}
      title={facil ? t('Volver a la letra normal', 'Back to normal text') : t('Letra grande', 'Large text')}>
      <span aria-hidden>Aa</span><span className="oculto-visual">{t('Letra grande', 'Large text')}</span>
    </button>
  );
}

/** El texto que se lee en voz alta: lo esencial, en frases cortas. */
function textoParaLeer(boda, inv) {
  const { novios } = boda;
  const partes = [];
  if (inv?.grupo) partes.push(t(`Hola, ${inv.grupo.nombre}.`, `Hello, ${inv.grupo.nombre}.`));
  partes.push(t(`${novios.ella} y ${novios.el} se casan el ${fechaLarga()}.`, `${novios.ella} and ${novios.el} are getting married on ${fechaLarga()}.`));
  boda.lugares.forEach((l) => partes.push(`${l.tipo}: ${l.hora}, ${l.nombre}. ${l.direccion}.`));
  if (boda.vestimenta?.codigo) partes.push(t(`Vestimenta: ${boda.vestimenta.codigo}.`, `Dress code: ${boda.vestimenta.codigo}.`));
  if (inv?.grupo) {
    partes.push(inv.grupo.pases === 1 ? t('Tienes un lugar reservado.', 'You have one seat reserved.')
      : t(`Tienen ${inv.grupo.pases} lugares reservados.`, `You have ${inv.grupo.pases} seats reserved.`));
    if (!inv.grupo.respondido_at) partes.push(t(`Por favor, confirma antes del ${limiteConfirmar(inv.limite)}, con los botones de abajo.`, `Please reply by ${limiteConfirmar(inv.limite)} using the buttons below.`));
  }
  return partes.join(' ');
}

/** Lee la invitación en voz alta (voz del teléfono, sin descargar nada). */
export function BotonEscuchar({ boda, inv, className = 'btn' }) {
  const [hablando, setHablando] = useState(false);
  const puede = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => { if (puede) window.speechSynthesis.cancel(); }, [puede]);
  if (!puede) return null;
  const alternar = () => {
    const s = window.speechSynthesis;
    if (hablando) { s.cancel(); setHablando(false); return; }
    const u = new SpeechSynthesisUtterance(textoParaLeer(boda, inv));
    const lengua = idioma() === 'en' ? 'en' : 'es';
    u.lang = lengua === 'en' ? 'en-US' : 'es-MX';
    const voz = s.getVoices().find((v) => v.lang?.toLowerCase().startsWith(lengua));
    if (voz) u.voice = voz;
    u.rate = 0.9;
    u.onend = () => setHablando(false);
    u.onerror = () => setHablando(false);
    s.cancel(); s.speak(u); setHablando(true);
  };
  return (
    <button type="button" className={className} onClick={alternar} aria-pressed={hablando}>
      <span aria-hidden className="icono-boton">{hablando ? '■' : '▶'}</span>
      {hablando ? t('Detener', 'Stop') : t('Escuchar la invitación', 'Listen to the invitation')}
    </button>
  );
}

/** Los cuatro botones grandes del modo fácil, arriba de todo. */
export function AccionesFacil({ boda, inv, hayConfirmar }) {
  const tel = boda.contacto?.whatsapp ? `tel:+${boda.contacto.whatsapp}` : null;
  const lugar = boda.lugares[0];
  return (
    <section className="acciones-facil contenedor" aria-label={t('Lo más importante', 'The essentials')}>
      <BotonEscuchar boda={boda} inv={inv} className="btn grande" />
      {hayConfirmar && <a className="btn grande" href="#confirmar">{t('Confirmar mi asistencia', 'Reply to the invitation')}</a>}
      {lugar && <a className="btn grande claro" href={`https://www.google.com/maps/dir/?api=1&destination=${lugar.lat},${lugar.lng}`} target="_blank" rel="noreferrer">{t('Cómo llegar', 'Directions')}</a>}
      {tel && <a className="btn grande claro" href={tel}>{t(`Llamar a ${boda.contacto.nombre}`, `Call ${boda.contacto.nombre}`)}</a>}
    </section>
  );
}
