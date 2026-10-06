// Piezas de las pantallas de Personas (Monitor, Personal, Auditoría de tiempos,
// Horarios, Vacaciones): contadores que filtran, las marcas como fichas, la
// píldora de color del cargo y el paso de período con flechas del sistema.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { getRoleTheme } from '@nucleo/utils/scheduleHelpers';
import { ROTULO_MARCA, TIPOS_DE_ENTRADA, TIPOS_DE_SALIDA } from '@nucleo/utils/auditoriaDeTiempos';
import { hora12 } from '@nucleo/utils/hora';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';

// Las flechas no están en el catálogo del menú (`tema/iconos.js`): se piden acá.
const FLECHA_ATRAS = Icon.select({ ios: 'chevron.left', android: require('@expo/material-symbols/chevron_left.xml') });
const FLECHA_ADELANTE = Icon.select({ ios: 'chevron.right', android: require('@expo/material-symbols/chevron_right.xml') });

/**
 * Una rejilla de contadores (de 2 o 3 por fila) que filtran al tocarlos: el
 * tablero de números del portal, a tamaño de dedo. `activo` resalta el elegido.
 */
export function Contadores({ items, activo, onElegir, columnas = 3 }) {
  const filas = [];
  for (let i = 0; i < items.length; i += columnas) filas.push(items.slice(i, i + columnas));
  return (
    <View style={{ gap: 10, marginHorizontal: 16 }}>
      {filas.map((fila, f) => (
        <View key={f} style={{ flexDirection: 'row', gap: 10 }}>
          {fila.map((it) => {
            const on = activo === it.id;
            return (
              <Pressable key={it.id} style={{ flex: 1 }} disabled={!onElegir}
                onPress={() => { Haptics.selectionAsync().catch(() => {}); onElegir?.(on ? null : it.id); }}>
                {({ pressed }) => (
                  <Vidrio radio={18} interactivo={!!onElegir} tinte={on ? `${it.color}40` : undefined} style={{ transform: [{ scale: pressed ? 0.96 : 1 }] }}>
                    <View style={{ paddingVertical: 10, paddingHorizontal: 10, gap: 2, minHeight: 74 }}>
                      <Text style={{ color: it.color, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{it.valor}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{it.rotulo}</Text>
                    </View>
                  </Vidrio>
                )}
              </Pressable>
            );
          })}
          {fila.length < columnas ? Array.from({ length: columnas - fila.length }).map((_, k) => <View key={`v${k}`} style={{ flex: 1 }} />) : null}
        </View>
      ))}
    </View>
  );
}

/** La píldora del cargo con el color de su jerarquía (`getRoleTheme`, núcleo). */
export function PildoraDeCargo({ cargo }) {
  if (!cargo) return null;
  const color = colorDeVariante(getRoleTheme(cargo).variante);
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: `${color}26` }}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{cargo}</Text>
    </View>
  );
}

/** Las últimas marcas como fichas (la más reciente resaltada). */
export function Marcas({ marcas, max = 3 }) {
  const ultimas = (marcas || []).slice(-max).reverse();
  if (!ultimas.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {ultimas.map((p, i) => {
        const color = TIPOS_DE_ENTRADA.has(p.type) || String(p.type).startsWith('IN') ? MARCA.verde
          : TIPOS_DE_SALIDA.has(p.type) ? MARCA.rojo : MARCA.ambar;
        return (
          <View key={`${p.timestamp}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
            backgroundColor: i === 0 ? `${color}2A` : 'rgba(127,127,127,0.16)' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
            <Text style={{ color: i === 0 ? colorSistema.texto : colorSistema.texto2, fontSize: 11, fontWeight: '700' }}>
              {`${ROTULO_MARCA[p.type] ?? p.type} ${hora12(p.timestamp)}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Flechas ‹ › del sistema alrededor de un rótulo (semana, día, quincena). */
export function PasoDePeriodo({ titulo, apoyo, onAtras, onAdelante, puedeAdelante = true, onTocar }) {
  const Flecha = ({ nombre, onPress, activo = true }) => (
    <Pressable onPress={() => { if (!activo) return; Haptics.selectionAsync().catch(() => {}); onPress(); }} hitSlop={10}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: activo ? 1 : 0.3 }}>
      <Host matchContents><Icon name={nombre} size={18} color={MARCA.azulClaro} /></Host>
    </Pressable>
  );
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4 }}>
          <Flecha nombre={FLECHA_ATRAS} onPress={onAtras} />
          <Pressable style={{ flex: 1, alignItems: 'center' }} onPress={onTocar} disabled={!onTocar}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{titulo}</Text>
            {apoyo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{apoyo}</Text> : null}
          </Pressable>
          <Flecha nombre={FLECHA_ADELANTE} onPress={onAdelante} activo={puedeAdelante} />
        </View>
      </Vidrio>
    </View>
  );
}

/** Una barra de avance contra una meta (horas contra 44, saldo de días…). */
export function BarraContra({ valor, meta, color = MARCA.azulClaro, alto = 6 }) {
  const pct = meta > 0 ? Math.max(0, Math.min(1, valor / meta)) : 0;
  return (
    <View style={{ height: alto, borderRadius: alto / 2, backgroundColor: 'rgba(127,127,127,0.2)', overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: alto, borderRadius: alto / 2, backgroundColor: color }} />
    </View>
  );
}

/** Encabezado de sección en mayúsculas pequeñas, el de toda la app. */
export function Encabezado({ children }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>{children}</Text>;
}
