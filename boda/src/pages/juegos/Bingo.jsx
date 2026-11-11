import { useEffect, useMemo, useState } from 'react';
import { boda } from '../../config';
import { t, useIdioma } from '../../lib/idioma';
import { lanzar, vibrar } from '../../lib/confeti';
import { PaginaApp } from '../../components/AppMarco';

const LS = 'boda-bingo';
const N = 4;
const LINEAS = [
  ...Array.from({ length: N }, (_, f) => Array.from({ length: N }, (_, c) => f * N + c)),
  ...Array.from({ length: N }, (_, c) => Array.from({ length: N }, (_, f) => f * N + c)),
  Array.from({ length: N }, (_, i) => i * N + i), Array.from({ length: N }, (_, i) => i * N + (N - 1 - i)),
];
function nuevoCarton() {
  const idx = (boda.juego?.bingo || []).map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return { casillas: idx.slice(0, N * N), marcadas: [] };
}
const leer = () => {
  try { const c = JSON.parse(localStorage.getItem(LS)); if (c?.casillas?.length === N * N) return c; } catch { /* nuevo */ }
  return nuevoCarton();
};

/** Bingo de momentos de la fiesta: cartón al azar en cada teléfono. */
export default function Bingo() {
  useIdioma();
  const textos = boda.juego?.bingo || [];
  const [carton, setCarton] = useState(leer);
  const [cantado, setCantado] = useState(0);
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(carton)); } catch { /* privado */ } }, [carton]);
  const lineas = useMemo(() => LINEAS.filter((l) => l.every((k) => carton.marcadas.includes(k))), [carton]);
  const enLinea = new Set(lineas.flat());

  useEffect(() => {
    if (lineas.length > cantado) { vibrar([30, 60, 30, 60, 60]); lanzar({ cantidad: 160, fuerza: 13 }); lanzar({ tipo: 'petalo', cantidad: 40, lluvia: true }); }
    setCantado(lineas.length);
  }, [lineas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcar = (k) => {
    vibrar(10);
    setCarton((c) => ({ ...c, marcadas: c.marcadas.includes(k) ? c.marcadas.filter((x) => x !== k) : [...c.marcadas, k] }));
  };
  if (textos.length < N * N) return <PaginaApp titulo="Bingo"><p>{t('Faltan casillas en config.js (juego.bingo).', 'Missing squares in config.js.')}</p></PaginaApp>;
  return (
    <PaginaApp titulo={<>{t('Bingo de la', 'Wedding')} <em>{t('boda', 'bingo')}</em></>} bajada={t('Toca una casilla cuando pase. Completa una línea y grita ¡BINGO!', 'Tap a square when it happens. Complete a line and shout BINGO!')}>
      {lineas.length > 0 && <div className="bingo-cantado" role="status"><b>¡BINGO!</b><span>{lineas.length === 1 ? t('Una línea. ¡Grítalo fuerte!', 'One line. Shout it out!') : t(`${lineas.length} líneas. ¡Eres imparable!`, `${lineas.length} lines. Unstoppable!`)}</span></div>}
      <div className="carton" style={{ '--n': N }}>
        {carton.casillas.map((idx, k) => (
          <button key={k} type="button" className={`casilla ${carton.marcadas.includes(k) ? 'marcada' : ''} ${enLinea.has(k) ? 'en-linea' : ''}`} onClick={() => marcar(k)} aria-pressed={carton.marcadas.includes(k)}>
            <span>{textos[idx]}</span>
          </button>
        ))}
      </div>
      <p className="centro" style={{ marginTop: 20 }}>
        <button type="button" className="btn claro" onClick={() => { if (!carton.marcadas.length || confirm(t('¿Empezar con un cartón nuevo?', 'Start a new card?'))) setCarton(nuevoCarton()); }}>{t('Cartón nuevo', 'New card')}</button>
      </p>
    </PaginaApp>
  );
}
