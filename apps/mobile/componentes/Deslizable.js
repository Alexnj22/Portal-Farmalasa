// Deslizar un renglón para actuar sobre él — el gesto de Mail en iPhone y el
// «swipe to dismiss» de Material en Android (2026-10-12, «al deslizar no se
// eliminan»: la pestaña de Notificaciones no tenía gesto alguno).
//
// Con `PanResponder` + `Animated` del propio React Native, a propósito: el
// gesto y la animación corren en el hilo nativo (`useNativeDriver`) y no hace
// falta ningún módulo nativo nuevo — gesture-handler y reanimated están en
// node_modules sólo como dependencia de otra librería, y un módulo que la app
// no declara puede no quedar enlazado en la compilación de la tienda.
//
// Hacia la izquierda: la acción destructiva (rojo, «Eliminar»); hacia la
// derecha: la secundaria («Leído»). Pasado el umbral, al soltar se ejecuta y el
// renglón sale de la pantalla; antes del umbral vuelve a su lugar. Sólo toma el
// gesto cuando es claramente horizontal, para no pelearle el desplazamiento a
// la lista.
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Platform, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { MARCA } from './inicio/marca';
import { iconoDe } from '../tema/iconos';

const UMBRAL = 0.32;   // fracción del ancho a partir de la cual se ejecuta

function Fondo({ lado, color, icono, texto, x, ancho }) {
  const izquierda = lado === 'izquierda';
  const opacidad = x.interpolate({
    inputRange: izquierda ? [-ancho, -24, 0] : [0, 24, ancho],
    outputRange: izquierda ? [1, 1, 0] : [0, 1, 1],
    extrapolate: 'clamp',
  });
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, opacity: opacidad,
      backgroundColor: color, borderRadius: Platform.OS === 'android' ? 16 : 22,
      flexDirection: 'row', alignItems: 'center', justifyContent: izquierda ? 'flex-end' : 'flex-start', paddingHorizontal: 22, gap: 8,
    }}>
      <Host matchContents><Icon name={iconoDe(icono)} size={20} color="#fff" /></Host>
      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Animated.View>
  );
}

// El gesto, fuera del componente: se crea una vez por renglón y lee las
// acciones vigentes de `vivo` (las actualiza un efecto).
function crearGesto({ x, ancho, vivo, avisado }) {
  return PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6
      && ((g.dx < 0 && vivo.current.onIzquierda) || (g.dx > 0 && vivo.current.onDerecha)),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { avisado.current = false; },
    onPanResponderMove: (_, g) => {
      const dx = (g.dx < 0 && !vivo.current.onIzquierda) || (g.dx > 0 && !vivo.current.onDerecha) ? 0 : g.dx;
      x.setValue(dx);
      const pasa = Math.abs(dx) > ancho * UMBRAL;
      if (pasa !== avisado.current) { avisado.current = pasa; if (pasa) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }
    },
    onPanResponderRelease: (_, g) => {
      const accion = g.dx < 0 ? vivo.current.onIzquierda : vivo.current.onDerecha;
      if (accion && Math.abs(g.dx) > ancho * UMBRAL) {
        Animated.timing(x, { toValue: Math.sign(g.dx) * ancho, duration: 180, useNativeDriver: true }).start(() => {
          accion();
          // Si el renglón no se va (p.ej. «Leído» lo deja), vuelve a su lugar.
          x.setValue(0);
        });
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      }
    },
    onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
  });
}

/**
 * @param onIzquierda  acción al deslizar a la izquierda (p.ej. eliminar)
 * @param onDerecha    acción al deslizar a la derecha (p.ej. marcar leído)
 * @param margen       el margen horizontal del renglón (el fondo lo respeta)
 */
export default function Deslizable({ children, onIzquierda, onDerecha, izquierda = { texto: 'Eliminar', icono: 'Trash2', color: MARCA.rojo },
  derecha = { texto: 'Leído', icono: 'CheckCircle2', color: MARCA.azul }, margen = 16 }) {
  const [x] = useState(() => new Animated.Value(0));
  const ancho = Dimensions.get('window').width;
  const avisado = useRef(false);
  // El gesto se crea una vez por renglón; las acciones vigentes se leen de acá.
  const vivo = useRef({});
  useEffect(() => { vivo.current = { onIzquierda, onDerecha }; }, [onIzquierda, onDerecha]);
  // Los refs viajan al gesto, que sólo los lee en sus manejadores (al tocar),
  // nunca al dibujar; la regla no distingue la creación del uso.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => crearGesto({ x, ancho, vivo, avisado }));

  return (
    <View style={{ marginHorizontal: margen }}>
      {onIzquierda ? <Fondo lado="izquierda" x={x} ancho={ancho} {...izquierda} /> : null}
      {onDerecha ? <Fondo lado="derecha" x={x} ancho={ancho} {...derecha} /> : null}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
