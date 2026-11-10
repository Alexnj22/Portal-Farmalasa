import { useEffect, useState } from 'react';
import { fechaBoda } from '../config';

function partes() {
  const ms = Math.max(0, fechaBoda - Date.now());
  return {
    días: Math.floor(ms / 864e5),
    horas: Math.floor(ms / 36e5) % 24,
    min: Math.floor(ms / 6e4) % 60,
    seg: Math.floor(ms / 1e3) % 60,
  };
}

export default function Countdown() {
  const [p, setP] = useState(partes);
  useEffect(() => {
    const t = setInterval(() => setP(partes()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="cuenta" aria-label="Cuenta regresiva">
      {Object.entries(p).map(([k, v]) => (
        <div key={k}><b>{String(v).padStart(2, '0')}</b><span>{k}</span></div>
      ))}
    </div>
  );
}
