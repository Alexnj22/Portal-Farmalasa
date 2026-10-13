// Deslizar un mensaje hacia la derecha para responderlo, como en WhatsApp o
// iMessage: el mensaje se corre, aparece la flecha de responder, al pasar el
// umbral el teléfono da un toque, y al soltar el mensaje queda citado en el
// cuadro de respuesta. Si no se pasó el umbral, vuelve a su lugar sin hacer nada.
//
// Con PanResponder y Animated del propio React Native (como `Deslizable`): no
// pelea con el desplazamiento vertical del hilo porque sólo toma el gesto
// cuando es claramente horizontal y hacia la derecha.
import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { iconoDe } from '../../tema/iconos';

const UMBRAL = 56;
const TOPE = 84;

// El gesto se crea UNA vez por mensaje; lo vigente (activo, qué hacer) se lee
// del ref en los manejadores, nunca al dibujar.
function crearGesto({ x, vivo, paso }) {
  const volver = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6, speed: 18 }).start();
  return PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => vivo.current.activo && g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
    onMoveShouldSetPanResponderCapture: (_e, g) => vivo.current.activo && g.dx > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 2.5,
    onPanResponderGrant: () => { paso.current = false; },
    onPanResponderMove: (_e, g) => {
      const dx = Math.max(0, Math.min(TOPE, g.dx * 0.75));
      x.setValue(dx);
      const ahora = dx >= UMBRAL;
      if (ahora !== paso.current) {
        paso.current = ahora;
        if (ahora) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    },
    onPanResponderRelease: () => {
      if (paso.current) vivo.current.onResponder?.();
      paso.current = false;
      volver();
    },
    onPanResponderTerminate: () => { paso.current = false; volver(); },
    onPanResponderTerminationRequest: () => false,
  });
}

export default function DeslizarParaResponder({ children, onResponder, activo = true }) {
  const [x] = useState(() => new Animated.Value(0));
  const paso = useRef(false);
  const vivo = useRef({ activo, onResponder });
  useEffect(() => { vivo.current = { activo, onResponder }; }, [activo, onResponder]);
  // eslint-disable-next-line react-hooks/refs
  const [gesto] = useState(() => crearGesto({ x, vivo, paso }));

  const flecha = {
    opacity: x.interpolate({ inputRange: [0, UMBRAL * 0.4, UMBRAL], outputRange: [0, 0.4, 1], extrapolate: 'clamp' }),
    transform: [{ scale: x.interpolate({ inputRange: [0, UMBRAL], outputRange: [0.6, 1], extrapolate: 'clamp' }) }],
  };

  return (
    <View>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center' }, flecha]}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.18)' }}>
          <Host matchContents><Icon name={iconoDe('Responder')} size={16} color="#8E8E93" /></Host>
        </View>
      </Animated.View>
      <Animated.View {...gesto.panHandlers} style={{ transform: [{ translateX: x }] }}>
        {children}
      </Animated.View>
    </View>
  );
}
