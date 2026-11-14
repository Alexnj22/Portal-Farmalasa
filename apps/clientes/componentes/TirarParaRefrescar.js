// Deslizar hacia abajo para refrescar, en el NAVEGADOR (2026-11-14).
//
// En react-native-web `RefreshControl` no existe: la lista ignora el gesto y
// «arrastrar para actualizar» no hacía nada. Esto lo arma sobre el nodo que
// se desplaza: con la lista arriba del todo, tirar hacia abajo baja el
// contenido (con resistencia, como en el iPhone), muestra el indicador y, si
// se suelta pasado el umbral, llama a `alRefrescar`. Mientras `refrescando`,
// el indicador gira.
//
// Uso (componentes/ui.js): `const tirar = useTirarParaRefrescar({ alRefrescar,
// refrescando })`, `ref={tirar.ref}` en la lista y `{tirar.indicador}` encima.
// En el teléfono devuelve un ref que no hace nada y ningún indicador.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTema } from '../tema/tema';

const WEB = Platform.OS === 'web';
const UMBRAL = 64;
const TOPE = 110;

export function useTirarParaRefrescar({ alRefrescar, refrescando, arriba = 8, refExterno = null }) {
  const t = useTema();
  const lista = useRef(null);
  const accion = useRef(alRefrescar);
  accion.current = alRefrescar;
  const [tiro, setTiro] = useState(0);
  const [montado, setMontado] = useState(0);

  const ref = useCallback((r) => {
    lista.current = r;
    if (typeof refExterno === 'function') refExterno(r);
    else if (refExterno) refExterno.current = r;
    if (WEB) setMontado((n) => n + 1);
  }, [refExterno]);

  const hay = !!alRefrescar;
  useEffect(() => {
    if (!WEB || !hay) return undefined;
    const r = lista.current;
    const el = r?.getScrollableNode?.() ?? r;
    if (!el?.addEventListener) return undefined;
    const contenido = () => el.firstElementChild;
    let y0 = null; let d = 0; let paso = false;
    const mover = (px, suave) => {
      const c = contenido();
      if (c) { c.style.transition = suave ? 'transform 0.25s ease' : 'none'; c.style.transform = px ? `translateY(${px}px)` : ''; }
    };
    const inicio = (e) => {
      y0 = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
      d = 0; paso = false;
    };
    const moviendo = (e) => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy <= 0 || el.scrollTop > 0) { if (d) { d = 0; mover(0); setTiro(0); } if (el.scrollTop > 0) y0 = null; return; }
      // Tirando desde arriba: el gesto es nuestro (sin el rebote de Safari).
      if (e.cancelable) e.preventDefault();
      d = Math.min(dy * 0.5, TOPE);
      mover(d);
      setTiro(d);
      if (!paso && d >= UMBRAL) { paso = true; Haptics.selectionAsync().catch(() => {}); }
    };
    const fin = () => {
      if (y0 == null) return;
      y0 = null;
      const refrescar = d >= UMBRAL;
      d = 0;
      mover(0, true);
      setTiro(0);
      if (refrescar) accion.current?.();
    };
    el.addEventListener('touchstart', inicio, { passive: true });
    el.addEventListener('touchmove', moviendo, { passive: false });
    el.addEventListener('touchend', fin);
    el.addEventListener('touchcancel', fin);
    return () => {
      el.removeEventListener('touchstart', inicio);
      el.removeEventListener('touchmove', moviendo);
      el.removeEventListener('touchend', fin);
      el.removeEventListener('touchcancel', fin);
    };
  }, [hay, montado]);

  if (!WEB) return { ref: refExterno ?? undefined, indicador: null };
  const visible = refrescando || tiro > 4;
  const indicador = visible ? (
    <View pointerEvents="none" style={{ position: 'absolute', top: arriba, left: 0, right: 0, alignItems: 'center', zIndex: 5 }}>
      <View style={{
        width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.oscuro ? 'rgba(44,42,50,0.9)' : 'rgba(255,255,255,0.95)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        opacity: refrescando ? 1 : Math.min(tiro / UMBRAL, 1),
        transform: [{ scale: refrescando ? 1 : 0.6 + 0.4 * Math.min(tiro / UMBRAL, 1) }],
      }}>
        <ActivityIndicator size="small" color={t.color.magenta} animating={refrescando || tiro >= UMBRAL} hidesWhenStopped={false} />
      </View>
    </View>
  ) : null;
  return { ref, indicador };
}
