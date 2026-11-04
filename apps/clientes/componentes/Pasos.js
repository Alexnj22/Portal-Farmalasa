// Las dos piezas de número de las hojas de tratamiento (2026-11-04, usuario:
// «el selector de los días… hazlo simple, pero útil. No tan limitado pero
// visualmente correcto»).
//
//   · `Contador`: el valor grande al centro y − / + a los lados, de 44 pt de
//     verdad (antes 32 + `hitSlop`, que se veían chicos). Con `salto`, además
//     −7 / +7 para no tocar treinta veces.
//   · `Atajos`: los valores comunes en una fila de chips que baja de renglón
//     con letra grande. Elegir uno pone el número; el contador sigue libre.
//
// Juntos reemplazan la lista desplegable de 36 filas y las «píldoras + Otro»:
// lo común a un toque, cualquier otro valor a unos pocos, sin cambiar de modo.
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { RADIO } from './ui';
import { useTema } from '../tema/tema';

const toque = () => Haptics.selectionAsync().catch(() => {});

function Paso({ sf, texto, etiqueta, alTocar, apagado }) {
  const t = useTema();
  return (
    <Presionable onPress={() => { if (apagado) return; toque(); alTocar(); }} disabled={!!apagado}
      accessibilityRole="button" accessibilityLabel={etiqueta} accessibilityState={{ disabled: !!apagado }}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        opacity: apagado ? 0.3 : 1, transform: [{ scale: pressed && !apagado ? 0.9 : 1 }],
        backgroundColor: texto ? 'transparent' : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)') })}>
      {texto
        ? <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>{texto}</Text>
        : <Icono sf={sf} respaldo={sf === 'minus' ? '−' : '+'} tam={16} color={colorSistema.texto} />}
    </Presionable>
  );
}

/**
 * valor: el número; texto: cómo se lee («7 días», «1 ½ tabletas»); salto: si
 * va, los botones de ±salto a los extremos.
 */
export function Contador({ valor, texto, detalle, min, max, paso = 1, salto, alCambiar, etiquetaMenos, etiquetaMas }) {
  const mover = (d) => alCambiar(Math.max(min, Math.min(max, Math.round((valor + d) * 100) / 100)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      {salto ? <Paso texto={`−${salto}`} etiqueta={`${salto} menos`} alTocar={() => mover(-salto)} apagado={valor <= min} /> : null}
      <Paso sf="minus" etiqueta={etiquetaMenos ?? 'Menos'} alTocar={() => mover(-paso)} apagado={valor <= min} />
      <View style={{ flex: 1, alignItems: 'center', minWidth: 110 }} accessibilityLiveRegion="polite">
        <Text style={{ fontSize: 24, fontWeight: '800', color: colorSistema.texto, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{texto}</Text>
        {detalle ? <Text style={{ fontSize: 13, color: colorSistema.texto3, textAlign: 'center' }}>{detalle}</Text> : null}
      </View>
      <Paso sf="plus" etiqueta={etiquetaMas ?? 'Más'} alTocar={() => mover(paso)} apagado={valor >= max} />
      {salto ? <Paso texto={`+${salto}`} etiqueta={`${salto} más`} alTocar={() => mover(salto)} apagado={valor >= max} /> : null}
    </View>
  );
}

/** opciones: [{ v, texto, etiqueta? }]; el elegido es el que coincide con `valor`. */
export function Atajos({ opciones, valor, alElegir }) {
  const t = useTema();
  const fondo = t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }} accessibilityRole="radiogroup">
      {opciones.map((o) => {
        const elegida = o.v === valor;
        return (
          <Presionable key={String(o.v)} onPress={() => { toque(); alElegir(o.v); }}
            accessibilityRole="radio" accessibilityState={{ selected: elegida }} accessibilityLabel={o.etiqueta ?? o.texto}
            style={({ pressed }) => ({ minWidth: 48, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              backgroundColor: elegida ? t.color.magenta : fondo, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <Text style={{ fontSize: 15, fontWeight: elegida ? '800' : '600', color: elegida ? '#FFFFFF' : colorSistema.texto }}>{o.texto}</Text>
          </Presionable>
        );
      })}
    </View>
  );
}

/** La tarjeta donde viven: superficie lisa, esquinas del sistema. */
export function Caja({ children, superficie, estilo }) {
  return <View style={[{ backgroundColor: superficie, borderRadius: RADIO.medio, padding: 14, gap: 12 }, estilo]}>{children}</View>;
}
