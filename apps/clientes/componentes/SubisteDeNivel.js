// «¡Subiste a Oro!» (2026-10-07): la primera vez que la app ve un nivel más
// alto que el último que mostró, una pantalla completa con los colores y el
// acabado del nivel, confeti y lo que gana. El último nivel visto se guarda en
// el teléfono; bajar de nivel no celebra nada (y se anota en silencio).
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORES_NIVEL } from './TarjetaSocio';
import EfectoNivel from './EfectoNivel';
import { BENEFICIOS } from './Nivel';
import { Confeti } from './animacion';
import Icono from './Icono';

const CLAVE = 'puntos_salud_ultimo_nivel';
const ORDEN = { vip: 0, plata: 1, oro: 2, platino: 3 };

export default function SubisteDeNivel({ nivel }) {
  const [mostrar, setMostrar] = useState(null);
  useEffect(() => {
    if (!nivel?.clave) return;
    let vivo = true;
    SecureStore.getItemAsync(CLAVE).catch(() => null).then((ultimo) => {
      if (!vivo) return;
      if (ultimo && (ORDEN[nivel.clave] ?? 0) > (ORDEN[ultimo] ?? 0)) setMostrar(nivel);
      if (ultimo !== nivel.clave) SecureStore.setItemAsync(CLAVE, nivel.clave).catch(() => {});
    });
    return () => { vivo = false; };
  }, [nivel?.clave]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mostrar) return null;
  return <Celebracion nivel={mostrar} alCerrar={() => setMostrar(null)} />;
}

function Celebracion({ nivel, alCerrar }) {
  const ins = useSafeAreaInsets();
  const paleta = COLORES_NIVEL[nivel.clave] ?? COLORES_NIVEL.vip;
  const corona = useSharedValue(0);
  const texto = useSharedValue(0);
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    corona.value = withSequence(withSpring(1.15, { damping: 10, stiffness: 120 }), withSpring(1, { damping: 14 }));
    texto.value = withDelay(350, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [corona, texto]);
  const eCorona = useAnimatedStyle(() => ({ transform: [{ scale: corona.value }, { rotate: `${(1 - Math.min(1, corona.value)) * -20}deg` }] }));
  const eTexto = useAnimatedStyle(() => ({ opacity: texto.value, transform: [{ translateY: (1 - texto.value) * 20 }] }));
  const colores = nivel.clave === 'oro' ? ['#FFD45E', '#FFF6D5', '#E5AE34', '#FFFFFF']
    : nivel.clave === 'platino' ? ['#7DF9FF', '#FF6EC7', '#B4FF7D', '#FFFFFF'] : ['#FFFFFF', '#C3CAD4', '#8EC30F', '#E5E9EF'];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={alCerrar} statusBarTranslucent>
      <LinearGradient colors={paleta.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
        <EfectoNivel nivel={nivel.clave} activa x={null} />
        {/* Un velo oscuro para que el texto blanco se lea sobre plata y oro. */}
        <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.45)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18, paddingTop: ins.top + 20 }}>
          <Animated.View style={[{ width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' }, eCorona]}>
            <Icono sf="crown.fill" respaldo="👑" tam={56} color="#FFFFFF" />
          </Animated.View>
          <Animated.View style={[{ alignItems: 'center', gap: 10 }, eTexto]}>
            <Text style={{ color: paleta.acento ?? '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 3, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 8 }}>¡SUBISTE DE NIVEL!</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 44, fontWeight: '900', letterSpacing: -1, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 12 }}>{nivel.nombre}</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 16, textAlign: 'center', maxWidth: 300, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 }}>
              Gracias por tu preferencia. Desde ahora ganas más con cada compra:
            </Text>
            <View style={{ gap: 8, marginTop: 6, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: 16 }}>
              {(BENEFICIOS[nivel.clave] ?? []).map((b) => (
                <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Icono sf="checkmark.seal.fill" respaldo="✓" tam={16} color={paleta.acento ?? '#FFFFFF'} />
                  <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>{b}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        </View>
        <Pressable onPress={alCerrar} accessibilityRole="button"
          style={({ pressed }) => ({ marginHorizontal: 24, marginBottom: ins.bottom + 20, minHeight: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#FFFFFF', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <Text style={{ color: '#1A1320', fontSize: 17, fontWeight: '900' }}>¡Genial!</Text>
        </Pressable>
        <Confeti colores={colores} alTerminar={() => {}} />
      </LinearGradient>
    </Modal>
  );
}
