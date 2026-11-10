import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fechaHora } from '../../lib/fechas';

export default function MensajesAdmin({ grupos }) {
  const [mensajes, setMensajes] = useState([]);
  const cargar = () => api.listarMensajes({ incluirOcultos: true }).then(setMensajes).catch(() => {});
  useEffect(() => { cargar(); }, []);
  const deRsvp = grupos.filter((g) => g.mensaje);

  return (
    <div className="rejilla" style={{ alignItems: 'start' }}>
      <div className="tarjeta">
        <h3>Libro de firmas ({mensajes.length})</h3>
        {mensajes.map((m) => (
          <div key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--linea)', opacity: m.oculto ? 0.45 : 1 }}>
            <p style={{ margin: 0 }}>“{m.texto}”</p>
            <div className="chico suave" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{m.autor} · {fechaHora(m.created_at)}</span>
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
  );
}
