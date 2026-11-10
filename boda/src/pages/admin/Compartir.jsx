import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { boda } from '../../config';
import QR from '../../components/QR';
import Copiar from '../../components/Copiar';

export default function Compartir({ mesas }) {
  const [clave, setClave] = useState('');
  const [nueva, setNueva] = useState('');
  const [aviso, setAviso] = useState('');
  useEffect(() => { api.leerClaveAlbum().then((c) => { setClave(c); setNueva(c); }).catch(() => {}); }, []);

  const origen = window.location.origin;
  const album = `${origen}/album?k=${clave}`;
  const pantalla = `${origen}/pantalla?k=${clave}`;

  return (
    <>
      <div className="rejilla no-imprimir" style={{ marginBottom: 24 }}>
        <div className="tarjeta">
          <h3>Clave del álbum</h3>
          <p className="chico suave">Va dentro de los QR. Cambiarla deja inservibles los QR ya impresos.</p>
          <form style={{ display: 'flex', gap: 8 }} onSubmit={async (e) => {
            e.preventDefault();
            if (nueva.trim().length < 4) { setAviso('Mínimo 4 caracteres.'); return; }
            await api.cambiarClaveAlbum(nueva); setClave(nueva.trim().toUpperCase()); setAviso('Clave actualizada.');
          }}>
            <input value={nueva} onChange={(e) => setNueva(e.target.value)} style={{ textTransform: 'uppercase' }} aria-label="Clave del álbum" />
            <button className="btn chico">Guardar</button>
          </form>
          {aviso && <p className="aviso" style={{ marginTop: 8 }}>{aviso}</p>}
        </div>
        <div className="tarjeta">
          <h3>Enlaces</h3>
          <p className="chico" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>Sitio <Copiar texto={origen} /></p>
          <p className="chico" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>Álbum (con clave) <Copiar texto={album} /></p>
          <p className="chico" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            Pantalla en vivo (proyector) <span><a className="btn claro chico" href={pantalla} target="_blank" rel="noreferrer">Abrir</a></span>
          </p>
        </div>
      </div>

      <div className="herramientas no-imprimir">
        <h3 style={{ margin: 0 }}>Tarjetas QR para las mesas</h3>
        <button className="btn chico" style={{ marginLeft: 'auto' }} onClick={() => window.print()}>Imprimir tarjetas</button>
      </div>
      <div className="qr-tarjetas">
        {(mesas.length ? mesas : [{ id: 'x', nombre: '' }]).map((m) => (
          <div key={m.id} className="qr-tarjeta">
            <div className="script" style={{ fontSize: '1.8rem' }}>{boda.novios.firma}</div>
            {m.nombre && <div style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem' }}>{m.nombre}</div>}
            {clave && <QR texto={album} tam={160} />}
            <div className="chico">📸 Escanea y comparte tus fotos de la boda</div>
            <div className="chico suave">{boda.novios.hashtag}</div>
          </div>
        ))}
      </div>
    </>
  );
}
