import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { boda as config, fechaBoda } from '../config';
import { api } from '../lib/api';
import { ahora } from '../lib/reloj';
import { t } from '../lib/idioma';
import { horaCorta } from '../lib/fechas';

// ── Programa con horas de verdad ────────────────────────────────────────────
// «3:00 p. m.» del config → la fecha exacta en el lugar de la boda. Lo que
// cae antes que el primer punto (la despedida a la 1 a. m.) es del día siguiente.
const desfase = (config.fecha.match(/([+-]\d{2}:\d{2}|Z)$/) || [, '-06:00'])[1];
const diaBoda = fechaBoda.toLocaleDateString('en-CA', { timeZone: config.zonaHoraria });
function aFecha(hora, primeraHora) {
  const m = hora.match(/(\d{1,2}):(\d{2})\s*([ap])/i);
  if (!m) return null;
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'p') h += 12;
  const d = new Date(`${diaBoda}T${String(h).padStart(2, '0')}:${m[2]}:00${desfase}`);
  if (primeraHora != null && h < primeraHora) d.setDate(d.getDate() + 1);
  return d;
}
export function programaConHoras(itinerario) {
  const primera = (() => { const m = itinerario[0]?.hora.match(/(\d{1,2}):\d{2}\s*([ap])/i); return m ? (Number(m[1]) % 12) + (m[2].toLowerCase() === 'p' ? 12 : 0) : null; })();
  return itinerario.map((p) => ({ ...p, desde: aFecha(p.hora, primera) })).filter((p) => p.desde);
}

/** «Ahora» y «lo que sigue», con el programa marcado. Se refresca solo. */
export function AhoraEnLaBoda({ itinerario }) {
  const [, setTic] = useState(0);
  useEffect(() => { const i = setInterval(() => setTic((n) => n + 1), 30000); return () => clearInterval(i); }, []);
  const prog = programaConHoras(itinerario);
  const n = ahora();
  const idx = prog.reduce((acc, p, i) => (p.desde <= n ? i : acc), -1);
  const termino = idx === prog.length - 1 && n - prog[idx].desde > 2 * 36e5;
  const actual = prog[idx];
  const sigue = prog[idx + 1];
  const minutos = sigue ? Math.max(0, Math.round((sigue.desde - n) / 6e4)) : null;
  const falta = minutos == null ? '' : minutos < 60 ? t(`en ${minutos} min`, `in ${minutos} min`)
    : t(`a las ${sigue.hora}`, `at ${sigue.hora}`);

  return (
    <div className="ahora-vivo" aria-live="polite">
      <div className="ahora-tarjetas">
        <div className="ahora-actual">
          <p className="versalita"><span className="punto-vivo" aria-hidden />{termino ? t('Terminó', 'Ended') : actual ? t('Ahora', 'Now') : t('Muy pronto', 'Coming up')}</p>
          <p className="ahora-titulo">{termino ? t('¡Gracias por celebrar con nosotros!', 'Thank you for celebrating with us!') : actual ? actual.titulo : prog[0]?.titulo}</p>
          {!actual && prog[0] && <p className="ahora-hora">{prog[0].hora}</p>}
        </div>
        {sigue && !termino && actual && (
          <div className="ahora-sigue">
            <p className="versalita">{t('Sigue', 'Next')} · {falta}</p>
            <p className="ahora-titulo chico-titulo">{sigue.titulo}</p>
          </div>
        )}
      </div>
      <ol className="programa-vivo">
        {prog.map((p, i) => (
          <li key={i} className={i < idx ? 'paso-hecho' : i === idx && !termino ? 'paso-actual' : ''}>
            <span className="hora">{p.hora}</span><span>{p.titulo}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Una línea para la portada: «Ahora · Cena — Sigue · Primer baile, 8:30 p. m.». */
export function AhoraCompacto({ itinerario }) {
  const [, setTic] = useState(0);
  useEffect(() => { const i = setInterval(() => setTic((n) => n + 1), 30000); return () => clearInterval(i); }, []);
  const prog = programaConHoras(itinerario);
  const n = ahora();
  const idx = prog.reduce((acc, p, i) => (p.desde <= n ? i : acc), -1);
  const actual = prog[idx]; const sigue = prog[idx + 1];
  if (idx === prog.length - 1 && n - actual.desde > 2 * 36e5) return null;
  return (
    <Link to="/hoy" className="ahora-chip">
      <span className="punto-vivo" aria-hidden />
      {actual ? <><b>{t('Ahora', 'Now')}</b> {actual.titulo}</> : <><b>{prog[0]?.hora}</b> {prog[0]?.titulo}</>}
      {actual && sigue && <span className="sigue">{t('Sigue', 'Next')}: {sigue.titulo}, {sigue.hora}</span>}
    </Link>
  );
}

// ── Avisos de los novios ────────────────────────────────────────────────────
const LS_VISTO = 'boda-aviso-cerrado';
/** Banda arriba con el último aviso de las últimas 6 horas. Llega al instante. */
export function AvisoEnVivo() {
  const [aviso, setAviso] = useState(null);
  const [cerrado, setCerrado] = useState(() => { try { return localStorage.getItem(LS_VISTO); } catch { return null; } });
  useEffect(() => {
    const cargar = () => api.listarAvisos().then((xs) => {
      const a = xs[0];
      setAviso(a && Date.now() - new Date(a.created_at) < 6 * 36e5 ? a : null);
    }).catch(() => {});
    cargar();
    return api.suscribirAvisos(cargar);
  }, []);
  if (!aviso || cerrado === aviso.id) return null;
  return (
    <div className="aviso-vivo" role="status">
      <span className="punto-vivo" aria-hidden />
      <p><b>{t('Aviso de los novios', 'From the couple')}</b> · {horaCorta(aviso.created_at)}<br />{aviso.texto}</p>
      <button type="button" onClick={() => { setCerrado(aviso.id); try { localStorage.setItem(LS_VISTO, aviso.id); } catch { /* privado */ } }} aria-label={t('Cerrar aviso', 'Dismiss')}>×</button>
    </div>
  );
}

// ── ¿Dónde me siento? ───────────────────────────────────────────────────────
const leerClave = () => { try { return localStorage.getItem('boda-clave-album') || ''; } catch { return ''; } };
export function DondeMeSiento() {
  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState(leerClave);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');
  const [buscando, setBuscando] = useState(false);
  async function buscar(e) {
    e.preventDefault(); setError(''); setBuscando(true);
    try {
      const r = await api.buscarMesa(clave, nombre);
      try { localStorage.setItem('boda-clave-album', clave.trim().toUpperCase()); } catch { /* privado */ }
      setResultado(r);
    } catch (err) { setError(err.message.includes('Clave') ? t('Esa clave no es correcta. Está en el letrero de la entrada.', "That code isn't right. It's on the sign at the entrance.") : err.message); }
    finally { setBuscando(false); }
  }
  return (
    <form className="donde-siento" onSubmit={buscar}>
      <h3>{t('¿Dónde me siento?', 'Where do I sit?')}</h3>
      <div className="fila-busqueda">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={t('Tu nombre o apellido', 'Your first or last name')} aria-label={t('Tu nombre', 'Your name')} minLength={3} required />
        {!leerClave() && <input value={clave} onChange={(e) => setClave(e.target.value)} placeholder={t('Clave', 'Code')} aria-label={t('Clave', 'Code')} className="campo-clave" required />}
        <button className="btn" disabled={buscando}>{buscando ? t('Buscando…', 'Searching…') : t('Buscar', 'Search')}</button>
      </div>
      {error && <p className="aviso error">{error}</p>}
      {resultado && (resultado.length
        ? <ul className="mesas-encontradas">{resultado.map((r, i) => <li key={i}><span>{r.nombre}</span><b>{r.mesa}</b></li>)}</ul>
        : <p className="suave">{t('No encontramos ese nombre con mesa asignada. Pregunta en la entrada.', 'No match with an assigned table. Please ask at the entrance.')}</p>)}
    </form>
  );
}
