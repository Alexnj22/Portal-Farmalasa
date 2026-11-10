import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fechaHora } from '../lib/fechas';

export default function LibroFirmas() {
  const [mensajes, setMensajes] = useState([]);
  const [autor, setAutor] = useState('');
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState({ enviando: false, error: '', ok: false });

  const cargar = () => api.listarMensajes().then(setMensajes).catch(() => {});
  useEffect(() => { cargar(); }, []);

  async function enviar(e) {
    e.preventDefault();
    setEstado({ enviando: true, error: '', ok: false });
    try {
      await api.firmar({ autor, texto });
      setTexto('');
      setEstado({ enviando: false, error: '', ok: true });
      cargar();
    } catch (err) {
      setEstado({ enviando: false, error: err.message, ok: false });
    }
  }

  return (
    <>
      <form className="tarjeta" onSubmit={enviar} style={{ marginBottom: 28 }}>
        <label className="campo"><span>Tu nombre</span><input value={autor} onChange={(e) => setAutor(e.target.value)} maxLength={60} required /></label>
        <label className="campo"><span>Tus buenos deseos</span><textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={600} required /></label>
        {estado.error && <p className="aviso error">{estado.error}</p>}
        {estado.ok && <p className="aviso ok">¡Gracias por tu mensaje! 💛</p>}
        <button className="btn" disabled={estado.enviando}>{estado.enviando ? 'Enviando…' : 'Firmar el libro'}</button>
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
