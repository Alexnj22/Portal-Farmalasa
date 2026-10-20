// El nivel del programa (2026-10-07): Bronce, Plata, Oro o Platino, según lo
// comprado en los últimos 12 meses. Dice cuántos puntos da cada dólar hoy y
// cuánto falta para el siguiente, con una barra. La regla vive en la base
// (`puntos_niveles`); acá sólo se muestra.
//
// 2026-10-19 (auditoría de niveles):
//   · Lo que da cada nivel ya NO está escrito acá: viene del servidor
//     (`nivel.beneficios`, `nivel.siguiente.beneficios`), armado desde lo que
//     se configura en el portal. Una lista a mano se desincroniza del programa
//     y termina prometiendo algo que nadie da.
//   · «Lo que compraste» y «te faltan» salen del MISMO número (`nivel.compra`,
//     todas las facturas válidas de 12 meses).
//   · Con los niveles APAGADOS se ve Bronce y «los niveles se activan pronto»,
//     sin la escalera ni beneficios de otros niveles: no están en el
//     reglamento vigente. Antes, quien compraba más de $500 leía «Estás en el
//     nivel más alto» estando en Bronce.
import { useState } from 'react';
import { Text, View } from 'react-native';
import Presionable from './Presionable';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Tarjeta, Texto } from './ui';
import { BarraAnimada, FlechaDesplegable } from './animacion';
import { COLORES_NIVEL } from './TarjetaSocio';
import { colorSistema } from './sistema';
import { dolares } from '../lib/formato';
import { useTema } from '../tema/tema';
import { LinearGradient } from 'expo-linear-gradient';
import Icono from './Icono';

/** Lo que da un nivel, tal como lo manda el servidor (vacío si no vino). */
export const beneficiosDeNivel = (n) => (Array.isArray(n?.beneficios) ? n.beneficios.map(beneficioCorto) : []);

const factorTexto = (f) => (Number(f) === 1 ? '1 punto' : `${String(Number(f)).replace('.', '.')} puntos`);

// Los beneficios, CORTOS (2026-10-20, «los textos del desplegable son muy
// largos»): el servidor los manda como frase («Raspable mensual con premios
// en puntos»); en una píldora sobra la mitad. Lo que no se reconoce, tal cual.
const CORTOS = [
  [/^(\d+(?:\.\d+)?) puntos? por cada \$1$/i, (m) => `${m[1]} pt${m[1] === '1' ? '' : 's'} por $1`],
  [/^(\d+) puntos en tu cumplea[ñn]os$/i, (m) => `${m[1]} pts de cumpleaños`],
  [/^Raspable mensual.*$/i, () => 'Raspable mensual'],
  [/^Ves las ofertas un d[ií]a antes$/i, () => 'Ofertas 1 día antes'],
  [/^Ves las ofertas (\d+) d[ií]as antes$/i, (m) => `Ofertas ${m[1]} días antes`],
  [/^Tus reservas te esperan (\d+) horas$/i, (m) => `Reservas por ${m[1]} h`],
];
export function beneficioCorto(b) {
  const t = String(b ?? '').trim();
  for (const [re, f] of CORTOS) { const m = t.match(re); if (m) return f(m); }
  return t;
}

export default function Nivel({ nivel, pie = null }) {
  const t = useTema();
  // Los hooks van ANTES del `return null`: un hook después de un retorno
  // condicional cierra la app cuando el nivel pasa de no estar a estar.
  const [abierto, setAbierto] = useState(false);
  if (!nivel) return null;
  const paleta = COLORES_NIVEL[nivel.clave] ?? COLORES_NIVEL.vip;
  // Niveles apagados hasta el nuevo reglamento: se explica, sin esconder el
  // panel y sin escalera (el servidor ya no manda `siguiente` apagados; esto
  // cubre una versión vieja de la función).
  const apagados = nivel.activos === false;
  const sig = apagados ? null : nivel.siguiente;
  const avance = sig ? Math.min(1, nivel.compra / sig.desde) : 1;
  const beneficios = beneficiosDeNivel(nivel);
  const beneficiosSig = beneficiosDeNivel(sig);
  // Desplegable (2026-10-09, «que no ocupe tanta pantalla»): cerrado se ve el
  // nivel, la barra y cuánto falta; al tocarlo, los beneficios y el detalle.
  const alternar = () => { Haptics.selectionAsync().catch(() => {}); setAbierto((v) => !v); };
  return (
    <Tarjeta estilo={{ gap: 12 }}>
      <Presionable onPress={alternar} accessibilityRole="button" accessibilityState={{ expanded: abierto }}
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
        <FlechaDesplegable abierto={abierto} color={colorSistema.texto3} />
      </Presionable>

      {apagados ? (
        <Texto nivel={2} estilo={{ fontSize: 14 }}>Hoy: 1 punto por cada $1. Los niveles llegan pronto.</Texto>
      ) : sig ? (
        <View style={{ gap: 6 }}>
          <BarraAnimada avance={avance} color={t.color.verde} fondo={t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'} />
          <Texto nivel={2} estilo={{ fontSize: 14 }}>
            Te faltan <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(sig.falta)}</Text> para{' '}
            <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{sig.nombre}</Text>
          </Texto>
        </View>
      ) : (
        <Texto nivel={2} estilo={{ fontSize: 14 }}>Nivel más alto. ¡Gracias por tu preferencia!</Texto>
      )}

      {abierto ? (
      <Animated.View entering={FadeIn.duration(220)} style={{ gap: 12 }}>
      {apagados ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 14, padding: 10, backgroundColor: t.oscuro ? 'rgba(255,214,10,0.12)' : 'rgba(255,204,0,0.14)' }}>
          <Icono sf="clock.fill" respaldo="⏱" tam={13} color={colorSistema.texto2} />
          <Text style={{ flex: 1, fontSize: 13, color: colorSistema.texto2 }}>
            Llegan con el nuevo reglamento. Tu nivel saldrá de tus compras de 12 meses.
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {beneficios.map((b) => (
          <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
            <Icono sf="checkmark" respaldo="✓" tam={10} color={t.color.verdeTexto} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto2 }}>{b}</Text>
          </View>
        ))}
      </View>
      {/* Lo que gana al subir: la razón para llegar al siguiente. */}
      {sig && beneficiosSig.length ? (
        <View style={{ gap: 6, borderRadius: 16, padding: 12, backgroundColor: t.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <LinearGradient colors={(COLORES_NIVEL[sig.clave] ?? paleta).frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }}>
              <Icono sf="arrow.up" respaldo="↑" tam={11} color="#FFFFFF" />
            </LinearGradient>
            <Text style={{ fontSize: 14, fontWeight: '800', color: colorSistema.texto }}>En {sig.nombre}</Text>
          </View>
          {beneficiosSig.map((b) => (
            <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 4 }}>
              <Icono sf="sparkles" respaldo="✦" tam={11} color={t.color.magentaTexto} />
              <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{b}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Texto nivel={3} estilo={{ fontSize: 12 }}>Tus compras de 12 meses: {dolares(nivel.compra)}</Texto>
      {pie}
      </Animated.View>
      ) : (
        <Presionable onPress={alternar} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>
            Ver beneficios
          </Text>
        </Presionable>
      )}
    </Tarjeta>
  );
}
