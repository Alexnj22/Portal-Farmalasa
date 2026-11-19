import { useEffect, useState } from 'react';
import { fechaBoda } from '../config';
import { t } from '../lib/idioma';
import { ahora } from '../lib/reloj';

// Días, horas y minutos: sin segundos que corren. La cuenta se lee, no se mira.
function partes() {
  const ms = Math.max(0, fechaBoda - ahora());
  const dias = Math.floor(ms / 864e5);
  return [
    [dias === 1 ? t('día', 'day') : t('días', 'days'), dias],
    [t('horas', 'hours'), Math.floor(ms / 36e5) % 24],
    [t('minutos', 'minutes'), Math.floor(ms / 6e4) % 60],
  ];
}

export default function Countdown() {
  const [p, setP] = useState(partes);
  useEffect(() => {
    const reloj = setInterval(() => setP(partes()), 15000);
    return () => clearInterval(reloj);
  }, []);
  return (
    <div className="cuenta" role="timer" aria-label={t('Cuenta regresiva', 'Countdown')}>
      {p.map(([k, v], i) => (
        <div key={i}><b>{i === 0 ? v : String(v).padStart(2, '0')}</b><span>{k}</span></div>
      ))}
    </div>
  );
}
