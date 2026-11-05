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
import { dolares, fechaLarga } from '../lib/formato';
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
  // Un solo acento en la tarjeta (2026-11-04, «las cards tienen muchos
  // colores… unifica pero que no pierdan la identidad»): el METAL del nivel,
  // que es su identidad — en el recuadro, el ×, la barra y las palomitas. Antes
  // el × y la barra iban en verde. En oscuro, el tono claro del metal (se lee
  // sobre el vidrio oscuro; el del Platino es casi negro); en claro, el medio.
  const tono = t.oscuro ? paleta.acento : paleta.frente[1];
  // Compacto (2026-11-05, «más compacto… que aparezca para motivar que ya
  // subirás de nivel… pero que siempre se pueda interactuar para ver los
  // beneficios»): una fila con el nivel y cuánto falta, y la barra fina. Al
  // tocarla se abren los beneficios. Cuando falta poco (menos del 25 %), la
  // línea lo dice como empujón.
  const casi = sig && avance >= 0.75;
  const linea = apagados
    ? (nivel.desde ? `1 punto por $1 · los niveles empiezan el ${fechaLarga(nivel.desde)}` : '1 punto por $1 · los niveles llegan pronto')
    : sig ? `${casi ? '¡Ya casi! ' : ''}Te faltan ${dolares(sig.falta)} para ${sig.nombre}`
      : 'Nivel más alto. ¡Gracias por tu preferencia!';
  return (
    <Tarjeta estilo={{ gap: 10, paddingVertical: 12 }}>
      <Presionable onPress={alternar} accessibilityRole="button" accessibilityState={{ expanded: abierto }}
        accessibilityLabel={`Tu nivel: ${nivel.nombre}, ${factorTexto(nivel.factor)} por cada dólar. ${linea}. ${abierto ? 'Ocultar' : 'Ver'} beneficios`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, opacity: pressed ? 0.7 : 1 })}>
        <LinearGradient colors={paleta.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Icono sf="crown.fill" respaldo="★" tam={17} color="#FFFFFF" />
        </LinearGradient>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colorSistema.texto }}>
            Nivel {nivel.nombre} <Text style={{ color: tono, fontVariant: ['tabular-nums'] }}>· ×{Number(nivel.factor)}</Text>
          </Text>
          <Text style={{ fontSize: 13, fontWeight: casi ? '700' : '400', color: casi ? colorSistema.texto : colorSistema.texto2 }}>{linea}</Text>
        </View>
        <FlechaDesplegable abierto={abierto} color={colorSistema.texto3} />
      </Presionable>
      {sig ? <BarraAnimada avance={avance} color={tono} fondo={t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'} alto={6} /> : null}

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
            <Icono sf="checkmark" respaldo="✓" tam={10} color={tono} />
            <Text maxFontSizeMultiplier={1.3} style={{ flexShrink: 1, fontSize: 12, fontWeight: '600', color: colorSistema.texto2 }}>{b}</Text>
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
            <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: '800', color: colorSistema.texto }}>En {sig.nombre}</Text>
          </View>
          {beneficiosSig.map((b) => (
            <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 4 }}>
              <Icono sf="sparkles" respaldo="✦" tam={11} color={tono} />
              <Text style={{ flexShrink: 1, fontSize: 13, color: colorSistema.texto2 }}>{b}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Texto nivel={3} estilo={{ fontSize: 12 }}>Tus compras de 12 meses: {dolares(nivel.compra)}</Texto>
      {pie}
      {/* Cerrar también desde ABAJO (2026-11-04, «al abrir los beneficios del
          nivel, que salga abajo cerrar… para que se pueda cerrar desde abajo
          también»): con la lista abierta, el encabezado ya quedó arriba de la
          pantalla. Hace lo mismo que tocar el encabezado. */}
      <BotonDesplegar abierto alTocar={alternar} />
      </Animated.View>
      ) : null}
    </Tarjeta>
  );
}

// «Ver beneficios» / «Ocultar beneficios»: la misma pieza abajo de la tarjeta
// cerrada y al final de la abierta, con su flecha. Ancho completo y 44 pt de
// alto: se acierta con el pulgar sin buscarla.
function BotonDesplegar({ abierto, alTocar }) {
  const t = useTema();
  return (
    <Presionable onPress={alTocar} accessibilityRole="button" accessibilityState={{ expanded: abierto }}
      accessibilityLabel={abierto ? 'Ocultar beneficios' : 'Ver beneficios'}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
        borderRadius: 14, backgroundColor: t.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>
        {abierto ? 'Ocultar beneficios' : 'Ver beneficios'}
      </Text>
      <Icono sf={abierto ? 'chevron.up' : 'chevron.down'} respaldo={abierto ? '⌃' : '⌄'} tam={12} color={t.color.magentaTexto} />
    </Presionable>
  );
}
