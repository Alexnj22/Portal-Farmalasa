import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fechaHora } from '../lib/fechas';
import { t } from '../lib/idioma';

export default function LibroFirmas() {
  const [mensajes, setMensajes] = useState([]);
  const [autor, setAutor] = useState('');
  const [texto, setTexto] = useState('');
  // ok: 'visible' | 'revision' (los novios aprueban antes de mostrarlo)
  const [estado, setEstado] = useState({ enviando: false, error: '', ok: '' });

  const cargar = () => api.listarMensajes().then(setMensajes).catch(() => {});
  useEffect(() => { cargar(); }, []);

  async function enviar(e) {
    e.preventDefault();
    setEstado({ enviando: true, error: '', ok: '' });
    try {
      const visible = await api.firmar({ autor, texto });
      setTexto('');
      setEstado({ enviando: false, error: '', ok: visible === false ? 'revision' : 'visible' });
      cargar();
    } catch (err) {
      setEstado({ enviando: false, error: err.message, ok: '' });
    }
  }

  return (
    <>
      <form className="tarjeta" onSubmit={enviar} style={{ marginBottom: 28 }}>
        <label className="campo"><span>{t('Tu nombre', 'Your name')}</span><input value={autor} onChange={(e) => setAutor(e.target.value)} maxLength={60} required /></label>
        <label className="campo"><span>{t('Tus buenos deseos', 'Your best wishes')}</span><textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={600} required /></label>
        {estado.error && <p className="aviso error">{estado.error}</p>}
        {estado.ok === 'visible' && <p className="aviso ok">{t('¡Gracias por tu mensaje! 💛', 'Thank you for your message! 💛')}</p>}
        {estado.ok === 'revision' && <p className="aviso ok">{t('¡Gracias! 💛 Tu mensaje aparecerá aquí en cuanto los novios lo lean.', 'Thank you! 💛 Your message will appear here once the couple reads it.')}</p>}
        <button className="btn" disabled={estado.enviando}>{estado.enviando ? t('Enviando…', 'Sending…') : t('Firmar el libro', 'Sign the guestbook')}</button>
      </form>
      {mensajes.map((m) => (
        <blockquote key={m.id} style={{ margin: '0 0 18px', paddingLeft: 16, borderLeft: '2px solid var(--oro)' }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontStyle: 'italic', margin: 0 }}>“{m.texto}”</p>
          <footer className="suave chico">— {m.autor} · {fechaHora(m.created_at)}</footer>
        </blockquote>
      ))}
    </>
  );
}
