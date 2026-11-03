// Burbujas (Bienestar, 2026-11-03): el plástico de burbujas, con el «pop» en
// la mano —un golpe del motor del teléfono por cada una—. Al reventarlas
// todas sale una hoja nueva. Cuántas se reventaron en total queda en el
// teléfono, por el gusto de verlo crecer.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Pantalla } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { entero } from '../lib/formato';
import { suave, useTema } from '../tema/tema';

const COLUMNAS = 5;
const FILAS = 7;
const N = COLUMNAS * FILAS;
const CLAVE = 'puntos_salud_burbujas_total';

const Burbuja = memo(function Burbuja({ tam, reventada, color, alReventar, indice }) {
  const s = useSharedValue(1);
  useEffect(() => {
    if (reventada) s.value = withSequence(withTiming(0.78, { duration: 70 }), withSpring(0.9, { damping: 9, stiffness: 260 }));
    else s.value = withSpring(1, { damping: 12, stiffness: 180 });
  }, [reventada, s]);
  const estilo = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable onPressIn={reventada ? undefined : () => alReventar(indice)} disabled={reventada}
      accessibilityRole="button" accessibilityLabel={reventada ? 'Burbuja reventada' : 'Burbuja'}
      style={{ width: tam, height: tam, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ width: tam - 8, height: tam - 8, borderRadius: tam, overflow: 'hidden',
        backgroundColor: reventada ? suave(color, 0.12) : suave(color, 0.5),
        borderWidth: 1.5, borderColor: reventada ? suave(color, 0.25) : suave(color, 0.85) }, estilo]}>
        {/* El brillo que la hace ver inflada. */}
        {!reventada ? <View style={{ position: 'absolute', top: tam * 0.14, left: tam * 0.18, width: tam * 0.26, height: tam * 0.16, borderRadius: tam, backgroundColor: 'rgba(255,255,255,0.65)', transform: [{ rotate: '-30deg' }] }} /> : null}
      </Animated.View>
    </Pressable>
  );
});

export default function Burbujas() {
  const t = useTema();
  const { width } = useWindowDimensions();
  const [hoja, setHoja] = useState(() => Array(N).fill(false));
  const [total, setTotal] = useState(0);
  const [hojas, setHojas] = useState(0);
  const guardar = useRef(null);
  useEffect(() => {
    SecureStore.getItemAsync(CLAVE).then((v) => { const n = Number(v); if (Number.isFinite(n)) setTotal((x) => x + n); }).catch(() => {});
    return () => clearTimeout(guardar.current);
  }, []);
  const tam = Math.floor((Math.min(width, 560) - 32 - 16) / COLUMNAS);
  const colores = [t.color.magenta, t.acentos.violeta.fuerte, t.acentos.azul.fuerte, t.acentos.verde.fuerte];

  // Los efectos van fuera de los `set…(x => …)`: React puede llamar dos veces
  // a esas funciones, y la hoja saldría contada doble.
  const alReventar = useCallback((i) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
    setHoja((h) => {
      if (h[i]) return h;
      const nueva = h.slice(); nueva[i] = true;
      return nueva;
    });
    setTotal((x) => x + 1);
  }, []);
  // Hoja completa: un momento para verla y sale una nueva.
  const completa = hoja.every(Boolean);
  useEffect(() => {
    if (!completa) return undefined;
    const id = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setHojas((x) => x + 1);
      setHoja(Array(N).fill(false));
    }, 700);
    return () => clearTimeout(id);
  }, [completa]);
  // El total se guarda cuando se deja de reventar un rato.
  useEffect(() => {
    if (!total) return;
    clearTimeout(guardar.current);
    guardar.current = setTimeout(() => SecureStore.setItemAsync(CLAVE, String(total)).catch(() => {}), 800);
  }, [total]);

  const quedan = hoja.filter((x) => !x).length;
  return (
    <Pantalla conPestanas={false} conBurbuja={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 4 }}>
        <Text style={{ fontSize: 15, color: colorSistema.texto2 }}>{quedan ? `Quedan ${quedan}` : '¡Hoja completa!'}</Text>
        <Text style={{ fontSize: 15, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>
          {entero(total)} reventadas{hojas ? ` · ${hojas} hoja${hojas === 1 ? '' : 's'}` : ''}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', padding: 8, borderRadius: 26,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)' }}>
        {hoja.map((r, i) => (
          <Burbuja key={`${hojas}-${i}`} indice={i} tam={tam} reventada={r} alReventar={alReventar}
            color={colores[Math.floor(i / COLUMNAS) % colores.length]} />
        ))}
      </View>
      <Text style={{ textAlign: 'center', fontSize: 14, color: colorSistema.texto3 }}>Revienta una a la vez y respira entre cada una.</Text>
    </Pantalla>
  );
}
