import { useEffect, useRef, useState } from 'react';
import { useFacil, cambiarFacil } from '../lib/facil';
import { t, idioma } from '../lib/idioma';
import { fechaLarga, limiteConfirmar } from '../lib/fechas';
import Icono from './Iconos';

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
// La voz del teléfono tiene tres trampas: Chrome descarta un speak() pegado a
// un cancel(), corta los textos largos a los ~15 s y deja de hablar si el
// objeto de la frase se libera. Por eso se lee frase por frase, guardando cada
// una, y se avisa si en dos segundos no empezó (en el iPhone, el interruptor
// de silencio apaga esta voz).
const frasesDe = (txt) => txt.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) || [txt];
const PREFERIDAS = { es: ['es-MX', 'es-US', 'es-419', 'es-ES', 'es'], en: ['en-US', 'en-GB', 'en'] };
function elegirVoz(voces, lengua) {
  for (const l of PREFERIDAS[lengua]) {
    const v = voces.find((x) => x.lang?.replace('_', '-').toLowerCase().startsWith(l.toLowerCase()));
    if (v) return v;
  }
  return null;
}

export function BotonEscuchar({ boda, inv, className = 'btn' }) {
  const [hablando, setHablando] = useState(false);
  const [aviso, setAviso] = useState('');
  const turno = useRef(0);
  const frases = useRef([]);
  const puede = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  useEffect(() => { if (puede) window.speechSynthesis.getVoices(); return () => { turno.current++; if (puede) window.speechSynthesis.cancel(); }; }, [puede]);
  if (!puede) return null;

  const parar = () => { turno.current++; window.speechSynthesis.cancel(); setHablando(false); };
  // Todo sincrónico dentro del toque: Safari en el iPhone sólo deja hablar si
  // speak() se llama en el mismo gesto; un await antes lo bloquea en silencio.
  const alternar = () => {
    if (hablando) { parar(); return; }
    const s = window.speechSynthesis;
    const mio = ++turno.current;
    setAviso(''); setHablando(true);
    const lengua = idioma() === 'en' ? 'en' : 'es';
    const voz = elegirVoz(s.getVoices(), lengua);
    let empezo = false;
    frases.current = frasesDe(textoParaLeer(boda, inv)).map((txt, i, todas) => {
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = voz?.lang || (lengua === 'en' ? 'en-US' : 'es-MX');
      if (voz) u.voice = voz;
      u.rate = 0.9;
      u.onstart = () => { empezo = true; };
      if (i === todas.length - 1) u.onend = () => { if (mio === turno.current) setHablando(false); };
      u.onerror = (e) => { if (mio === turno.current && e.error !== 'interrupted' && e.error !== 'canceled') { setHablando(false); setAviso(t('No se pudo leer en voz alta en este teléfono.', "This phone couldn't read it aloud.")); } };
      return u;
    });
    if (s.paused) s.resume();
    frases.current.forEach((u) => s.speak(u));
    setTimeout(() => {
      if (mio === turno.current && !empezo && !s.speaking) {
        parar();
        setAviso(t('No se escucha nada: suba el volumen y, en el iPhone, quite el modo silencio (el botón del costado).', "Can't hear it? Turn the volume up and, on iPhone, turn off silent mode (the side switch)."));
      }
    }, 2500);
  };
  return (
    <>
      <button type="button" className={className} onClick={alternar} aria-pressed={hablando}>
        <Icono n={hablando ? 'pausa' : 'altavoz'} tam={30} />
        <span>{hablando ? t('Detener', 'Stop') : t('Escuchar la invitación', 'Listen to the invitation')}</span>
      </button>
      {aviso && <p className="aviso error" role="status">{aviso}</p>}
    </>
  );
}
