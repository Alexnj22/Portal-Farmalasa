// 5 · 4 · 3 · 2 · 1 (Bienestar, 2026-11-03): la técnica de anclaje con los
// cinco sentidos — cinco cosas que ves, cuatro que tocas, tres que oyes, dos
// que hueles y una que saboreas. Saca la atención de la preocupación y la
// trae al lugar donde uno está. Un paso por pantalla, sin apuro.
import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Boton, Pantalla, Tarjeta } from '../componentes/ui';
import { useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { colorSistema } from '../componentes/sistema';
import { suave, useTema } from '../tema/tema';

const PASOS = [
  { n: 5, sf: 'eye.fill', texto: 'cosas que puedes VER', ayuda: 'Míralas una por una: un color, una forma, una luz.' },
  { n: 4, sf: 'hand.raised.fill', texto: 'cosas que puedes TOCAR', ayuda: 'Tu ropa, la mesa, tu cabello. Nota si es suave, frío o áspero.' },
  { n: 3, sf: 'ear.fill', texto: 'sonidos que puedes OÍR', ayuda: 'Lejos y cerca: un carro, el viento, tu respiración.' },
  { n: 2, sf: 'nose.fill', texto: 'olores que puedes SENTIR', ayuda: 'Si no hueles nada, piensa en dos olores que te gusten.' },
  { n: 1, sf: 'mouth.fill', texto: 'sabor que puedes NOTAR', ayuda: 'Lo que tomaste hace poco, o simplemente tu boca ahora.' },
];

export default function Anclaje() {
  const t = useTema();
  const quieta = useSinMovimiento();
  const [paso, setPaso] = useState(0);
  const fin = paso >= PASOS.length;
  const p = PASOS[Math.min(paso, PASOS.length - 1)];
  const colores = [t.acentos.naranja.fuerte, t.color.magenta];
  const siguiente = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPaso((x) => x + 1);
  };
  const animar = quieta ? {} : { entering: FadeIn.duration(350), exiting: FadeOut.duration(150) };

  return (
    <Pantalla conPestanas={false} conBurbuja={false}>
      {/* El avance: cinco puntos. */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }} accessibilityLabel={`Paso ${Math.min(paso + 1, 5)} de 5`}>
        {PASOS.map((x, i) => (
          <View key={x.n} style={{ width: i === paso ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i <= paso ? t.color.magenta : suave(t.color.magenta, 0.2) }} />
        ))}
      </View>

      <Animated.View key={paso} {...animar}>
        <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ borderRadius: 28, padding: 26, gap: 14, minHeight: 300, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
          {fin ? (
            <>
              <Icono sf="heart.fill" respaldo="♥" tam={56} color="#FFFFFF" />
              <Text style={{ fontSize: 28, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' }}>Estás aquí, ahora.</Text>
              <Text style={{ fontSize: 16, lineHeight: 22, color: 'rgba(255,255,255,0.92)', textAlign: 'center' }}>
                Respira hondo una vez más. Puedes volver a hacerlo cuando lo necesites.
              </Text>
            </>
          ) : (
            <>
              <Text style={{ position: 'absolute', right: 14, top: -40, fontSize: 220, fontWeight: '900', color: 'rgba(255,255,255,0.12)' }}>{p.n}</Text>
              <Icono sf={p.sf} respaldo="" tam={52} color="#FFFFFF" />
              <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' }}>
                {p.n} {p.texto.toLowerCase()}
              </Text>
              <Text style={{ fontSize: 16, lineHeight: 22, color: 'rgba(255,255,255,0.92)', textAlign: 'center' }}>{p.ayuda}</Text>
            </>
          )}
        </LinearGradient>
      </Animated.View>

      {fin ? (
        <>
          <Boton alTocar={() => router.back()}>Terminar</Boton>
          <Boton tipo="secundario" alTocar={() => setPaso(0)}>Hacerlo otra vez</Boton>
        </>
      ) : (
        <Boton alTocar={siguiente}>{paso === PASOS.length - 1 ? 'Listo' : 'Siguiente'}</Boton>
      )}

      <Tarjeta>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
          Nómbralas en voz baja o en tu mente. No hay respuestas correctas: lo importante es notar lo que está a tu alrededor.
        </Text>
      </Tarjeta>
    </Pantalla>
  );
}
