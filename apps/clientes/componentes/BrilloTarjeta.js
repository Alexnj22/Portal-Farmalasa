// En la web no hay Skia: la luz es una franja de degradado que cruza la
// tarjeta con el barrido (la versión completa está en BrilloTarjeta.native.js).
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

export default function BrilloTarjeta({ x, barrido }) {
  const estilo = useAnimatedStyle(() => ({
    transform: [{ translateX: -200 + barrido.value * 700 + x.value * 60 }, { rotate: '25deg' }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -80, left: 0, width: 90, height: 420 }, estilo]}>
      <LinearGradient colors={['transparent', 'rgba(255,255,255,0.45)', 'transparent']}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}
