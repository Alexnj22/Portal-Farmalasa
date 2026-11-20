import { useEffect, useRef, useState } from 'react';
import { fechaBoda } from '../config';
import { t } from '../lib/idioma';
import { ahora } from '../lib/reloj';
import { sinMovimiento } from '../lib/movimiento';

function partes() {
  const ms = Math.max(0, fechaBoda - ahora());
  const dias = Math.floor(ms / 864e5);
  return [
    [dias === 1 ? t('día', 'day') : t('días', 'days'), dias, 1],
    [t('horas', 'hours'), Math.floor(ms / 36e5) % 24, 2],
    [t('minutos', 'minutes'), Math.floor(ms / 6e4) % 60, 2],
    [t('segundos', 'seconds'), Math.floor(ms / 1e3) % 60, 2],
  ];
}

// Un 9 extra ANTES del 0: al bajar de 0 a 9 la tira sube un solo paso (hasta
// ese 9) y luego salta, sin animar, al 9 de abajo. Así no recorre los diez.
const TIRA = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Un dígito que rueda hasta su valor, como un contador mecánico. */
function Rueda({ d }) {
  const [pos, setPos] = useState(d + 1);
  const [sinTransicion, setSinTransicion] = useState(false);
  const previo = useRef(d);
  useEffect(() => {
    const antes = previo.current;
    previo.current = d;
    if (antes === 0 && d === 9) { setSinTransicion(false); setPos(0); return; }
    setPos(d + 1);
  }, [d]);
  const alTerminar = () => {
    if (pos === 0) { setSinTransicion(true); setPos(10); requestAnimationFrame(() => requestAnimationFrame(() => setSinTransicion(false))); }
  };
  return (
    <span className="rueda" aria-hidden>
      <span className="rueda-tira" style={{ '--d': pos, transition: sinTransicion ? 'none' : undefined }} onTransitionEnd={alTerminar}>
        {TIRA.map((n, i) => <span key={i}>{n}</span>)}
      </span>
    </span>
  );
}

/**
 * Cuenta regresiva con dígitos que ruedan. Arranca en ceros y, al entrar en
 * pantalla, cada dígito rueda hasta su valor; después sigue segundo a segundo.
 * El reloj sólo corre mientras la cuenta se ve.
 */
export default function Countdown() {
  const raiz = useRef(null);
  const quieto = sinMovimiento();
  const [p, setP] = useState(partes);
  const [visto, setVisto] = useState(quieto);
  const [enPantalla, setEnPantalla] = useState(false);
  const [entrando, setEntrando] = useState(false);

  // El primer giro (desde cero) es largo; los de cada segundo, cortos.
  useEffect(() => {
    if (!visto || quieto) return undefined;
    setEntrando(true);
    const fin = setTimeout(() => setEntrando(false), 2900);
    return () => clearTimeout(fin);
  }, [visto, quieto]);

  useEffect(() => {
    const el = raiz.current;
    if (!el || !('IntersectionObserver' in window)) { setVisto(true); setEnPantalla(true); return undefined; }
    const io = new IntersectionObserver(([e]) => {
      setEnPantalla(e.isIntersecting);
      if (e.isIntersecting) setVisto(true);
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!enPantalla) return undefined;
    setP(partes());
    const reloj = setInterval(() => setP(partes()), 1000);
    return () => clearInterval(reloj);
  }, [enPantalla]);

  const texto = p.slice(0, 3).map(([k, v]) => `${v} ${k}`).join(', ');
  return (
    <div ref={raiz} className={`cuenta ${visto ? 'vista' : ''} ${entrando ? 'entrando' : ''}`} role="timer" aria-label={`${t('Faltan', 'Countdown')}: ${texto}`}>
      {p.map(([k, v, min], i) => {
        const digitos = String(v).padStart(min, '0').split('').map(Number);
        return (
          <div key={i} className="cuenta-celda" style={{ '--orden': i }}>
            <b>{digitos.map((d, j) => <Rueda key={digitos.length - j} d={visto ? d : 0} />)}</b>
            <span>{k}</span>
          </div>
        );
      })}
    </div>
  );
}
