import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Registro de llegada en la puerta. Quien recibe a los invitados entra una vez
 * al panel en su teléfono; después escanea el pase (el QR de la invitación)
 * con la cámara normal y la invitación se abre con esta cinta arriba. Un
 * invitado no la ve: sólo aparece con la sesión de administración abierta.
 */
export default function CintaEntrada({ codigo }) {
  const [g, setG] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.sesion()
      .then((u) => (u ? api.grupoPorCodigo(codigo) : null))
      .then((x) => { if (vivo) setG(x); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [codigo]);

  if (!g) return null;
  const van = g.personas.filter((p) => p.asistira);
  const mesas = [...new Set(van.map((p) => p.mesa).filter(Boolean))];

  async function marcar(llego) {
    setGuardando(true); setError('');
    try {
      await api.registrarLlegada(g.id, llego);
      setG({ ...g, llegada_at: llego ? new Date().toISOString() : null });
    } catch (e) { setError(e.message); }
    finally { setGuardando(false); }
  }

  return (
    <div className="cinta-entrada" role="region" aria-label="Registro de llegada">
      <span>
        <b>{g.nombre}</b> · {van.length} de {g.pases} confirmados
        {mesas.length ? <> · Mesa: <b>{mesas.join(' y ')}</b></> : ' · sin mesa'}
      </span>
      {g.llegada_at
        ? <>
            <span>✅ Ya llegó</span>
            <button className="btn chico" disabled={guardando} onClick={() => marcar(false)}>Deshacer</button>
          </>
        : <button className="btn chico" disabled={guardando} onClick={() => marcar(true)}>Registrar llegada</button>}
      {error && <span>{error}</span>}
    </div>
  );
}
