// El aviso de arriba cuando no hay internet (2026-10-08): dice que lo que se ve
// es lo guardado y de cuándo. Se va solo apenas una llamada vuelve a entrar.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import Icono from './Icono';
import { haceCuanto, useConexion } from '../lib/sinConexion';

export default function AvisoSinConexion() {
  const { sinConexion, desde } = useConexion();
  const ins = useSafeAreaInsets();
  const [, setTic] = useState(0);
  // El «hace X min» se actualiza solo mientras sigue sin red.
  useEffect(() => {
    if (!sinConexion) return undefined;
    const t = setInterval(() => setTic((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [sinConexion]);
  if (!sinConexion) return null;
  return (
    <Animated.View entering={FadeInUp.duration(250)} exiting={FadeOutUp.duration(200)} pointerEvents="none"
      style={{ position: 'absolute', top: ins.top + 4, left: 0, right: 0, alignItems: 'center', zIndex: 1000 }}>
      <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(28,28,30,0.92)',
        borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '92%' }}>
        <Icono sf="wifi.slash" respaldo="⚠︎" tam={14} color="#FFD60A" />
        <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }} numberOfLines={2}>
          Sin conexión{desde ? ` · lo que ves es de ${haceCuanto(desde)}` : ''}
        </Text>
      </View>
    </Animated.View>
  );
}
