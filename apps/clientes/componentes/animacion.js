// Las piezas animadas de la app. Todas corren en el hilo de la interfaz
// (Reanimated): nada se anima con temporizadores de JavaScript, que es lo que
// hace que una app de React Native se sienta trabada.
import { useEffect } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated, {
  Easing, useAnimatedProps, useAnimatedStyle, useSharedValue,
  withDelay, withSpring, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const TextoAnimado = Animated.createAnimatedComponent(TextInput);

/**
 * Un número que cuenta hasta su valor (el saldo al abrir). Se dibuja en un
 * TextInput no editable porque es lo único cuyo texto puede cambiar desde el
 * hilo de la interfaz sin pasar por un render de React.
 */
export function NumeroAnimado({ valor, formato = 'dolares', duracion = 900, estilo }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(Number(valor) || 0, { duration: duracion, easing: Easing.out(Easing.cubic) });
  }, [valor, duracion, v]);
  const props = useAnimatedProps(() => {
    const n = v.value;
    const texto = formato === 'dolares'
      ? `$${n.toFixed(2)}`
      : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return { text: texto, defaultValue: texto };
  });
  return (
    <TextoAnimado
      editable={false}
      pointerEvents="none"
      underlineColorAndroid="transparent"
      animatedProps={props}
      style={[{ padding: 0, margin: 0 }, estilo]}
    />
  );
}

/** La barra que se llena con resorte. `avance` entre 0 y 1. */
export function BarraAnimada({ avance, color, fondo, alto = 8 }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withSpring(Math.max(0, Math.min(1, avance)), { damping: 18, stiffness: 90 });
  }, [avance, v]);
  const estilo = useAnimatedStyle(() => ({ width: `${v.value * 100}%` }));
  return (
    <View style={{ height: alto, borderRadius: alto / 2, backgroundColor: fondo, overflow: 'hidden' }}>
      <Animated.View style={[{ height: alto, borderRadius: alto / 2, backgroundColor: color }, estilo]} />
    </View>
  );
}

/**
 * Entrada escalonada: cada bloque sube y crece un poco después del anterior.
 *
 * SIN opacidad, a propósito: el Liquid Glass de iOS 26 no se dibuja si su
 * contenedor nace con opacidad 0 — con `FadeInDown` las tarjetas quedaban
 * invisibles (medido en el simulador el 2026-10-05). El movimiento sólo usa
 * desplazamiento y escala, que el vidrio sí acompaña.
 */
function entradaSinOpacidad(retraso) {
  return () => {
    'worklet';
    const resorte = { damping: 18, stiffness: 140, mass: 0.9 };
    return {
      initialValues: { transform: [{ translateY: 28 }, { scale: 0.97 }] },
      animations: {
        transform: [
          { translateY: withDelay(retraso, withSpring(0, resorte)) },
          { scale: withDelay(retraso, withSpring(1, resorte)) },
        ],
      },
    };
  };
}

export function Entrada({ indice = 0, children, estilo }) {
  return (
    <Animated.View style={estilo} entering={entradaSinOpacidad(60 + indice * 70)}>
      {children}
    </Animated.View>
  );
}

/** Algo que se toca: se encoge un poco con resorte y da el toque háptico del sistema. */
// `onPress` también se acepta: es el que pone `<Link asChild>` para navegar, y
// sin encadenarlo aquí el toque háptico se perdía.
export function Tocable({ alTocar, onPress, children, estilo, ...resto }) {
  const s = useSharedValue(1);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...resto}
      onPressIn={() => { s.value = withSpring(0.97, { damping: 20, stiffness: 400 }); }}
      onPressOut={() => { s.value = withSpring(1, { damping: 14, stiffness: 300 }); }}
      onPress={(e) => { Haptics.selectionAsync().catch(() => {}); alTocar?.(); onPress?.(e); }}
    >
      <Animated.View style={[estilo, animado]}>{children}</Animated.View>
    </Pressable>
  );
}
