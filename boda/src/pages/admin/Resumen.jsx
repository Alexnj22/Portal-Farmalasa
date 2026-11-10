import { useMemo } from 'react';
import { boda, fechaBoda } from '../../config';

export default function Resumen({ grupos, mesas }) {
  const r = useMemo(() => {
    const personas = grupos.flatMap((g) => g.personas.map((p) => ({ ...p, grupo: g.nombre })));
    const pases = grupos.reduce((s, g) => s + g.pases, 0);
    const si = personas.filter((p) => p.asistira === true);
    const no = personas.filter((p) => p.asistira === false).length;
    // Pases de grupos que no han respondido = lugares aún en duda
    const enDuda = grupos.filter((g) => !g.respondido_at).reduce((s, g) => s + g.pases, 0);
    const capacidad = mesas.reduce((s, m) => s + m.capacidad, 0);
    const sinMesa = si.filter((p) => !p.mesa_id).length;
    const porLado = ['novio', 'novia', 'ambos'].map((l) => [l, grupos.filter((g) => g.lado === l).reduce((s, g) => s + g.pases, 0)]);
    const abiertas = grupos.filter((g) => g.abierta_at).length;
    return {
      pases, si: si.length, no, enDuda, capacidad, sinMesa, porLado, abiertas,
      respondieron: grupos.filter((g) => g.respondido_at).length,
      restricciones: si.filter((p) => p.restriccion),
      canciones: grupos.filter((g) => g.cancion),
      ninos: si.filter((p) => p.es_nino).length,
    };
  }, [grupos, mesas]);

  const dias = Math.ceil((fechaBoda - Date.now()) / 864e5);
  const pct = grupos.length ? Math.round((r.respondieron / grupos.length) * 100) : 0;

  return (
    <>
      <div className="kpis">
        <div className="kpi"><b>{dias > 0 ? dias : '¡Hoy!'}</b><span>días para la boda</span></div>
        <div className="kpi"><b>{grupos.length}</b><span>invitaciones · {r.pases} pases</span></div>
        <div className="kpi"><b style={{ color: 'var(--verde)' }}>{r.si}</b><span>confirmados{r.ninos ? ` (${r.ninos} niños)` : ''}</span></div>
        <div className="kpi"><b style={{ color: 'var(--rojo)' }}>{r.no}</b><span>no asistirán</span></div>
        <div className="kpi"><b>{r.enDuda}</b><span>lugares sin respuesta</span></div>
        <div className="kpi"><b>{r.abiertas}</b><span>invitaciones abiertas</span></div>
        <div className="kpi"><b>{r.capacidad}</b><span>sillas en {mesas.length} mesas</span></div>
        <div className="kpi"><b style={{ color: r.sinMesa ? 'var(--rojo)' : undefined }}>{r.sinMesa}</b><span>confirmados sin mesa</span></div>
      </div>

      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <div className="herramientas" style={{ justifyContent: 'space-between', margin: 0 }}>
          <b>Respuestas: {r.respondieron} de {grupos.length} invitaciones</b><span className="suave chico">Fecha límite: {boda.confirmarAntesDe}</span>
        </div>
        <div className="barra" style={{ marginTop: 10 }}><div style={{ width: `${pct}%` }} /></div>
        <p className="chico suave" style={{ margin: '10px 0 0' }}>
          Pases por lado: {r.porLado.map(([l, n]) => `${l} ${n}`).join(' · ')}
        </p>
      </div>

      <div className="rejilla">
        <div className="tarjeta">
          <h3>Restricciones alimentarias ({r.restricciones.length})</h3>
          {r.restricciones.length ? (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {r.restricciones.map((p) => <li key={p.id}><b>{p.nombre}</b> — {p.restriccion}</li>)}
            </ul>
          ) : <p className="suave chico">Ninguna por ahora.</p>}
        </div>
        <div className="tarjeta">
          <h3>Canciones pedidas ({r.canciones.length})</h3>
          {r.canciones.length ? (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {r.canciones.map((g) => <li key={g.id}>{g.cancion} <span className="suave chico">— {g.nombre}</span></li>)}
            </ul>
          ) : <p className="suave chico">Aún no hay.</p>}
        </div>
      </div>
    </>
  );
}
