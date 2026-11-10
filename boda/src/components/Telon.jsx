import { useState } from 'react';
import { sinMovimiento } from '../lib/movimiento';

const LS = 'boda-telon-visto';
const yaVisto = () => { try { return sessionStorage.getItem(LS) === '1'; } catch { return true; } };

/**
 * Apertura: el monograma y, si viene de una invitación, a quién va dirigida;
 * luego el telón sube y deja ver la portada. Una vez por visita, no bloquea
 * toques (pointer-events: none) y no existe con movimiento reducido.
 */
export default function Telon({ monograma, para }) {
  const [vivo] = useState(() => !yaVisto() && !sinMovimiento());
  const [fuera, setFuera] = useState(false);
  if (!vivo || fuera) return null;
  return (
    <div className="telon" aria-hidden onAnimationEnd={(e) => {
      if (e.animationName === 'telon-sube') { try { sessionStorage.setItem(LS, '1'); } catch { /* privado */ } setFuera(true); }
    }}>
      <div className="telon-centro">
        <p className="telon-mono">{monograma}</p>
        {para && <p className="telon-para">{para}</p>}
      </div>
    </div>
  );
}
