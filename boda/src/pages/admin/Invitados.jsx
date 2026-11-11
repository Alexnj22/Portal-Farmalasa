import { useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { boda } from '../../config';
import { enlaceInvitacion } from '../../lib/codigo';
import { descargarCsv, leerCsv } from '../../lib/csv';
import { fechaLarga, limiteConfirmar } from '../../lib/fechas';
import Copiar from '../../components/Copiar';

const ESTADOS = { pendiente: 'Pendiente', confirmado: 'Confirmado', parcial: 'Parcial', declinado: 'No asiste' };

// Plantillas de WhatsApp. {nombre} y {enlace} se reemplazan por invitación.
const PLANTILLAS = {
  std: { titulo: 'Save the date', campo: 'std_enviado_at',
    texto: `¡Hola {nombre}! 💍 Queremos que guardes la fecha: ${boda.novios.firma} nos casamos el ${fechaLarga()}. Pronto te enviaremos la invitación formal. Mira los detalles aquí: {enlace}` },
  inv: { titulo: 'Invitación', campo: 'invitacion_enviada_at',
    texto: `¡Hola {nombre}! 💌 Con mucha alegría te invitamos a nuestra boda el ${fechaLarga()}. En este enlace está tu invitación personal, el mapa y todos los detalles. Por favor confírmanos antes del ${limiteConfirmar()}: {enlace}` },
  rec: { titulo: 'Recordatorio', campo: null,
    texto: `¡Hola {nombre}! 😊 Te recordamos confirmar tu asistencia a nuestra boda antes del ${limiteConfirmar()}. Sólo toma un minuto: {enlace}` },
};

const telWa = (t = '') => {
  const d = t.replace(/\D/g, '');
  return d.length === 8 ? `503${d}` : d; // 8 dígitos = número de El Salvador sin código de país
};

export default function Invitados({ grupos, recargar }) {
  const [busca, setBusca] = useState('');
  const [estado, setEstado] = useState('');
  const [lado, setLado] = useState('');
  const [editar, setEditar] = useState(null);
  const [aviso, setAviso] = useState('');
  const archivo = useRef(null);

  const lista = useMemo(() => {
    const q = busca.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return grupos.filter((g) =>
      (!estado || g.estado === estado) && (!lado || g.lado === lado) &&
      (!q || norm(g.nombre).includes(q) || g.codigo.toLowerCase().includes(q) || norm(g.etiqueta).includes(q) ||
        g.personas.some((p) => norm(p.nombre).includes(q))));
  }, [grupos, busca, estado, lado]);

  async function enviarWa(g, clave) {
    const p = PLANTILLAS[clave];
    const texto = p.texto.replace('{nombre}', g.nombre).replace('{enlace}', enlaceInvitacion(g.codigo));
    const tel = telWa(g.telefono);
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank');
    if (p.campo && !g[p.campo]) {
      await api.actualizarGrupo(g.id, { [p.campo]: new Date().toISOString() });
      recargar();
    }
  }

  async function importar(file) {
    try {
      const filas = leerCsv(await file.text());
      let n = 0;
      for (const f of filas) {
        const nombre = f.grupo || f.invitacion || f.familia || f.nombre;
        if (!nombre) continue;
        const nombres = (f.personas || f.invitados || f.nombres || '').split(/[|;\n]/).map((s) => s.trim()).filter(Boolean);
        const pases = Math.max(Number(f.pases) || 0, nombres.length, 1);
        const g = await api.guardarGrupo({
          nombre, pases, lado: ['novio', 'novia'].includes((f.lado || '').toLowerCase()) ? f.lado.toLowerCase() : 'ambos',
          telefono: f.telefono || f.celular || '', etiqueta: f.etiqueta || f.grupo_social || '', notas: f.notas || '',
        });
        for (const pn of nombres) await api.guardarPersona({ grupo_id: g.id, nombre: pn });
        n++;
      }
      setAviso(`Se importaron ${n} invitaciones.`);
      recargar();
    } catch (e) {
      setAviso(`No se pudo importar: ${e.message}`);
    }
  }

  function exportar() {
    descargarCsv('invitados.csv', grupos.flatMap((g) => {
      const base = { invitacion: g.nombre, codigo: g.codigo, enlace: enlaceInvitacion(g.codigo), lado: g.lado, etiqueta: g.etiqueta || '', telefono: g.telefono || '', estado: ESTADOS[g.estado], pases: g.pases };
      if (!g.personas.length) return [{ ...base, persona: '', asiste: '', restriccion: '' }];
      return g.personas.map((p) => ({ ...base, persona: p.nombre, asiste: p.asistira == null ? '' : p.asistira ? 'sí' : 'no', restriccion: p.restriccion || '' }));
    }));
  }

  return (
    <>
      <div className="herramientas">
        <input type="search" placeholder="Buscar por nombre, código o etiqueta…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={lado} onChange={(e) => setLado(e.target.value)} aria-label="Lado">
          <option value="">Ambos lados</option><option value="novio">Del novio</option><option value="novia">De la novia</option><option value="ambos">De los dos</option>
        </select>
        <button className="btn chico" onClick={() => setEditar({ nombre: '', pases: 1, lado: 'ambos', telefono: '', etiqueta: '', notas: '', personas: [] })}>+ Invitación</button>
        <button className="btn claro chico" onClick={() => archivo.current.click()}>Importar CSV</button>
        <button className="btn claro chico" onClick={exportar}>Exportar CSV</button>
        <input ref={archivo} type="file" accept=".csv,text/csv" hidden onChange={(e) => { if (e.target.files[0]) importar(e.target.files[0]); e.target.value = ''; }} />
      </div>
      <p className="chico suave" style={{ marginTop: -6 }}>
        CSV con columnas <code>grupo, personas, pases, lado, telefono, etiqueta</code> — las personas separadas por «|». Se puede exportar desde Excel o Google Sheets.
      </p>
      {aviso && <p className="aviso">{aviso}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table className="tabla">
          <thead><tr><th>Invitación</th><th>Personas</th><th>Estado</th><th>Enviar por WhatsApp</th><th /></tr></thead>
          <tbody>
            {lista.map((g) => (
              <tr key={g.id}>
                <td>
                  <b>{g.nombre}</b>
                  <div className="chico suave">{g.codigo} · {g.pases} {g.pases === 1 ? 'pase' : 'pases'} · {g.lado}{g.etiqueta ? ` · ${g.etiqueta}` : ''}{g.letra_grande ? ' · Aa letra grande' : ''}</div>
                  {g.abierta_at && <div className="chico" style={{ color: 'var(--oliva)' }}>👁 Abrió su invitación</div>}
                </td>
                <td className="chico">
                  {g.personas.map((p) => (
                    <div key={p.id}>{p.asistira === true ? '✅' : p.asistira === false ? '❌' : '⏳'} {p.nombre}{p.restriccion ? <span className="suave"> ({p.restriccion})</span> : ''}</div>
                  ))}
                  {g.mensaje && <div className="suave" style={{ fontStyle: 'italic', marginTop: 4 }}>“{g.mensaje}”</div>}
                </td>
                <td><span className={`pastilla ${g.estado}`}>{ESTADOS[g.estado]}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {Object.entries(PLANTILLAS).map(([k, p]) => (
                      <button key={k} className="btn claro chico" onClick={() => enviarWa(g, k)} title={p.campo && g[p.campo] ? `Enviado el ${new Date(g[p.campo]).toLocaleDateString('es')}` : ''}>
                        {p.campo && g[p.campo] ? '✓ ' : ''}{p.titulo}
                      </button>
                    ))}
                    <Copiar texto={enlaceInvitacion(g.codigo)}>Copiar enlace</Copiar>
                  </div>
                </td>
                <td><button className="btn claro chico" onClick={() => setEditar(g)}>Editar</button></td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={5} className="centro suave">No hay invitaciones{busca || estado || lado ? ' con ese filtro' : ' todavía'}.</td></tr>}
          </tbody>
        </table>
      </div>

      {editar && <EditarGrupo grupo={editar} alCerrar={() => setEditar(null)} alGuardar={() => { setEditar(null); recargar(); }} />}
    </>
  );
}

function EditarGrupo({ grupo, alCerrar, alGuardar }) {
  const [g, setG] = useState(() => ({ ...grupo }));
  const [personas, setPersonas] = useState(() => grupo.personas.map((p) => ({ ...p })));
  const [borradas, setBorradas] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setG((x) => ({ ...x, [k]: v }));
  const setP = (i, k, v) => setPersonas((ps) => ps.map((p, n) => (n === i ? { ...p, [k]: v } : p)));

  async function guardar(e) {
    e.preventDefault();
    const nombres = personas.filter((p) => p.nombre.trim());
    if (!g.nombre.trim()) { setError('Ponle un nombre a la invitación.'); return; }
    if (nombres.length > g.pases) { setError(`Hay ${nombres.length} personas y sólo ${g.pases} pases.`); return; }
    setGuardando(true);
    try {
      const fila = await api.guardarGrupo({
        ...(g.id ? { id: g.id } : {}), nombre: g.nombre.trim(), pases: Number(g.pases), lado: g.lado,
        telefono: g.telefono || null, etiqueta: g.etiqueta || null, notas: g.notas || null,
        letra_grande: !!g.letra_grande,
      });
      for (const id of borradas) await api.borrarPersona(id);
      for (const p of nombres) {
        await api.guardarPersona({
          ...(p.id ? { id: p.id } : {}), grupo_id: fila.id, nombre: p.nombre.trim(), es_nino: !!p.es_nino,
          asistira: p.asistira ?? null,
        });
      }
      // Respuesta anotada por ustedes (llegó por teléfono o en persona): el
      // estado de la invitación se recalcula igual que cuando responde el invitado.
      const respondidas = nombres.filter((p) => p.asistira != null);
      const cambioRespuesta = nombres.some((p) => (grupo.personas.find((x) => x.id === p.id)?.asistira ?? null) !== (p.asistira ?? null));
      if (cambioRespuesta || borradas.length) {
        const si = nombres.filter((p) => p.asistira).length;
        const estado = !respondidas.length ? 'pendiente'
          : respondidas.length < nombres.length ? (si ? 'parcial' : 'pendiente')
          : si === 0 ? 'declinado' : si < nombres.length ? 'parcial' : 'confirmado';
        await api.actualizarGrupo(fila.id, {
          estado, respondido_at: respondidas.length ? (grupo.respondido_at || new Date().toISOString()) : null,
        });
      }
      alGuardar();
    } catch (err) {
      setError(err.message); setGuardando(false);
    }
  }

  async function borrar() {
    if (!confirm(`¿Borrar la invitación «${grupo.nombre}» y sus ${grupo.personas.length} personas?`)) return;
    await api.borrarGrupo(grupo.id);
    alGuardar();
  }

  return (
    <div className="modal-fondo" onClick={alCerrar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={guardar}>
        <h3>{grupo.id ? 'Editar invitación' : 'Nueva invitación'}</h3>
        <label className="campo"><span>Nombre en la invitación</span><input value={g.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Familia Pérez · Ana y Luis" autoFocus /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="campo"><span>Pases</span><input type="number" min={1} max={30} value={g.pases} onChange={(e) => set('pases', e.target.value)} /></label>
          <label className="campo"><span>Lado</span>
            <select value={g.lado} onChange={(e) => set('lado', e.target.value)}><option value="novio">Del novio</option><option value="novia">De la novia</option><option value="ambos">De los dos</option></select>
          </label>
          <label className="campo"><span>WhatsApp</span><input value={g.telefono || ''} onChange={(e) => set('telefono', e.target.value)} placeholder="7000 0000" inputMode="tel" /></label>
          <label className="campo"><span>Etiqueta</span><input value={g.etiqueta || ''} onChange={(e) => set('etiqueta', e.target.value)} placeholder="Familia, Trabajo…" /></label>
        </div>
        <label className="campo"><span>Notas internas</span><input value={g.notas || ''} onChange={(e) => set('notas', e.target.value)} /></label>
        <label className="opcion-casilla">
          <input type="checkbox" checked={!!g.letra_grande} onChange={(e) => set('letra_grande', e.target.checked)} />
          <span><b>Letra grande</b> <span className="chico suave">Para abuelos: su enlace se abre con letra grande, sin animaciones, con la invitación leída en voz alta y la confirmación de a una pregunta.</span></span>
        </label>

        <b className="chico">Personas ({personas.filter((p) => p.nombre.trim()).length} de {g.pases})</b>
        <p className="chico suave" style={{ margin: '2px 0 8px' }}>Los pases sin nombre los completa el invitado al confirmar (acompañantes). Si alguien les respondió por teléfono, anótenlo con «Asiste» / «No».</p>
        {personas.map((p, i) => (
          <div key={p.id ?? i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <input value={p.nombre} onChange={(e) => setP(i, 'nombre', e.target.value)} placeholder="Nombre y apellido" aria-label="Nombre" style={{ flex: '1 1 180px', width: 'auto' }} />
            <label className="chico" style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={!!p.es_nino} onChange={(e) => setP(i, 'es_nino', e.target.checked)} /> niño
            </label>
            <div className="asistencia-admin" role="group" aria-label={`Respuesta de ${p.nombre || 'la persona'}`}>
              {[[null, '—'], [true, 'Asiste'], [false, 'No']].map(([v, r]) => (
                <button key={r} type="button" aria-pressed={(p.asistira ?? null) === v} onClick={() => setP(i, 'asistira', v)} title={v == null ? 'Sin respuesta' : r}>{r}</button>
              ))}
            </div>
            <button type="button" className="btn claro icono" aria-label="Quitar" onClick={() => { if (p.id) setBorradas((b) => [...b, p.id]); setPersonas((ps) => ps.filter((_, n) => n !== i)); }}>×</button>
          </div>
        ))}
        <button type="button" className="btn claro chico" onClick={() => setPersonas((ps) => [...ps, { nombre: '', es_nino: false }])}>+ Persona</button>

        {error && <p className="aviso error" style={{ marginTop: 12 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 20 }}>
          {grupo.id ? <button type="button" className="btn peligro chico" onClick={borrar}>Borrar</button> : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn claro" onClick={alCerrar}>Cancelar</button>
            <button className="btn" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
