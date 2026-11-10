import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import PlanoMesas from '../../components/PlanoMesas';
import { descargarCsv } from '../../lib/csv';

export default function Mesas({ grupos, mesas, recargar }) {
  const [sel, setSel] = useState(null);
  const [incluirPendientes, setIncluirPendientes] = useState(false);
  const [error, setError] = useState('');

  const personas = useMemo(
    () => grupos.flatMap((g) => g.personas.map((p) => ({ ...p, grupo: g.nombre, grupoId: g.id }))),
    [grupos],
  );
  // Ocupación = confirmados + (opcional) los que no han respondido, para planear antes.
  const cuentan = (p) => p.asistira === true || (incluirPendientes && p.asistira == null);
  const ocupacion = useMemo(() => {
    const o = {};
    personas.forEach((p) => { if (p.mesa_id && cuentan(p)) o[p.mesa_id] = (o[p.mesa_id] || 0) + 1; });
    return o;
  }, [personas, incluirPendientes]); // eslint-disable-line react-hooks/exhaustive-deps

  const mesa = mesas.find((m) => m.id === sel);
  const sentados = personas.filter((p) => p.mesa_id === sel && p.asistira !== false);
  const sinMesa = personas.filter((p) => !p.mesa_id && cuentan(p));
  // Agrupar los sin mesa por invitación: una familia se sienta junta.
  const sinMesaPorGrupo = useMemo(() => {
    const m = new Map();
    sinMesa.forEach((p) => { if (!m.has(p.grupoId)) m.set(p.grupoId, { nombre: p.grupo, personas: [] }); m.get(p.grupoId).personas.push(p); });
    return [...m.entries()];
  }, [sinMesa]);

  const intentar = (f) => async (...a) => {
    try { setError(''); await f(...a); await recargar(); } catch (e) { setError(e.message); }
  };
  const nueva = intentar(async () => {
    const n = mesas.filter((m) => m.forma === 'redonda').length + 1;
    const m = await api.guardarMesa({ nombre: `Mesa ${n}`, capacidad: 10, forma: 'redonda', x: 50, y: 50 });
    setSel(m.id);
  });
  const mover = intentar((id, x, y) => api.guardarMesa({ id, x, y }));
  const editar = intentar((cambios) => api.guardarMesa({ id: sel, ...cambios }));
  const borrar = intentar(async () => {
    if (!confirm(`¿Borrar ${mesa.nombre}? Las personas quedan sin mesa.`)) return;
    await api.borrarMesa(sel); setSel(null);
  });
  const sentar = intentar(async (ids) => { for (const id of ids) await api.asignarMesa(id, sel); });
  const levantar = intentar((id) => api.asignarMesa(id, null));

  function exportar() {
    descargarCsv('mesas.csv', mesas.flatMap((m) => personas.filter((p) => p.mesa_id === m.id && p.asistira !== false)
      .map((p) => ({ mesa: m.nombre, persona: p.nombre, invitacion: p.grupo, confirmado: p.asistira ? 'sí' : 'pendiente', restriccion: p.restriccion || '' }))));
  }

  return (
    <>
      <div className="herramientas">
        <button className="btn chico" onClick={nueva}>+ Mesa</button>
        <label className="chico" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={incluirPendientes} onChange={(e) => setIncluirPendientes(e.target.checked)} />
          Incluir a quienes no han respondido
        </label>
        <button className="btn claro chico" onClick={exportar} style={{ marginLeft: 'auto' }}>Exportar lista por mesa</button>
        <button className="btn claro chico" onClick={() => window.print()}>Imprimir</button>
      </div>
      {error && <p className="aviso error">{error}</p>}
      <p className="chico suave">Arrastra las mesas para acomodar el plano del salón. Toca una mesa para ver y asignar a sus invitados.</p>

      <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
        <PlanoMesas mesas={mesas} ocupacion={ocupacion} seleccionada={sel} alElegir={setSel} editable alMover={mover} />

        <div className="tarjeta">
          {!mesa && <p className="suave">Elige una mesa en el plano.</p>}
          {mesa && <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
              <label className="campo"><span>Nombre</span><input key={`n${mesa.id}`} defaultValue={mesa.nombre} onBlur={(e) => e.target.value.trim() && e.target.value !== mesa.nombre && editar({ nombre: e.target.value.trim() })} /></label>
              <label className="campo"><span>Sillas</span><input key={`c${mesa.id}`} type="number" min={1} max={40} defaultValue={mesa.capacidad} onBlur={(e) => Number(e.target.value) !== mesa.capacidad && editar({ capacidad: Number(e.target.value) })} /></label>
              <label className="campo"><span>Forma</span>
                <select value={mesa.forma} onChange={(e) => editar({ forma: e.target.value })}><option value="redonda">Redonda</option><option value="rectangular">Larga</option></select>
              </label>
            </div>
            <b>{ocupacion[mesa.id] || 0} de {mesa.capacidad} sillas</b>
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0' }}>
              {sentados.map((p) => (
                <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--linea)' }}>
                  <span>{p.asistira ? '✅' : '⏳'} {p.nombre} <span className="chico suave">· {p.grupo}</span></span>
                  <button className="btn claro icono" aria-label={`Quitar a ${p.nombre}`} onClick={() => levantar(p.id)}>×</button>
                </li>
              ))}
              {!sentados.length && <li className="suave chico">Nadie todavía.</li>}
            </ul>
            <button className="btn peligro chico" onClick={borrar}>Borrar mesa</button>
          </>}
        </div>
      </div>

      <h3 style={{ marginTop: 28 }}>Sin mesa ({sinMesa.length})</h3>
      <div className="rejilla">
        {sinMesaPorGrupo.map(([id, g]) => (
          <div key={id} className="tarjeta" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>{g.nombre}</b>
              {mesa && <button className="btn chico" onClick={() => sentar(g.personas.map((p) => p.id))}>Todos a {mesa.nombre}</button>}
            </div>
            {g.personas.map((p) => (
              <div key={p.id} className="chico" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span>{p.asistira ? '✅' : '⏳'} {p.nombre}</span>
                {mesa && <button className="btn claro chico" onClick={() => sentar([p.id])}>Sentar</button>}
              </div>
            ))}
          </div>
        ))}
        {!sinMesa.length && <p className="suave chico">Todos los {incluirPendientes ? 'invitados' : 'confirmados'} tienen mesa. 🎉</p>}
      </div>
    </>
  );
}
