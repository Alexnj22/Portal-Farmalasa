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
import { forwardRef } from 'react';
import { Platform, Pressable } from 'react-native';

const ANDROID = Platform.OS === 'android';
// Gris neutro al 20%: se lee sobre superficie clara, oscura y sobre el magenta.
export const ONDA = { color: 'rgba(127,127,127,0.22)', foreground: true };
const SUELTO = { pressed: false };

const Presionable = forwardRef(function Presionable({ style, android_ripple: onda, ...props }, ref) {
  if (!ANDROID) return <Pressable ref={ref} style={style} {...props} />;
  return (
    <Pressable ref={ref} {...props} android_ripple={onda === undefined ? ONDA : onda || undefined}
      style={typeof style === 'function' ? style(SUELTO) : style} />
  );
});

export default Presionable;
