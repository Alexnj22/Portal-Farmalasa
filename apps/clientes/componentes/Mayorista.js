// El rango del Cliente Mayorista (2026-10-08). Lo ve el cliente aprobado
// (`rangoReal`) y la cuenta de prueba (`rangoDePrueba`). Las reglas son las de
// las «Condiciones del Cliente Mayorista»: el rango sale del promedio de compra
// de los tres meses anteriores, se recalcula el primer día del mes, y da puntos
// por cada US$1.00 a precio de mayoreo. El precio (Mayoreo o Mayoreo Plus; el
// «Elite» desapareció el 2026-10-08) es independiente del rango.
// (2026-10-19) Los puntos del rango los acredita el motor sólo con
// `puntos_config.mayoreo_puntos_activo` encendido.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Presionable from './Presionable';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Tarjeta, Texto } from './ui';
import { BarraAnimada, FlechaDesplegable } from './animacion';
import { COLORES_NIVEL } from './TarjetaSocio';
import { colorSistema } from './sistema';
import Icono from './Icono';
import { dolares } from '../lib/formato';
import { useTema } from '../tema/tema';

// Condiciones del Cliente Mayorista (vigentes 15-oct-2026), cláusulas 3 a 5.
export const RANGOS = [
  { clave: 'jade', nombre: 'Jade', desde: 0, puntos: 0.25, cumpleanos: 50, raspable: null },
  { clave: 'zafiro', nombre: 'Zafiro', desde: 300, puntos: 0.5, cumpleanos: 75, raspable: null },
  { clave: 'rubi', nombre: 'Rubí', desde: 800, puntos: 0.75, cumpleanos: 100, raspable: 'Oro' },
  { clave: 'diamante', nombre: 'Diamante', desde: 2000, puntos: 1, cumpleanos: 100, raspable: 'Platino' },
];
export const PRECIOS = { mayoreo: 'Mayoreo', mayoreo_plus: 'Mayoreo Plus' };
const PRECIO_MUESTRA = { jade: 'mayoreo', zafiro: 'mayoreo', rubi: 'mayoreo_plus', diamante: 'mayoreo_plus' };

// El cumpleaños y el raspable de cada rango (2026-10-19) los da el programa de
// puntos y se configuran en el portal (`resumen.programa.mayoreo`), detrás de
// su propio interruptor. Apagado, el mayorista recibe lo de cualquier cliente
// (el cumpleaños del nivel de entrada y ningún raspable), así que la tarjeta no
// promete lo que todavía no se da. Sin `programa` (una versión vieja de la
// función) queda lo escrito arriba, que es lo de las Condiciones.
function conProgramaMayoreo(r, programa, { prueba = false } = {}) {
  const conf = programa?.mayoreo;
  if (!conf) return r;
  const fila = (conf.rangos ?? []).find((x) => x.clave === r.clave);
  if (!conf.activos && !prueba) {
    return { ...r, raspable: null, cumpleanos: Number(programa.niveles?.[0]?.cumpleanos ?? r.cumpleanos) };
  }
  return { ...r, cumpleanos: fila ? fila.cumpleanos : r.cumpleanos, raspable: fila?.raspable ? fila.nombre : null };
}

/** El rango para mostrar: de prueba (con una compra a mitad de camino) o el real del cliente. */
export function rangoDePrueba(clave, programa = null) {
  const i = Math.max(0, RANGOS.findIndex((r) => r.clave === clave));
  const r = conProgramaMayoreo(RANGOS[i], programa, { prueba: true }); const s = RANGOS[i + 1];
  const compra = s ? Math.round(Math.max(150, r.desde + (s.desde - r.desde) * 0.6)) : 2400;
  return { ...r, precio: PRECIOS[PRECIO_MUESTRA[r.clave]], precioClave: PRECIO_MUESTRA[r.clave], compra, siguiente: s ? { ...s, falta: s.desde - compra } : null };
}
export function rangoReal(m, programa = null) {
  if (!m || m.estado !== 'aprobado') return null;
  const i = Math.max(0, RANGOS.findIndex((r) => r.clave === (m.rango ?? 'jade')));
  const r = conProgramaMayoreo(RANGOS[i], programa); const s = RANGOS[i + 1]; const compra = Number(m.prom_3m ?? 0);
  // precioClave y aprobadoDesde: para las pantallas de SubisteDeNivel (subir a Plus, bienvenida).
  return { ...r, precio: PRECIOS[m.precio] ?? 'Mayoreo', precioClave: PRECIOS[m.precio] ? m.precio : 'mayoreo', aprobadoDesde: m.aprobado_desde ?? null,
    compra, retiro: m.retiro_programado ?? null,
    // Bajada de Mayoreo Plus a Mayoreo avisada (2026-10-19, Condiciones §6).
    bajaEl: m.precio_programado_el ?? null,
    siguiente: s ? { ...s, falta: Math.max(0, s.desde - compra) } : null };
}

export default function Mayorista({ rango, pie = null }) {
  const t = useTema();
  // Desplegable, igual que el panel de nivel (2026-10-09): cerrado se ve el
  // rango, la barra y cuánto falta; al tocarlo, los beneficios, la escalera y
  // las condiciones. El estado va antes del `return null` (regla de hooks).
  const [abierto, setAbierto] = useState(false);
  if (!rango) return null;
  const paleta = COLORES_NIVEL[rango.clave];
  const sig = rango.siguiente;
  const alternar = () => { Haptics.selectionAsync().catch(() => {}); setAbierto((v) => !v); };
  return (
    <Tarjeta estilo={{ gap: 12 }}>
      <Presionable onPress={alternar} accessibilityRole="button" accessibilityState={{ expanded: abierto }}
        accessibilityLabel={`Cliente de mayoreo: ${rango.nombre}. ${abierto ? 'Ocultar' : 'Ver'} beneficios`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}>
        <LinearGradient colors={paleta.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] }}>
          <View style={{ transform: [{ rotate: '-45deg' }] }}><Icono sf="diamond.fill" respaldo="◆" tam={18} color="#FFFFFF" /></View>
        </LinearGradient>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>Cliente de mayoreo</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>{rango.nombre}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 15, fontWeight: '900', color: colorSistema.texto }}>{rango.precio}</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3 }}>{rango.puntos} pts / $1 de mayoreo</Text>
        </View>
        <FlechaDesplegable abierto={abierto} color={colorSistema.texto3} />
      </Presionable>
      {sig ? (
        <View style={{ gap: 6 }}>
          <BarraAnimada avance={Math.min(1, rango.compra / sig.desde)} color={paleta.frente[1]} fondo={t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'} />
          <Texto nivel={2} estilo={{ fontSize: 14 }}>
            Te faltan <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(sig.falta)}</Text> al mes para{' '}
            <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{sig.nombre}</Text>
          </Texto>
        </View>
      ) : (
        <Texto nivel={2} estilo={{ fontSize: 14 }}>Rango más alto. ¡Gracias por tu preferencia!</Texto>
      )}
      {abierto ? (
      <Animated.View entering={FadeIn.duration(220)} style={{ gap: 12 }}>
      {/* Lo que da su rango (Condiciones, cláusula 5). */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[`${rango.puntos} pts por $1 en mayoreo`, '1 pt por $1 en Preferente',
          `${rango.cumpleanos} pts de cumpleaños`, ...(rango.raspable ? [`Raspable ${rango.raspable}`] : []),
          `Precio ${rango.precio}`].map((b) => (
          <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
            <Icono sf="checkmark" respaldo="✓" tam={10} color={t.color.verdeTexto} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto2 }}>{b}</Text>
          </View>
        ))}
      </View>
      {rango.retiro ? <Texto nivel={2} estilo={{ fontSize: 13 }}>Tu precio de mayoreo termina el {rango.retiro}</Texto>
        : rango.bajaEl ? <Texto nivel={2} estilo={{ fontSize: 13 }}>Desde el {rango.bajaEl}: precio Mayoreo</Texto> : null}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {RANGOS.map((r) => {
          const p = COLORES_NIVEL[r.clave];
          const es = r.clave === rango.clave;
          return (
            <View key={r.clave} style={{ flex: 1, alignItems: 'center', gap: 4, opacity: es ? 1 : 0.5 }}>
              <LinearGradient colors={p.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ width: es ? 26 : 20, height: es ? 26 : 20, borderRadius: 5, transform: [{ rotate: '45deg' }], borderWidth: es ? 2 : 0, borderColor: '#FFFFFF' }} />
              <Text style={{ fontSize: 11, fontWeight: es ? '800' : '600', color: colorSistema.texto2 }}>{r.nombre}</Text>
              <Text style={{ fontSize: 10, color: colorSistema.texto3 }}>{r.desde ? `desde ${dolares(r.desde).replace('.00', '')}` : 'al ingresar'}</Text>
            </View>
          );
        })}
      </View>
      <Texto nivel={3} estilo={{ fontSize: 12 }}>
        Tu rango sale del promedio de compra de los últimos 3 meses y se recalcula cada día 1. Promedio actual: {dolares(rango.compra)} al mes.
      </Texto>
      {pie}
      </Animated.View>
      ) : (
        <Presionable onPress={alternar} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>Ver beneficios</Text>
        </Presionable>
      )}
    </Tarjeta>
  );
}

// La tarjeta de Equipo (2026-10-08): por política, el personal compra a precio
// Mayoreo Plus. Lo comprado a precio de personal no acumula puntos (Reglamento,
// cláusula 3.3: sólo acumula lo comprado a precio Público o Preferente).
// Los beneficios del personal (2026-10-08): van DENTRO del panel de su nivel
// o de su rango —una sola tarjeta, un solo panel—; sólo si no hay panel de
// nivel (niveles apagados) se muestran solos.
export function BeneficiosEquipo({ mayoreo = null }) {
  const t = useTema();
  return (
    <View style={{ gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colorSistema.separador }}>
      <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto }}>Team Farmacia Salud</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {['Mayoreo Plus', 'Crédito 30 días', 'Todas las salas'].map((b) => (
          <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
            <Icono sf="checkmark" respaldo="✓" tam={10} color={t.color.verdeTexto} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto2 }}>{b}</Text>
          </View>
        ))}
      </View>
      <Texto nivel={3} estilo={{ fontSize: 12 }}>
        {mayoreo
          ? `Lo de mayoreo suma según tu rango ${mayoreo.nombre}; lo demás, 1 punto por $1.`
          : 'A precio de personal no sumas puntos; a Preferente o más, sí.'}
      </Texto>
    </View>
  );
}

export function Equipo() {
  return <Tarjeta estilo={{ gap: 0 }}><BeneficiosEquipo /></Tarjeta>;
}
