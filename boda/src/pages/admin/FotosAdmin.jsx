import { useEffect, useState } from 'react';
import { api, esVideo } from '../../lib/api';
import { fechaHora } from '../../lib/fechas';

export default function FotosAdmin() {
  const [fotos, setFotos] = useState([]);
  const [error, setError] = useState('');
  const cargar = () => api.listarFotos({ incluirOcultas: true }).then(setFotos).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  const accion = (f) => async () => { try { await f(); cargar(); } catch (e) { setError(e.message); } };

  async function descargarTodo() {
    // Lista de enlaces para un gestor de descargas (o para respaldar el álbum).
    const texto = fotos.filter((f) => !f.oculta).map((f) => f.url).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
    a.download = 'album-enlaces.txt';
    a.click();
  }

  return (
    <>
      <div className="herramientas">
        <b>{fotos.length} archivos · {fotos.filter((f) => f.oculta).length} ocultos</b>
        <button className="btn claro chico" style={{ marginLeft: 'auto' }} onClick={descargarTodo}>Lista de enlaces (respaldo)</button>
      </div>
      {error && <p className="aviso error">{error}</p>}
      <div className="qr-tarjetas">
        {fotos.map((f) => (
          <div key={f.id} className="tarjeta" style={{ padding: 10, opacity: f.oculta ? 0.45 : 1 }}>
            {esVideo(f.ruta) ? <video src={f.url} controls style={{ width: '100%', borderRadius: 8 }} /> : <img src={f.url} alt="" loading="lazy" style={{ borderRadius: 8, aspectRatio: '1', objectFit: 'cover', width: '100%' }} />}
            <div className="chico suave" style={{ margin: '6px 0' }}>{f.autor || 'Anónimo'} · {f.momento || '—'} · {fechaHora(f.created_at)}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn claro chico" onClick={accion(() => api.ocultarFoto(f.id, !f.oculta))}>{f.oculta ? 'Mostrar' : 'Ocultar'}</button>
              <button className="btn peligro chico" onClick={accion(async () => { if (confirm('¿Borrar definitivamente?')) await api.borrarFoto(f); })}>Borrar</button>
            </div>
          </div>
        ))}
      </div>
      {!fotos.length && <p className="suave centro">Aún no hay fotos en el álbum.</p>}
    </>
  );
}
