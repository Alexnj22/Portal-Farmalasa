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
  const marco = useRef(null);
  const barra = useRef(null);
  const [alto, setAlto] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const quieta = sinMovimiento();

  useLayoutEffect(() => {
    if (quieta) return undefined;
    // La sección mide exactamente el marco fijo + lo que la tira sobra de
    // ancho: al terminar la última foto, la sección termina. Nada de sobra.
    const medir = () => {
      const sobra = pista.current.scrollWidth - window.innerWidth;
      setAlto(marco.current.offsetHeight + Math.max(0, sobra));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(pista.current);
    ro.observe(marco.current);
    window.addEventListener('resize', medir);
    return () => { ro.disconnect(); window.removeEventListener('resize', medir); };
  }, [quieta]);

  useProgresoScroll(seccion, (p, r) => {
    if (quieta || !pista.current) return;
    const tope = marco.current.getBoundingClientRect().top - r.top >= 0 ? parseFloat(getComputedStyle(marco.current).top) || 0 : 0;
    const recorrido = Math.max(0, r.height - marco.current.offsetHeight);
    const q = recorrido ? Math.min(1, Math.max(0, (tope - r.top) / recorrido)) : 0;
    const sobra = pista.current.scrollWidth - window.innerWidth;
    pista.current.style.transform = `translate3d(${-q * sobra}px,0,0)`;
    if (barra.current) barra.current.style.transform = `scaleX(${q})`;
  }, { inicio: 0, fin: 1 });

  const items = fotos.map((url) => ({ url }));
  return (
    <section id="fotos" ref={seccion} className={`galeria-h ${quieta ? 'quieta' : ''}`} style={alto ? { height: alto } : undefined}>
      <div className="pegada" ref={marco}>
        <div className="contenedor galeria-cabeza">
          <h2>{titulo}</h2>
          <span className="versalita suave">{String(fotos.length).padStart(2, '0')} {t('fotos', 'photos')}</span>
        </div>
        <div className="pista" ref={pista}>
          {items.map((f, n) => (
            <button type="button" key={f.url} className={`foto-h ${n % 3 === 1 ? 'ancha' : ''}`} onClick={() => setAbierta(n)} aria-label={t(`Ver foto ${n + 1}`, `View photo ${n + 1}`)}>
              <img src={f.url} alt="" decoding="async" />
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
