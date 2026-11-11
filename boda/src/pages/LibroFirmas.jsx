import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fechaHora } from '../lib/fechas';
import { t } from '../lib/idioma';

const MAX_SEG = 60;
const puedeGrabar = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined';
// Safari graba mp4/aac; Chrome y Firefox, webm/opus.
const tipoAudio = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((x) => window.MediaRecorder.isTypeSupported?.(x)) || '';

/** Grabador de un mensaje de voz de hasta un minuto. */
function Grabadora({ audio, setAudio }) {
  const [grabando, setGrabando] = useState(false);
  const [seg, setSeg] = useState(0);
  const [error, setError] = useState('');
  const rec = useRef(null);
  const reloj = useRef(null);
  const url = audio ? URL.createObjectURL(audio) : null;
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { clearInterval(reloj.current); rec.current?.stream?.getTracks().forEach((x) => x.stop()); }, []);
  if (!puedeGrabar()) return null;

  async function empezar() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = tipoAudio();
      const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      const trozos = [];
      r.ondataavailable = (e) => e.data.size && trozos.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((x) => x.stop());
        clearInterval(reloj.current);
        setGrabando(false);
        setAudio(new Blob(trozos, { type: r.mimeType || tipo || 'audio/webm' }));
      };
      rec.current = r; r.start(); setGrabando(true); setSeg(0);
      reloj.current = setInterval(() => setSeg((s) => { if (s + 1 >= MAX_SEG) r.stop(); return s + 1; }), 1000);
    } catch { setError(t('No pudimos usar el micrófono. Revisa el permiso del navegador.', "We couldn't use the microphone. Check the browser permission.")); }
  }
  const parar = () => rec.current?.state === 'recording' && rec.current.stop();

  return (
    <div className="grabadora">
      {grabando ? (
        <button type="button" className="btn grabando" onClick={parar}>
          <span className="punto-vivo" aria-hidden /> {t('Detener', 'Stop')} · 0:{String(seg).padStart(2, '0')}
        </button>
      ) : audio ? (
        <div className="grabacion-lista">
          <audio controls src={url} />
          <button type="button" className="btn enlace" onClick={() => setAudio(null)}>{t('Borrar y grabar otro', 'Delete and record again')}</button>
        </div>
      ) : (
        <button type="button" className="btn claro" onClick={empezar}><span aria-hidden>●</span> {t('Grabar un mensaje de voz', 'Record a voice message')}</button>
      )}
      {error && <p className="aviso error">{error}</p>}
    </div>
  );
}

export default function LibroFirmas() {
  const [mensajes, setMensajes] = useState([]);
  const [autor, setAutor] = useState('');
  const [texto, setTexto] = useState('');
  const [audio, setAudio] = useState(null);
  // ok: 'visible' | 'revision' (los novios aprueban antes de mostrarlo)
  const [estado, setEstado] = useState({ enviando: false, error: '', ok: '' });

  const cargar = () => api.listarMensajes().then(setMensajes).catch(() => {});
  useEffect(() => { cargar(); }, []);

  async function enviar(e) {
    e.preventDefault();
    setEstado({ enviando: true, error: '', ok: '' });
    try {
      const visible = await api.firmar({ autor, texto, audio });
      setTexto(''); setAudio(null);
      setEstado({ enviando: false, error: '', ok: visible === false ? 'revision' : 'visible' });
      cargar();
    } catch (err) {
      setEstado({ enviando: false, error: err.message, ok: '' });
    }
  }

  return (
    <>
      <form className="firmar" onSubmit={enviar}>
        <label className="campo"><span>{t('Tu nombre', 'Your name')}</span><input value={autor} onChange={(e) => setAutor(e.target.value)} maxLength={60} required /></label>
        <label className="campo"><span>{t('Tus buenos deseos', 'Your best wishes')}</span><textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={600} required={!audio} /></label>
        <Grabadora audio={audio} setAudio={setAudio} />
        {estado.error && <p className="aviso error">{estado.error}</p>}
        {estado.ok === 'visible' && <p className="aviso ok">{t('¡Gracias por tu mensaje!', 'Thank you for your message!')}</p>}
        {estado.ok === 'revision' && <p className="aviso ok">{t('¡Gracias! Tu mensaje aparecerá aquí en cuanto los novios lo lean.', 'Thank you! Your message will appear here once the couple reads it.')}</p>}
        <div><button className="btn" disabled={estado.enviando}>{estado.enviando ? t('Enviando…', 'Sending…') : t('Firmar el libro', 'Sign the guestbook')}</button></div>
      </form>
      <ul className="firmas">
        {mensajes.map((m) => (
          <li key={m.id}>
            {m.texto && <blockquote>“{m.texto}”</blockquote>}
            {m.audio && <audio className="voz" controls preload="none" src={api.urlAudio(m.audio)} aria-label={t(`Mensaje de voz de ${m.autor}`, `Voice message from ${m.autor}`)} />}
            <footer>{m.autor} · {fechaHora(m.created_at)}</footer>
          </li>
        ))}
      </ul>
    </>
  );
}
