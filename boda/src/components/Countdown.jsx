import { useEffect, useState } from 'react';
import { fechaBoda } from '../config';
import { t } from '../lib/idioma';
import { ahora } from '../lib/reloj';

function partes() {
  const ms = Math.max(0, fechaBoda - ahora());
  return {
    [t('días', 'days')]: Math.floor(ms / 864e5),
    [t('horas', 'hours')]: Math.floor(ms / 36e5) % 24,
    min: Math.floor(ms / 6e4) % 60,
    [t('seg', 'sec')]: Math.floor(ms / 1e3) % 60,
  };
}

export default function Countdown() {
  const [p, setP] = useState(partes);
  useEffect(() => {
    const t = setInterval(() => setP(partes()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="cuenta" aria-label={t('Cuenta regresiva', 'Countdown')}>
      {Object.entries(p).map(([k, v]) => (
        <div key={k}><b>{String(v).padStart(2, '0')}</b><span>{k}</span></div>
      ))}
    </div>
  );
}
