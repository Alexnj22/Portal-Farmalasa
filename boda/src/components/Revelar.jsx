import { useEffect, useRef } from 'react';

/** Aparece con un fundido suave al entrar en pantalla. */
export default function Revelar({ children, as: Tag = 'div', className = '', ...resto }) {
  const r = useRef(null);
  useEffect(() => {
    const el = r.current;
    if (!('IntersectionObserver' in window)) { el.classList.add('visto'); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('visto'); io.disconnect(); }
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={r} className={`revelar ${className}`} {...resto}>{children}</Tag>;
}
