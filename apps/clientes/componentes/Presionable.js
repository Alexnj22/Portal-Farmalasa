// Un `Pressable` que acusa el toque como el sistema donde corre (2026-10-13).
// Misma firma que el de React Native: se cambia el nombre y nada más.
//
//   · iPhone y web: tal cual. Cada pantalla decide su acuse con el estilo en
//     función de `pressed` (se encoge, se atenúa), que es lo de iOS.
//   · Android: la ONDA de Material (`android_ripple`), dentro de la caja y
//     encima del contenido, como la pieza `Tocable` de la app del personal
//     (apps/mobile/componentes/Tocable.js). Y el estilo se pide SIEMPRE con
//     `pressed: false`: encoger o atenuar al apretar es lenguaje de iOS, y en
//     Android se veía como un control «portado» — además, cambiar el estilo
//     al apretar obliga a un render de React por cada toque (dos, con el de
//     soltar), justo cuando el hilo de JavaScript está arrancando la acción.
//     La onda la dibuja el sistema, sin pasar por JavaScript.
//
// Si quien lo usa pasa su propia `android_ripple`, se respeta; con `false`
// no hay onda (un velo que cierra al tocarlo no es un botón que se aprieta).
//
// (2026-10-20, «que los elementos, al interactuar, se sientan animados, como
// nativos: en iOS el vidrio, en Android según su diseño») Además del acuse de
// cada pantalla, un RESORTE propio en el hilo de la interfaz, sin pasar por
// React:
//   · iPhone: la pieza se hunde al apretar y vuelve con un rebote leve, como
//     los controles de iOS 26. Sólo donde la pantalla no decidió su propio
//     acuse (`style` como función): 64 piezas no respondían al toque.
//   · Android: la onda de siempre y, junto con ella, el hundimiento corto de
//     Material 3 Expressive (resorte de «efectos», sin rebote visible).
//   · Cuánto se hunde depende del TAMAÑO: ~6 pt en iPhone y ~3 pt en Android
//     sobre el ancho, con tope. Una fila a lo ancho y un botón redondo se
//     sienten igual; con un porcentaje fijo, la fila se encogía de más.
//   · Nada si la pieza ya tiene su propia transformación, si el sistema pide
//     reducir el movimiento o con `sinAcuse`.
import { forwardRef, useRef } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { PRESION, SUELTA_TOQUE } from './movimiento';

const ANDROID = Platform.OS === 'android';
// Gris neutro al 20%: se lee sobre superficie clara, oscura y sobre el magenta.
export const ONDA = { color: 'rgba(127,127,127,0.22)', foreground: true };
const SUELTO = { pressed: false };
const PressableAnimado = Animated.createAnimatedComponent(Pressable);
const HUNDE = ANDROID ? { pt: 3, tope: 0.03 } : { pt: 6, tope: 0.05 };

const Presionable = forwardRef(function Presionable({ style, android_ripple: onda, sinAcuse = false, onPressIn, onPressOut, onLayout, ...props }, ref) {
  const reducir = useReducedMotion();
  const s = useSharedValue(1);
  const ancho = useRef(0);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const propio = typeof style === 'function';
  // En Android el estilo se pide siempre «suelto» (ver arriba).
  const resuelto = propio && ANDROID ? style(SUELTO) : style;
  const conTransform = !propio || ANDROID ? !!StyleSheet.flatten(resuelto)?.transform : false;
  const resorte = !sinAcuse && !reducir && !conTransform && (ANDROID || !propio) && Platform.OS !== 'web';
  const ondaFinal = ANDROID ? (onda === undefined ? ONDA : onda || undefined) : onda;
  if (!resorte) return <Pressable ref={ref} style={resuelto} android_ripple={ondaFinal} onPressIn={onPressIn} onPressOut={onPressOut} onLayout={onLayout} {...props} />;
  return (
    <PressableAnimado ref={ref} {...props} android_ripple={ondaFinal} style={[resuelto, animado]}
      onLayout={(e) => { ancho.current = e.nativeEvent.layout.width; onLayout?.(e); }}
      onPressIn={(e) => {
        const w = ancho.current;
        s.value = withSpring(1 - (w > 0 ? Math.min(HUNDE.tope, HUNDE.pt / w) : HUNDE.tope / 2), PRESION);
        onPressIn?.(e);
      }}
      onPressOut={(e) => { s.value = withSpring(1, SUELTA_TOQUE); onPressOut?.(e); }} />
  );
});

export default Presionable;
