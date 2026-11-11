import { useEffect, useRef, useState } from 'react';

/** Segundos que le quedan a la pregunta abierta, corregido por la hora del servidor. */
export function useQuedan(estado, segundos) {
  const desfase = useRef(0);
  const [quedan, setQuedan] = useState(null);
  useEffect(() => { if (estado?.ahora) desfase.current = Date.parse(estado.ahora) - Date.now(); }, [estado?.ahora]);
  useEffect(() => {
    if (estado?.fase !== 'abierta' || !estado.desde) { setQuedan(null); return undefined; }
    const calc = () => setQuedan(Math.max(0, Math.ceil(segundos - (Date.now() + desfase.current - Date.parse(estado.desde)) / 1000)));
    calc();
    const i = setInterval(calc, 250);
    return () => clearInterval(i);
  }, [estado?.fase, estado?.desde, segundos]);
  return quedan;
}

/** Aro que se vacía con el tiempo. */
export function Aro({ quedan, total, tam = 64 }) {
  if (quedan == null) return null;
  const r = tam / 2 - 4; const c = 2 * Math.PI * r;
  return (
    <span className={`aro ${quedan <= 5 ? 'urgente' : ''}`} style={{ width: tam, height: tam }} role="timer" aria-label={`${quedan} s`}>
      <svg width={tam} height={tam} aria-hidden><circle cx={tam / 2} cy={tam / 2} r={r} className="aro-fondo" /><circle cx={tam / 2} cy={tam / 2} r={r} className="aro-tiempo" style={{ strokeDasharray: c, strokeDashoffset: c * (1 - quedan / total) }} /></svg>
      <b>{quedan}</b>
    </span>
  );
}
