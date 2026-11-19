import { useEffect, useRef } from 'react';
import { sinMovimiento } from '../lib/movimiento';

const ligadaAlScroll = () => typeof CSS !== 'undefined' && CSS.supports?.('animation-timeline: view()');

/**
 * Aparece con un fundido suave al entrar en pantalla. Visible por defecto:
 * si el navegador liga animaciones a la vista, lo hace el CSS solo; si no,
 * un IntersectionObserver (y sólo entonces se esconde, con .esperando).
 */
export default function Revelar({ children, as: Tag = 'div', className = '', ...resto }) {
  const r = useRef(null);
  useEffect(() => {
    const el = r.current;
    if (!el || sinMovimiento() || ligadaAlScroll() || !('IntersectionObserver' in window)) return undefined;
    // Lo que ya está a la vista al cargar no se esconde (sin parpadeo).
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) return undefined;
    el.classList.add('esperando');
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('visto'); io.disconnect(); }
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={r} className={`revelar ${className}`} {...resto}>{children}</Tag>;
}
