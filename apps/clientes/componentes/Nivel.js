// El nivel del programa (2026-10-07): Cliente VIP, Plata, Oro o Platino, según
// lo comprado en los últimos 12 meses. Dice cuántos puntos da cada dólar hoy y
// cuánto falta para el siguiente, con una barra. La regla vive en la base
// (`puntos_niveles`); acá sólo se muestra.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Tarjeta, Texto } from './ui';
import { BarraAnimada } from './animacion';
import { COLORES_NIVEL } from './TarjetaSocio';
import { colorSistema } from './sistema';
import { dolares } from '../lib/formato';
import { useTema } from '../tema/tema';
import { LinearGradient } from 'expo-linear-gradient';
import Icono from './Icono';

// Los del Reglamento v2 (cláusula 4): lo que se ve en el modo de prueba.
export const BENEFICIOS = {
  bronce: ['1 punto por cada $1', 'Ofertas exclusivas', '50 puntos en tu cumpleaños'],
  vip: ['1 punto por cada $1', 'Ofertas exclusivas', '50 puntos en tu cumpleaños'],
  plata: ['1.25 puntos por cada $1', '75 puntos en tu cumpleaños'],
  oro: ['1.5 puntos por cada $1', '100 puntos en tu cumpleaños', 'Raspable mensual'],
  platino: ['2 puntos por cada $1', '100 puntos en tu cumpleaños', 'Raspable mensual Platino'],
};

const factorTexto = (f) => (Number(f) === 1 ? '1 punto' : `${String(Number(f)).replace('.', '.')} puntos`);

export default function Nivel({ nivel, pie = null }) {
  const t = useTema();
  if (!nivel) return null;
  const paleta = COLORES_NIVEL[nivel.clave] ?? COLORES_NIVEL.vip;
  const sig = nivel.siguiente;
  const avance = sig ? Math.min(1, nivel.compra / sig.desde) : 1;
  // Niveles apagados hasta el nuevo reglamento: se explica, sin esconder el panel.
  const apagados = nivel.activos === false;
  const yaAlcanza = apagados && nivel.proyectado && nivel.proyectado.clave !== nivel.clave ? nivel.proyectado : null;
  // Desplegable (2026-10-09, «que no ocupe tanta pantalla»): cerrado se ve el
  // nivel, la barra y cuánto falta; al tocarlo, los beneficios y el detalle.
  const [abierto, setAbierto] = useState(false);
  const alternar = () => { Haptics.selectionAsync().catch(() => {}); setAbierto((v) => !v); };
  return (
    <Tarjeta estilo={{ gap: 12 }}>
      <Pressable onPress={alternar} accessibilityRole="button" accessibilityState={{ expanded: abierto }}
        accessibilityLabel={`Tu nivel: ${nivel.nombre}. ${abierto ? 'Ocultar' : 'Ver'} beneficios`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}>
        <LinearGradient colors={paleta.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Icono sf="crown.fill" respaldo="★" tam={19} color="#FFFFFF" />
        </LinearGradient>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>Tu nivel</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>{nivel.nombre}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: t.color.verdeTexto, fontVariant: ['tabular-nums'] }}>×{Number(nivel.factor)}</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3 }}>{factorTexto(nivel.factor)} / $1</Text>
        </View>
        <View style={{ transform: [{ rotate: abierto ? '180deg' : '0deg' }] }}>
          <Icono sf="chevron.down" respaldo="⌄" tam={14} color={colorSistema.texto3} />
        </View>
      </Pressable>

      {sig && !(yaAlcanza && sig.falta === 0) ? (
        <View style={{ gap: 6 }}>
          <BarraAnimada avance={avance} color={t.color.verde} fondo={t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'} />
          <Texto nivel={2} estilo={{ fontSize: 14 }}>
            Te faltan <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(sig.falta)}</Text> en compras para{' '}
            <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{sig.nombre}</Text> ({factorTexto(sig.factor)} por $1).
          </Texto>
        </View>
      ) : (
        <Texto nivel={2} estilo={{ fontSize: 14 }}>Estás en el nivel más alto. ¡Gracias por tu preferencia!</Texto>
      )}

      {abierto ? (
      <Animated.View entering={FadeIn.duration(220)} style={{ gap: 12 }}>
      {apagados ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 14, padding: 10, backgroundColor: t.oscuro ? 'rgba(255,214,10,0.12)' : 'rgba(255,204,0,0.14)' }}>
          <Icono sf="clock.fill" respaldo="⏱" tam={13} color={colorSistema.texto2} />
          <Text style={{ flex: 1, fontSize: 13, color: colorSistema.texto2 }}>
            {yaAlcanza ? <Text style={{ fontWeight: '800', color: colorSistema.texto }}>Con tus compras ya alcanzas {yaAlcanza.nombre}. </Text> : null}
            Los niveles se activan con el nuevo reglamento; mientras tanto ganas 1 punto por cada $1.
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(BENEFICIOS[nivel.clave] ?? []).map((b) => (
          <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
            <Icono sf="checkmark" respaldo="✓" tam={10} color={t.color.verdeTexto} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto2 }}>{b}</Text>
          </View>
        ))}
      </View>
      {/* Lo que gana al subir: la razón para llegar al siguiente. */}
      {sig && BENEFICIOS[sig.clave] ? (
        <View style={{ gap: 6, borderRadius: 16, padding: 12, backgroundColor: t.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <LinearGradient colors={(COLORES_NIVEL[sig.clave] ?? paleta).frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }}>
              <Icono sf="arrow.up" respaldo="↑" tam={11} color="#FFFFFF" />
            </LinearGradient>
            <Text style={{ fontSize: 14, fontWeight: '800', color: colorSistema.texto }}>Al llegar a {sig.nombre} ganas</Text>
          </View>
          {BENEFICIOS[sig.clave].map((b) => (
            <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 4 }}>
              <Icono sf="sparkles" respaldo="✦" tam={11} color={t.color.magentaTexto} />
              <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{b}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Texto nivel={3} estilo={{ fontSize: 12 }}>Según lo que compraste en los últimos 12 meses: {dolares(nivel.compra)}.</Texto>
      {pie}
      </Animated.View>
      ) : (
        <Pressable onPress={alternar} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>
            {apagados ? 'Ver beneficios y cuándo se activan' : 'Ver beneficios'}
          </Text>
        </Pressable>
      )}
    </Tarjeta>
  );
}
