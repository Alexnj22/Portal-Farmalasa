// Un `Pressable` que SIEMPRE acusa el toque. En el teléfono no hay cursor ni
// hover: si el dedo no ve que el botón respondió, aprieta otra vez (canon
// móvil, regla 2 del CLAUDE.md). Los enlaces de texto («Exportar CSV»,
// «Rechazar», «Editar») eran `Pressable` con un estilo fijo: no se movían.
//
// Si el que lo usa ya decide su acuse —estilo o hijos como función de
// `pressed`—, se respeta tal cual; si no, se atenúa mientras se aprieta,
// que es lo que hace un botón de texto del sistema.
import { Platform, Pressable } from 'react-native';

const APRETADO = { opacity: 0.55 };
// En Android el acuse es la onda de Material (encima del contenido, dentro de
// la caja), no el atenuado de iOS.
const ANDROID = Platform.OS === 'android';
const ONDA = { color: 'rgba(127,127,127,0.20)', foreground: true };

export default function Tocable({ style, children, android_ripple: onda, ...props }) {
  const propio = typeof style === 'function' || typeof children === 'function';
  return (
    <Pressable {...props} android_ripple={ANDROID ? (onda ?? ONDA) : undefined}
      style={propio ? style : ({ pressed }) => [style, pressed && !props.disabled && !ANDROID ? APRETADO : null]}>
      {children}
    </Pressable>
  );
}
