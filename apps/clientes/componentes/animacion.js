// Las piezas animadas de la app. Todas corren en el hilo de la interfaz
// (Reanimated): nada se anima con temporizadores de JavaScript, que es lo que
// hace que una app de React Native se sienta trabada.
import { useEffect } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ANDROID, LIVIANO } from '../lib/rendimiento';
import { ONDA } from './Presionable';
import { M3, PRESION, SUELTA } from './movimiento';

const PressableAnimado = Animated.createAnimatedComponent(Pressable);

// «Reducir movimiento» del sistema o un teléfono viejo (lib/rendimiento):
// lo decorativo (confeti, latidos, entradas) no se anima (2026-10-13).
export function useSinMovimiento() {
  return useReducedMotion() || LIVIANO;
}

const TextoAnimado = Animated.createAnimatedComponent(TextInput);

/**
 * Un número que cuenta hasta su valor (el saldo al abrir). Se dibuja en un
 * TextInput no editable porque es lo único cuyo texto puede cambiar desde el
 * hilo de la interfaz sin pasar por un render de React.
 */
// `desde`: de dónde arranca la cuenta (el saldo anterior, para que se vea
// sumar o restar); sin él, desde 0.
export function NumeroAnimado({ valor, formato = 'dolares', duracion = 900, estilo, desde = 0 }) {
  const v = useSharedValue(Number(desde) || 0);
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
  const final = formato === 'dolares'
    ? `$${(Number(valor) || 0).toFixed(2)}`
    : Math.round(Number(valor) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // El texto que cambia por `animatedProps` no vuelve a medir el layout: el
  // ancho quedaba el de «0» y «1,234» se recortaba. Un Text invisible con la
  // cifra FINAL reserva el espacio, y el campo animado va encima. Además es
  // lo que lee VoiceOver: el campo de texto se anunciaba «atenuado».
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={final}>
      <Text style={[estilo, { opacity: 0 }]} importantForAccessibility="no">{final}</Text>
      <TextoAnimado
        editable={false}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        animatedProps={props}
        style={[{ padding: 0, margin: 0, position: 'absolute', left: 0, top: 0, right: 0 }, estilo]}
      />
    </View>
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
    // Más corta y sin rebote (revisión 2026-10-06: con muchas tarjetas a la
    // vez se sentía exagerado).
    const resorte = { damping: 24, stiffness: 180, mass: 0.9 };
    return {
      initialValues: { transform: [{ translateY: 12 }, { scale: 0.985 }] },
      animations: {
        transform: [
          { translateY: withDelay(retraso, withSpring(0, resorte)) },
          { scale: withDelay(retraso, withSpring(1, resorte)) },
        ],
      },
    };
  };
}

// Android (2026-10-14, Material 3 Expressive): un resorte ESPACIAL corto —8 dp
// hacia arriba, sin escala— y sólo para los primeros bloques. El 2026-10-13
// se había quitado porque, montado a la vez que la transición del sistema,
// competía con ella; ahora arranca cuando la transición ya va por la mitad
// (180 ms) y mueve poco, con la rigidez de la especificación (700, ζ 0.9).
function entradaAndroid(retraso) {
  return () => {
    'worklet';
    return {
      initialValues: { transform: [{ translateY: 8 }] },
      animations: { transform: [{ translateY: withDelay(retraso, withSpring(0, M3.espacial)) }] },
    };
  };
}

// `alMedir`: el `onLayout` del bloque (la tarjeta de socio lo usa para saber
// si quedó fuera de la vista, 2026-10-14).
export function Entrada({ indice = 0, children, estilo, alMedir }) {
  const quieta = useSinMovimiento();
  if (quieta || (ANDROID && indice > 4)) return <View style={estilo} onLayout={alMedir}>{children}</View>;
  if (ANDROID) {
    return <Animated.View style={estilo} onLayout={alMedir} entering={entradaAndroid(180 + indice * 30)}>{children}</Animated.View>;
  }
  return (
    // Con tope: en listas largas las últimas ya no esperan más de medio segundo.
    <Animated.View style={estilo} onLayout={alMedir} entering={entradaSinOpacidad(40 + Math.min(indice, 6) * 55)}>
      {children}
    </Animated.View>
  );
}

/** Algo que se toca: se encoge un poco con resorte y da el toque háptico del sistema. */
// `onPress` también se acepta: es el que pone `<Link asChild>` para navegar, y
// sin encadenarlo aquí el toque háptico se perdía.
// Android (2026-10-13): la onda de Material en vez del resorte (ver Presionable).
export function Tocable({ alTocar, onPress, children, estilo, etiqueta, ...resto }) {
  const s = useSharedValue(1);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  if (ANDROID) {
    // La onda se recorta a las esquinas de la tarjeta (16, las de Vidrio en
    // Android). Y Material 3 Expressive (2026-10-14): además de la onda, la
    // pieza se hunde apenas con el resorte de «efectos» y vuelve con el
    // espacial rápido — corto y sutil, sin rebote visible.
    return (
      <PressableAnimado accessibilityRole="button" accessibilityLabel={etiqueta} {...resto} android_ripple={ONDA}
        style={[{ borderRadius: 16, overflow: 'hidden' }, estilo, animado]}
        onPressIn={() => { s.value = withSpring(0.975, PRESION); }}
        onPressOut={() => { s.value = withSpring(1, SUELTA); }}
        onPress={(e) => { Haptics.selectionAsync().catch(() => {}); alTocar?.(); onPress?.(e); }}>
        {children}
      </PressableAnimado>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      {...resto}
      onPressIn={() => { s.value = withSpring(0.97, PRESION); }}
      onPressOut={() => { s.value = withSpring(1, SUELTA); }}
      onPress={(e) => { Haptics.selectionAsync().catch(() => {}); alTocar?.(); onPress?.(e); }}
    >
      <Animated.View style={[estilo, animado]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * Una ráfaga de confeti, UNA vez al montarse (el saldo alcanzó para canjear).
 * Las piezas suben, se abren y caen girando; todo en el hilo de la interfaz.
 * Discreta a propósito: 18 piezas, menos de dos segundos.
 */
function Pieza({ color, angulo, distancia, retraso, ancho }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(retraso, withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }));
  }, [p, retraso]);
  const estilo = useAnimatedStyle(() => {
    const x = Math.cos(angulo) * distancia * p.value;
    const subida = Math.sin(angulo) * distancia * p.value;
    const caida = 160 * p.value * p.value;
    return {
      opacity: p.value < 0.75 ? 1 : (1 - p.value) * 4,
      transform: [{ translateX: x }, { translateY: -subida + caida }, { rotate: `${p.value * 540}deg` }],
    };
  });
  return <Animated.View style={[{ position: 'absolute', width: ancho, height: ancho * 0.45, borderRadius: 2, backgroundColor: color }, estilo]} />;
}

export function Confeti({ colores, alTerminar }) {
  const quieto = useSinMovimiento();
  useEffect(() => {
    const reloj = setTimeout(() => alTerminar?.(), quieto ? 0 : 1800);
    return () => clearTimeout(reloj);
  }, [alTerminar, quieto]);
  if (quieto) return null;
  const piezas = Array.from({ length: 18 }, (_, i) => ({
    color: colores[i % colores.length],
    angulo: Math.PI * (0.15 + 0.7 * (i / 17)) + (i % 2 ? 0.08 : -0.08),
    distancia: 110 + (i * 37) % 90,
    retraso: (i * 23) % 160,
    ancho: 8 + (i % 3) * 3,
  }));
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '45%' }}>
      {piezas.map((p, i) => <Pieza key={i} {...p} />)}
    </View>
  );
}

/**
 * Algo que late suave para llamar la atención: TRES latidos al aparecer y
 * después quieto. Un pulso que no para nunca distrae y gasta batería (iOS no lo
 * hace; revisión 2026-10-06).
 */
export function Latido({ children, estilo, escala = 1.05 }) {
  const quieto = useSinMovimiento();
  const s = useSharedValue(1);
  useEffect(() => {
    if (quieto) { s.value = 1; return; }
    s.value = withDelay(400, withRepeat(withSequence(withTiming(escala, { duration: 600 }), withTiming(1, { duration: 600 })), 3));
  }, [s, escala, quieto]);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={[estilo, animado]}>{children}</Animated.View>;
}
