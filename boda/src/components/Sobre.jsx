import { lazy, Suspense, useLayoutEffect, useState } from 'react';
import { sinMovimiento } from '../lib/movimiento';

// El sobre en WebGL cuando el aparato puede; si no, la versión en CSS.
const Sobre3D = lazy(() => import('./sobre3d/Sobre3D'));
const SobreCss = lazy(() => import('./SobreCss'));

const LS = 'boda-sobre-abierto';
const yaAbierto = (codigo) => { try { return sessionStorage.getItem(LS) === codigo; } catch { return true; } };
function hayWebGL() {
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    g?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!g;
  } catch { return false; }
}

/** Tapa la portada mientras baja el sobre, para que no se asome un instante. */
function Cargando() {
  useLayoutEffect(() => {
    document.documentElement.classList.add('con-sobre');
    return () => document.documentElement.classList.remove('con-sobre');
  }, []);
  return <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-sobre)', background: 'radial-gradient(80% 55% at 50% 44%, oklch(0.2 0.008 100), oklch(0.12 0.006 105) 72%)' }} />;
}

export default function Sobre(props) {
  const { codigo, desactivado } = props;
  const [modo] = useState(() => {
    if (!codigo || desactivado || yaAbierto(codigo) || sinMovimiento()) return null;
    return hayWebGL() ? '3d' : 'css';
  });
  if (!modo) return null;
  const Elegido = modo === '3d' ? Sobre3D : SobreCss;
  return <Suspense fallback={<Cargando />}><Elegido {...props} /></Suspense>;
}
