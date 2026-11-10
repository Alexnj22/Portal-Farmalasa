import { useLayoutEffect, useRef, useState } from 'react';
import { useProgresoScroll, sinMovimiento } from '../lib/movimiento';
import { t } from '../lib/idioma';
import Visor from './Visor';

/**
 * Las fotos de los novios en una tira que avanza de lado mientras se baja.
 * La sección mide lo que la tira sobra de ancho: así bajar = recorrerla.
 * Con movimiento reducido es una tira que se desliza con el dedo.
 */
export default function GaleriaHorizontal({ titulo, fotos }) {
  const seccion = useRef(null);
  const pista = useRef(null);
  const barra = useRef(null);
  const [alto, setAlto] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const quieta = sinMovimiento();

  useLayoutEffect(() => {
    if (quieta) return undefined;
    const medir = () => {
      const sobra = pista.current.scrollWidth - window.innerWidth;
      setAlto(window.innerHeight + Math.max(0, sobra));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(pista.current);
    window.addEventListener('resize', medir);
    return () => { ro.disconnect(); window.removeEventListener('resize', medir); };
  }, [quieta]);

  useProgresoScroll(seccion, (p, r, vh) => {
    if (quieta || !pista.current) return;
    const recorrido = Math.max(0, r.height - vh);
    const q = recorrido ? Math.min(1, Math.max(0, -r.top / recorrido)) : 0;
    const sobra = pista.current.scrollWidth - window.innerWidth;
    pista.current.style.transform = `translate3d(${-q * sobra}px,0,0)`;
    if (barra.current) barra.current.style.transform = `scaleX(${q})`;
  }, { inicio: 0, fin: 1 });

  const items = fotos.map((url) => ({ url }));
  return (
    <section id="fotos" ref={seccion} className={`galeria-h ${quieta ? 'quieta' : ''}`} style={alto ? { height: alto } : undefined}>
      <div className="pegada">
        <div className="contenedor galeria-cabeza">
          <h2>{titulo}</h2>
          <span className="versalita suave">{String(fotos.length).padStart(2, '0')} {t('fotos', 'photos')}</span>
        </div>
        <div className="pista" ref={pista}>
          {items.map((f, n) => (
            <button type="button" key={f.url} className={`foto-h ${n % 3 === 1 ? 'ancha' : ''}`} onClick={() => setAbierta(n)} aria-label={t(`Ver foto ${n + 1}`, `View photo ${n + 1}`)}>
              <img src={f.url} alt="" loading="lazy" decoding="async" />
              <span className="num">{String(n + 1).padStart(2, '0')}</span>
            </button>
          ))}
        </div>
        <div className="contenedor"><div className="progreso"><div ref={barra} /></div></div>
      </div>
      {abierta != null && <Visor items={items} indice={abierta} alCambiar={setAbierta} alCerrar={() => setAbierta(null)} />}
    </section>
  );
}
