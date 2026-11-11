import { useState } from 'react';
import { Link } from 'react-router-dom';
import { boda, fechaBoda } from '../config';
import { api } from '../lib/api';
import { ESCENARIOS } from '../lib/localApi';
import { faseActual } from '../lib/fase';
import { fechaFingida, fingirFecha, faseFingida, fingirFase } from '../lib/reloj';
import { cambiarIdioma, useIdioma, IDIOMAS } from '../lib/idioma';

/**
 * Panel de pruebas del modo demo: cambiar de fase, fingir la fecha de hoy,
 * abrir cada invitación de ejemplo y volver a empezar. Todo queda en este
 * navegador; con Supabase conectado no aparece.
 */
const FASES = [['', 'Automática'], ['save-the-date', 'Save the date'], ['invitacion', 'Invitación'], ['boda', 'El día'], ['recuerdos', 'Recuerdos']];
const sumarDias = (aaaammdd, n) => {
  const d = new Date(`${aaaammdd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diaBoda = fechaBoda.toLocaleDateString('en-CA', { timeZone: boda.zonaHoraria });

export default function PanelPruebas() {
  const [abierto, setAbierto] = useState(false);
  const [seguro, setSeguro] = useState(false);
  const idioma = useIdioma();
  const fase = faseFingida();
  const hoy = fechaFingida();
  const recargar = () => window.location.reload();
  const fijarFecha = (f) => { fingirFecha(f); recargar(); };

  if (!abierto) {
    return <button type="button" className="pruebas-boton" onClick={() => setAbierto(true)}>Pruebas</button>;
  }
  return (
    <aside className="pruebas" aria-label="Panel de pruebas">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2>Panel de pruebas</h2>
        <button type="button" className="btn claro chico" onClick={() => setAbierto(false)}>Cerrar</button>
      </div>
      <p className="chico suave" style={{ margin: '6px 0 0' }}>
        Ahora: fase <b>{FASES.find(([k]) => k === faseActual())?.[1] ?? faseActual()}</b>{fase ? ' (fijada)' : ' (por fecha)'} · hoy <b>{hoy || 'real'}</b>.
        Los datos viven sólo en este navegador.
      </p>

      <h3>Fase del sitio</h3>
      <div className="segmentos">
        {FASES.map(([k, r]) => (
          <button key={k || 'auto'} type="button" aria-pressed={fase === k} onClick={() => { fingirFase(k); recargar(); }}>{r}</button>
        ))}
      </div>

      <h3>Fecha de hoy</h3>
      <div className="segmentos">
        <button type="button" aria-pressed={!hoy} onClick={() => fijarFecha('')}>Real</button>
        <button type="button" aria-pressed={hoy === sumarDias(boda.confirmarAntesDe, -3)} onClick={() => fijarFecha(sumarDias(boda.confirmarAntesDe, -3))}>3 días antes del plazo</button>
        <button type="button" aria-pressed={hoy === sumarDias(boda.confirmarAntesDe, 1)} onClick={() => fijarFecha(sumarDias(boda.confirmarAntesDe, 1))}>Plazo vencido</button>
        <button type="button" aria-pressed={hoy === diaBoda} onClick={() => fijarFecha(diaBoda)}>Día de la boda</button>
      </div>
      <div className="fila-pruebas" style={{ marginTop: 8 }}>
        <input type="date" defaultValue={hoy} aria-label="Otra fecha" onChange={(e) => e.target.value && fijarFecha(e.target.value)} />
      </div>
      <p className="chico suave" style={{ margin: '6px 0 0' }}>Plazo para confirmar: {boda.confirmarAntesDe}. Con la fase en «Automática», la fecha también cambia la fase.</p>

      {IDIOMAS.length > 1 && <>
        <h3>Idioma</h3>
        <div className="segmentos">
          {IDIOMAS.map((l) => <button key={l} type="button" aria-pressed={idioma === l} onClick={() => cambiarIdioma(l)}>{l === 'es' ? 'Español' : 'English'}</button>)}
        </div>
      </>}

      <h3>Invitaciones de prueba</h3>
      <ul className="escenarios">
        {ESCENARIOS.map((e) => (
          <li key={e.codigo}><Link to={`/i/${e.codigo}`} onClick={() => setAbierto(false)}><code>{e.codigo}</code><span>{e.caso}</span></Link></li>
        ))}
      </ul>

      <h3>Otras pantallas</h3>
      <ul className="escenarios">
        <li><Link to="/" onClick={() => setAbierto(false)}><code>Inicio</code><span>Sitio general, sin invitación personal.</span></Link></li>
        <li><Link to="/album?k=BODA27" onClick={() => setAbierto(false)}><code>Álbum</code><span>Con la clave BODA27 ya puesta (como al escanear el QR de la mesa).</span></Link></li>
        <li><Link to="/admin" onClick={() => setAbierto(false)}><code>Panel</code><span>De los novios. Contraseña «demo».</span></Link></li>
        <li><a href="/pantalla?k=BODA27" target="_blank" rel="noreferrer"><code>Pantalla</code><span>La del proyector del salón (se abre aparte).</span></a></li>
        <li><Link to="/canciones" onClick={() => setAbierto(false)}><code>Canciones</code><span>Pedir y votar canciones.</span></Link></li>
        <li><a href="/dj" target="_blank" rel="noreferrer"><code>DJ</code><span>La lista ordenada por votos (se abre aparte).</span></a></li>
        <li><Link to="/juego" onClick={() => setAbierto(false)}><code>Juego</code><span>Desde el teléfono. Se lanza en Panel → En vivo.</span></Link></li>
        <li><a href="/pantalla?modo=juego" target="_blank" rel="noreferrer"><code>Proyector juego</code><span>Pregunta, barras y ganadores.</span></a></li>
        <li><Link to="/admin?p=vivo" onClick={() => setAbierto(false)}><code>En vivo</code><span>Mandar un aviso a todos los teléfonos.</span></Link></li>
      </ul>

      <h3>Volver a empezar</h3>
      <div className="fila-pruebas">
        <button type="button" className={`btn chico ${seguro ? 'peligro' : 'claro'}`}
          onClick={() => { if (!seguro) { setSeguro(true); return; } api.reiniciarDemo(); fingirFase(''); fingirFecha(''); recargar(); }}>
          {seguro ? 'Toca otra vez para borrar todo' : 'Borrar respuestas, fotos y fechas'}
        </button>
      </div>
    </aside>
  );
}
