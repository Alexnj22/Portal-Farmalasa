// Un `Pressable` que SIEMPRE acusa el toque. En el teléfono no hay cursor ni
// hover: si el dedo no ve que el botón respondió, aprieta otra vez (canon
// móvil, regla 2 del CLAUDE.md). Los enlaces de texto («Exportar CSV»,
// «Rechazar», «Editar») eran `Pressable` con un estilo fijo: no se movían.
//
// Desde el 2026-11-13 («TODO debe ser material nuevo en android») es el
// `Pressable` de TODA la app: las pantallas lo importan con ese nombre
// (`import Pressable from '…/componentes/Tocable'`), así la firma es la misma.
//
//   · iPhone: si el que lo usa ya decide su acuse —estilo o hijos como función
//     de `pressed`, el encogido o el atenuado de iOS—, se respeta tal cual; si
//     no, se atenúa mientras se aprieta, que es lo que hace un botón del sistema.
//   · Android: la onda de Material, encima del contenido y dentro de la caja,
//     SIEMPRE (también si la pantalla trae su propio acuse: React Native no la
//     pone sola y sin ella el toque se sentía «portado»). La pantalla puede
//     pasar su `android_ripple`, o `null` para no tenerla.
//     Excepción: el fondo oscuro que cierra una hoja o un diálogo al tocarlo
//     afuera — una onda de pantalla completa sería un destello.
import { forwardRef } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

const APRETADO = { opacity: 0.55 };
const ANDROID = Platform.OS === 'android';
const ONDA = { color: 'rgba(127,127,127,0.20)', foreground: true };

function esTelon(style) {
  try {
    const plano = StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) || {};
    const fondo = String(plano.backgroundColor ?? '');
    return /^rgba\(0,\s*0,\s*0,/.test(fondo) || fondo === 'transparent' && plano.flex === 1;
  } catch {
    return false;
  }
}

function Tocable({ style, children, android_ripple: onda, ...props }, ref) {
  const propio = typeof style === 'function' || typeof children === 'function';
  let ripple;
  if (ANDROID) {
    if (onda !== undefined) ripple = onda ?? undefined;
    else if ((props.onPress || props.onLongPress) && !esTelon(style)) ripple = ONDA;
  }
  return (
    <Pressable ref={ref} {...props} android_ripple={ripple}
      style={propio ? style : ({ pressed }) => [style, pressed && !props.disabled && !ANDROID ? APRETADO : null]}>
      {children}
    </Pressable>
  );
}

export default forwardRef(Tocable);

// El `Pressable` de las pantallas que lo escribían a mano (las ~290 que se
// pasaron acá el 2026-11-13). Android: la onda de Material, igual que arriba.
// iPhone: EXACTAMENTE el Pressable de antes — sin el atenuado automático,
// que sobre una tarjeta de Liquid Glass la dejaba sin dibujar (el vidrio no
// se pinta si un contenedor le anima la opacidad) y sobre un telón parpadeaba.
function PresionableBase({ android_ripple: onda, ...props }, ref) {
  let ripple;
  if (ANDROID) {
    if (onda !== undefined) ripple = onda ?? undefined;
    else if ((props.onPress || props.onLongPress) && !esTelon(props.style)) ripple = ONDA;
  }
  return <Pressable ref={ref} {...props} android_ripple={ripple} />;
}
export const Presionable = forwardRef(PresionableBase);
