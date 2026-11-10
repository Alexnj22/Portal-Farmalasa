import { useMemo, useState } from 'react';
import { api } from '../../lib/api';

/**
 * Recepción de invitados. Dos formas de registrar una llegada:
 *   · buscar la familia acá y tocar «Llegó»;
 *   · escanear su pase (el QR de la invitación) con la cámara del teléfono:
 *     con la sesión abierta, la invitación muestra una cinta para registrarla.
 */
export default function Entrada({ grupos, mesas, recargar }) {
  const nombreMesa = useMemo(() => Object.fromEntries(mesas.map((m) => [m.id, m.nombre])), [mesas]);
  const [q, setQ] = useState('');
  const [verTodos, setVerTodos] = useState(false);
  const [error, setError] = useState('');

  const filas = useMemo(() => {
    const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const b = norm(q.trim());
    return grupos
      .map((g) => ({ ...g, van: g.personas.filter((p) => p.asistira).length }))
      .filter((g) => verTodos || g.van > 0)
      .filter((g) => !b || norm(g.nombre).includes(b) || g.codigo.toLowerCase().includes(b)
        || g.personas.some((p) => norm(p.nombre).includes(b)))
      .sort((a, z) => Number(!!a.llegada_at) - Number(!!z.llegada_at) || a.nombre.localeCompare(z.nombre));
  }, [grupos, q, verTodos]);

  const confirmados = grupos.reduce((s, g) => s + g.personas.filter((p) => p.asistira).length, 0);
  const llegaron = grupos.filter((g) => g.llegada_at).reduce((s, g) => s + g.personas.filter((p) => p.asistira).length, 0);

  async function marcar(g, llego) {
    try { setError(''); await api.registrarLlegada(g.id, llego); await recargar(); }
    catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="kpis">
        <div className="kpi"><b style={{ color: 'var(--verde)' }}>{llegaron}</b><span>personas ya llegaron</span></div>
        <div className="kpi"><b>{Math.max(0, confirmados - llegaron)}</b><span>confirmados por llegar</span></div>
        <div className="kpi"><b>{grupos.filter((g) => g.llegada_at).length}</b><span>invitaciones registradas</span></div>
      </div>
      <p className="chico suave">
        También pueden escanear el pase del invitado con la cámara de este teléfono: con la sesión abierta,
        su invitación muestra un botón para registrar la llegada.
      </p>
      <div className="herramientas">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por familia, persona o código" aria-label="Buscar invitado" style={{ flex: '1 1 240px' }} />
        <label className="chico" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} />
          Incluir a quienes no confirmaron
        </label>
      </div>
      {error && <p className="aviso error">{error}</p>}
      <ul className="entrada-lista">
        {filas.map((g) => {
          const suyas = [...new Set(g.personas.filter((p) => p.asistira && p.mesa_id).map((p) => nombreMesa[p.mesa_id]))].filter(Boolean);
          return (
            <li key={g.id} className={g.llegada_at ? 'llego' : ''}>
              <span>
                <b>{g.nombre}</b>
                <span className="chico suave"> · {g.van} de {g.pases} confirmados · {g.codigo} · {suyas.length ? suyas.join(' y ') : 'sin mesa'}</span>
              </span>
              {g.llegada_at
                ? <button className="btn claro chico" onClick={() => marcar(g, false)}>✅ Llegó · deshacer</button>
                : <button className="btn chico" onClick={() => marcar(g, true)}>Llegó</button>}
            </li>
          );
        })}
        {!filas.length && <li className="suave chico">Nadie con ese nombre.</li>}
      </ul>
    </>
  );
}
