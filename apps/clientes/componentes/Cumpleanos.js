// El día del cumpleaños: la app lo celebra al abrir (una vez por día).
//
//   · el fondo se desenfoca y suben globos de colores, cada uno a su ritmo y
//     meciéndose de lado;
//   · el pastel entra con un rebote y late; cae confeti;
//   · el regalo se dice en puntos Y en dólares, como todo en la app.
//
// La regala la base (`puntos_dar_cumpleanos`, cron de las 6:10 SV): esto sólo
// lo cuenta. `resumen.cumpleanos` lo prende el servidor (o la muestra
// `cumpleanos` de `app_cliente_muestras`, para verla sin esperar al día).
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { Confeti } from './animacion';
import { dolares } from '../lib/formato';
import { useBloqueo } from '../lib/bloqueo';
import { useTema } from '../tema/tema';

const CLAVE = 'puntos_salud_cumple_visto';
const GLOBOS = ['🎈', '🎈', '🎈', '🎉', '🎈', '🎁', '🎈', '🎈'];
const COLORES_GLOBO = ['#FF2D55', '#FFD60A', '#5AC8FA', '#AF52DE', '#34C759', '#FF9F0A', '#FF375F', '#64D2FF'];

export default function Cumpleanos({ activo, nombre, puntos, forzar = false }) {
  const [visible, setVisible] = useState(false);
  const bloqueada = useBloqueo((s) => s.bloqueada);
  const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

  useEffect(() => {
    if (!activo) return;
    // `forzar`: llegó tocando el aviso de cumpleaños — se muestra aunque ya
    // se haya visto hoy (si no, el aviso abría la app y no pasaba nada).
    SecureStore.getItemAsync(CLAVE).catch(() => null).then((visto) => {
      if (forzar || visto !== hoy) {
        setVisible(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    });
  }, [activo, hoy, forzar]);

  const cerrar = () => {
    SecureStore.setItemAsync(CLAVE, hoy).catch(() => {});
    setVisible(false);
  };
  if (!visible || bloqueada) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={cerrar}>
      <Fiesta nombre={nombre} puntos={puntos} alCerrar={cerrar} />
    </Modal>
  );
}

function Fiesta({ nombre, puntos, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const compacta = useWindowDimensions().height < 720;
  const pastel = useSharedValue(0);
  const latido = useSharedValue(1);
  const texto = useSharedValue(0);
  useEffect(() => {
    pastel.value = withDelay(200, withSpring(1, { damping: 14, stiffness: 140 }));
    latido.value = withDelay(1200, withRepeat(withSequence(withTiming(1.06, { duration: 500 }), withTiming(1, { duration: 500 })), 4));
    texto.value = withDelay(450, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, [pastel, latido, texto]);
  const estiloPastel = useAnimatedStyle(() => ({
    transform: [{ scale: pastel.value * latido.value }, { rotate: `${(1 - pastel.value) * -10}deg` }],
  }));
  const estiloTexto = useAnimatedStyle(() => ({ opacity: texto.value, transform: [{ translateY: (1 - texto.value) * 24 }] }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView intensity={60} tint={t.oscuro ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.oscuro ? 'rgba(40,8,50,0.45)' : 'rgba(255,230,250,0.45)' }]} />
      {GLOBOS.map((g, i) => <Globo key={i} emoji={g} indice={i} color={COLORES_GLOBO[i % COLORES_GLOBO.length]} />)}
      <Confeti colores={['#FF2D55', '#FFD60A', '#5AC8FA', '#AF52DE', t.color.verde, t.color.magenta]} />

      {/* Mismo criterio que SubisteDeNivel (2026-10-09): áreas seguras, un
          ScrollView por si el texto del sistema está grande y medidas que se
          achican en pantallas bajas (iPhone SE), para que nada se salga. */}
      <ScrollView style={{ flex: 1 }} bounces={false} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: compacta ? 10 : 14,
          paddingTop: ins.top + 20, paddingBottom: Math.max(ins.bottom, 12) + 20, paddingHorizontal: 28 }}>
        <Animated.Text maxFontSizeMultiplier={1} style={[{ fontSize: compacta ? 84 : 110 }, estiloPastel]}>🎂</Animated.Text>
        <Animated.View style={[{ alignSelf: 'stretch', alignItems: 'center', gap: compacta ? 8 : 10 }, estiloTexto]}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: '800', letterSpacing: 2, color: t.color.magentaTexto }}>HOY ES TU DÍA</Text>
          <Text maxFontSizeMultiplier={1.2} adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={nombre ? 3 : 2}
            style={{ alignSelf: 'stretch', fontSize: compacta ? 30 : 34, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5, color: t.oscuro ? '#FFFFFF' : '#2B0B3A' }}>
            ¡Feliz cumpleaños{nombre ? `,\n${nombre}` : ''}!
          </Text>
          {puntos ? (
            <View style={{ maxWidth: '100%', backgroundColor: t.color.verde, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center', marginTop: 6 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: '800', color: '#1A2600', letterSpacing: 1 }}>TU REGALO</Text>
              <Text maxFontSizeMultiplier={1.2} adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: compacta ? 26 : 30, fontWeight: '900', color: '#1A2600' }}>{puntos} puntos</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 14, fontWeight: '700', color: '#1A2600', textAlign: 'center' }}>{dolares(puntos / 100)} para tu próxima compra</Text>
            </View>
          ) : null}
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, lineHeight: 21, textAlign: 'center', color: t.oscuro ? 'rgba(255,255,255,0.85)' : '#4A2A55', marginTop: 4 }}>
            Gracias por ser parte de Farmacia Salud. Que tengas un día lleno de salud y alegría.
          </Text>
        </Animated.View>
        <Pressable onPress={alCerrar} accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: compacta ? 10 : 18, minHeight: 50, justifyContent: 'center', backgroundColor: t.color.magenta, borderRadius: 999, paddingHorizontal: 40, paddingVertical: 14,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>¡Gracias! 🥳</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// Un globo que sube desde abajo, meciéndose, y vuelve a empezar.
function Globo({ emoji, indice, color }) {
  const { width: W, height: H } = Dimensions.get('window');
  const p = useMemo(() => ({
    x: (indice / GLOBOS.length) * W + (indice % 2 ? 10 : -10),
    dur: 5200 + (indice % 4) * 900,
    retraso: indice * 380,
    tam: 38 + (indice % 3) * 12,
  }), [indice, W]);
  const y = useSharedValue(0);
  const vaiven = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(p.retraso, withRepeat(withTiming(1, { duration: p.dur, easing: Easing.linear }), -1));
    vaiven.value = withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(-1, { duration: 1100 })), -1, true);
  }, [y, vaiven, p]);
  const estilo = useAnimatedStyle(() => ({
    transform: [
      { translateY: H + 60 - y.value * (H + 160) },
      { translateX: vaiven.value * 14 },
      { rotate: `${vaiven.value * 8}deg` },
    ],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: p.x, top: 0 }, estilo]}>
      <Text style={{ fontSize: p.tam, textShadowColor: color, textShadowRadius: 12 }}>{emoji}</Text>
    </Animated.View>
  );
}
