import { useState } from 'react';

export default function Copiar({ texto, children = 'Copiar', className = 'btn claro chico' }) {
  const [listo, setListo] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => {
      try { await navigator.clipboard.writeText(texto); setListo(true); setTimeout(() => setListo(false), 1800); }
      catch { window.prompt('Copia este texto:', texto); }
    }}>
      {listo ? '¡Copiado!' : children}
    </button>
  );
}
