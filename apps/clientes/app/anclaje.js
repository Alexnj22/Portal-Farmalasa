// 5 · 4 · 3 · 2 · 1 (Bienestar, 2026-11-03; rehecho el mismo día: «no vibran,
// no tienen sonido… que se vean modernos»). La técnica de anclaje con los
// cinco sentidos: cinco cosas que ves, cuatro que tocas, tres que oyes, dos
// que hueles y una que saboreas.
//
// Ahora se CUENTA: por cada cosa que uno nota, toca el círculo. Cada toque es
// una nota más aguda de una escala que nunca suena mal, un golpecito del
// teléfono y una luz que se enciende. Al completar el sentido suena el acierto
// y pasa solo al siguiente: no hay que leer ni apretar «siguiente», se puede
// hacer mirando alrededor, que es justamente el ejercicio.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Tocable, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, PanelVidrio, textoAyuda } from '../componentes/juegos/Escena';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';

const PASOS = [
  { n: 5, sf: 'eye.fill', titulo: 'cosas que puedes VER', ayuda: 'Un color, una forma, una luz. Míralas una por una.', colores: ['#FF9A62', '#FF5E7E'] },
  { n: 4, sf: 'hand.raised.fill', titulo: 'cosas que puedes TOCAR', ayuda: 'Tu ropa, la mesa, tu cabello. ¿Es suave, frío, áspero?', colores: ['#FFC062', '#FF7A45'] },
  { n: 3, sf: 'ear.fill', titulo: 'sonidos que puedes OÍR', ayuda: 'Lejos y cerca: un carro, el viento, tu respiración.', colores: ['#FF7EB3', '#C04BD8'] },
  { n: 2, sf: 'nose.fill', titulo: 'olores que puedes SENTIR', ayuda: 'Si no hueles nada, piensa en dos olores que te gusten.', colores: ['#B48CFF', '#6E5CE8'] },
  { n: 1, sf: 'mouth.fill', titulo: 'sabor que puedes NOTAR', ayuda: 'Lo que tomaste hace poco, o tu boca ahora mismo.', colores: ['#7FD4FF', '#4F7BFF'] },
];
const SONIDOS = ['toque-1', 'toque-2', 'toque-3', 'toque-4', 'toque-5', 'par', 'campana', 'gota'];

function BotonContar({ paso, alTocar, quieta }) {
  const s = useSharedValue(1);
  const estilo = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const tocar = () => {
    if (!quieta) s.value = withSequence(withTiming(0.92, { duration: 70 }), withSpring(1, { damping: 7, stiffness: 320 }));
    alTocar();
  };
  return (
    <Tocable etiqueta={`Ya noté una. ${paso.titulo}`} alTocar={tocar}>
      <Animated.View style={[{ alignSelf: 'center', width: 196, height: 196, borderRadius: 98, padding: 10, backgroundColor: 'rgba(255,255,255,0.16)' }, estilo]}>
        <LinearGradient colors={paso.colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ flex: 1, borderRadius: 90, alignItems: 'center', justifyContent: 'center', gap: 4,
            shadowColor: paso.colores[1], shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } }}>
          <Icono sf={paso.sf} respaldo="" tam={58} color={BLANCO} />
          <Text style={{ fontSize: 14, fontWeight: '800', color: BLANCO }}>Toca al notar una</Text>
        </LinearGradient>
      </Animated.View>
    </Tocable>
  );
}

export default function Anclaje() {
  const quieta = useSinMovimiento();
  const [paso, setPaso] = useState(0);
  const [cuenta, setCuenta] = useState(0);
  const pasar = useRef(null);
  const fin = paso >= PASOS.length;
  const p = PASOS[Math.min(paso, PASOS.length - 1)];
  useEffect(() => { precargar(SONIDOS); return () => { clearTimeout(pasar.current); callar(SONIDOS); }; }, []);

  const contar = () => {
    if (fin || cuenta >= p.n || pasar.current) return;
    const c = cuenta + 1;
    setCuenta(c);
    // La nota sube con cada cosa notada: 5 toques son la escala completa.
    sonar(`toque-${Math.min(5, c + (5 - p.n))}`, { volumen: 0.85 });
    tacto.toque();
    if (c === p.n) {
      pasar.current = setTimeout(() => {
        pasar.current = null;
        const ultimo = paso === PASOS.length - 1;
        if (ultimo) { sonar('campana', { volumen: 0.8 }); tacto.exito(); } else { sonar('par', { volumen: 0.7 }); tacto.exito(); }
        setPaso((x) => x + 1); setCuenta(0);
      }, 650);
    }
  };
  const otraVez = () => { sonar('gota', { volumen: 0.5 }); setPaso(0); setCuenta(0); };
  const animar = quieta ? {} : { entering: FadeIn.duration(380), exiting: FadeOut.duration(160) };

  return (
    <Escena colores={ESCENAS.anclaje}>
      <ControlesSensaciones izquierda={
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', height: 44 }} accessibilityLabel={`Sentido ${Math.min(paso + 1, 5)} de 5`}>
          {PASOS.map((x, i) => (
            <View key={x.n} style={{ width: i === paso ? 26 : 9, height: 9, borderRadius: 5, backgroundColor: i < paso || fin ? BLANCO : i === paso ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)' }} />
          ))}
        </View>
      } />

      {fin ? (
        <Animated.View {...animar} style={{ alignItems: 'center', gap: 14, paddingVertical: 24 }}>
          <Animated.View entering={quieta ? undefined : ZoomIn.springify()}>
            <View style={{ width: 132, height: 132, borderRadius: 66, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
              <Icono sf="heart.fill" respaldo="♥" tam={62} color={BLANCO} />
            </View>
          </Animated.View>
          <Text style={{ fontSize: 30, fontWeight: '800', color: BLANCO, textAlign: 'center' }}>Estás aquí, ahora.</Text>
          <Text style={{ fontSize: 16, lineHeight: 23, color: BLANCO_2, textAlign: 'center', paddingHorizontal: 12 }}>
            Notaste 15 cosas a tu alrededor. Respira hondo una vez más: puedes volver a hacerlo cuando lo necesites.
          </Text>
        </Animated.View>
      ) : (
        <Animated.View key={paso} {...animar} style={{ gap: 18 }}>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 96, lineHeight: 104, fontWeight: '900', color: BLANCO }}>{p.n}</Text>
            <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '800', color: BLANCO, textAlign: 'center' }}>{p.titulo.toLowerCase()}</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: BLANCO_2, textAlign: 'center', paddingHorizontal: 16 }}>{p.ayuda}</Text>
          </View>
          <BotonContar paso={p} alTocar={contar} quieta={quieta} />
          {/* Una luz por cada cosa: se encienden al tocar. */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }} accessibilityLabel={`${cuenta} de ${p.n}`}>
            {Array.from({ length: p.n }, (_, i) => (
              <View key={i} style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                {i < cuenta ? <Animated.View entering={quieta ? undefined : ZoomIn.springify()} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: BLANCO, shadowColor: BLANCO, shadowOpacity: 0.9, shadowRadius: 8 }} /> : null}
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      {fin ? (
        <View style={{ gap: 10 }}>
          <BotonJuego sf="checkmark" alTocar={() => router.back()}>Terminar</BotonJuego>
          <BotonJuego secundario sf="arrow.counterclockwise" alTocar={otraVez}>Hacerlo otra vez</BotonJuego>
        </View>
      ) : null}

      <PanelVidrio>
        <Text style={textoAyuda}>
          Nómbralas en voz baja o en tu mente. No hay respuestas correctas: lo importante es notar lo que está a tu alrededor.
        </Text>
      </PanelVidrio>
    </Escena>
  );
}
