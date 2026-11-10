import { useState } from 'react';
import { t } from '../lib/idioma';

export default function Copiar({ texto, children = 'Copiar', className = 'btn claro chico' }) {
  const [listo, setListo] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => {
      try { await navigator.clipboard.writeText(texto); setListo(true); setTimeout(() => setListo(false), 1800); }
      catch { window.prompt(t('Copia este texto:', 'Copy this text:'), texto); }
    }}>
      {listo ? t('¡Copiado!', 'Copied!') : children}
    </button>
  );
}
