import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fechaHora } from '../../lib/fechas';

export default function MensajesAdmin({ grupos }) {
  const [mensajes, setMensajes] = useState([]);
  const [moderar, setModerar] = useState(null); // null = cargando
  const [error, setError] = useState('');
  const cargar = () => api.listarMensajes({ incluirOcultos: true }).then(setMensajes).catch((e) => setError(e.message));
  useEffect(() => {
    cargar();
    api.leerAjustes().then((a) => setModerar(a.moderar_mensajes === 'si')).catch((e) => setError(e.message));
  }, []);
  const deRsvp = grupos.filter((g) => g.mensaje);

  async function cambiarModeracion(v) {
    try { setError(''); await api.guardarAjuste('moderar_mensajes', v ? 'si' : 'no'); setModerar(v); }
    catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="checkbox" checked={!!moderar} disabled={moderar === null} onChange={(e) => cambiarModeracion(e.target.checked)} />
          <span><b>Revisar los mensajes antes de publicarlos</b>
            <span className="chico suave" style={{ display: 'block' }}>
              Con esto activado, un mensaje nuevo del libro de firmas queda oculto hasta que ustedes lo muestren.
            </span>
          </span>
        </label>
      </div>
      {error && <p className="aviso error">{error}</p>}
      <div className="rejilla" style={{ alignItems: 'start' }}>
        <div className="tarjeta">
          <h3>Libro de firmas ({mensajes.length})</h3>
          {mensajes.some((m) => m.oculto) && (
            <p className="chico suave">{mensajes.filter((m) => m.oculto).length} ocultos (esperando revisión u ocultados por ustedes).</p>
          )}
          {mensajes.map((m) => (
            <div key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--linea)', opacity: m.oculto ? 0.55 : 1 }}>
              {m.texto && <p style={{ margin: 0 }}>“{m.texto}”</p>}
              {m.audio && <audio controls preload="none" src={api.urlAudio(m.audio)} style={{ width: '100%', marginTop: 6 }} />}
              <div className="chico suave" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{m.autor} · {fechaHora(m.created_at)}{m.oculto ? ' · oculto' : ''}</span>
                <button className="btn claro chico" onClick={async () => { await api.ocultarMensaje(m.id, !m.oculto); cargar(); }}>{m.oculto ? 'Mostrar' : 'Ocultar'}</button>
              </div>
            </div>
          ))}
          {!mensajes.length && <p className="suave chico">Sin mensajes todavía.</p>}
        </div>
        <div className="tarjeta">
          <h3>Mensajes al confirmar ({deRsvp.length})</h3>
          <p className="chico suave">Sólo los ven ustedes.</p>
          {deRsvp.map((g) => (
            <div key={g.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--linea)' }}>
              <p style={{ margin: 0 }}>“{g.mensaje}”</p>
              <div className="chico suave">{g.nombre}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
