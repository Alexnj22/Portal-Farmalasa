// La tarjeta de un traslado en las listas de la app: de qué sala a qué sala,
// qué va (el conteo grande y el producto), quién lo pidió y hace cuánto. En
// vidrio, como el resto. Los textos salen del núcleo (`piezasDe`,
// `renglonesDe`, `desdeHace`), los mismos del portal.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { piezasDe, renglonesDe } from '@nucleo/utils/trasladoTexto';
import { desdeHace } from '@nucleo/utils/movimientoTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Vidrio from '../Vidrio';
import Avatar from '../Avatar';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

export function Ruta({ desde, hacia, color = MARCA.azulClaro }) {
  return (
    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
      {desde ?? '—'} <Text style={{ color }}>→</Text> {hacia ?? '—'}
    </Text>
  );
}

export function Pildora({ texto, color }) {
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: `${color}26` }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{texto}</Text>
    </View>
  );
}

/**
 * @param fila     la solicitud (`approval_requests`) con su metadata
 * @param persona  quien pidió (del maestro)
 * @param estado   { texto, color } para la píldora
 * @param alerta   true = la edad va en rojo (lleva mucho esperando)
 */
export default function TarjetaTraslado({ fila, persona, estado, alerta = false, desdeCuando, onPress }) {
  const m = fila.metadata ?? {};
  const p = piezasDe(m);
  const renglones = renglonesDe(m);
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}><Ruta desde={m.origen_branch_name} hacia={m.branch_name} /></View>
            {estado ? <Pildora texto={estado.texto} color={estado.color} /> : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{p?.numero ?? '—'}</Text>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }} numberOfLines={2}>
              {p?.varios ? `productos · ${p.unidades} unidades` : `${p?.unidad ?? ''} · ${p?.nombre ?? ''}`}
            </Text>
          </View>

          {p?.varios ? (
            <View style={{ gap: 3 }}>
              {renglones.slice(0, 3).map((r) => (
                <View key={r.idx} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{r.nombre}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{r.cantidad} {r.presentacion}</Text>
                </View>
              ))}
              {renglones.length > 3 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>y {renglones.length - 3} más</Text> : null}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Avatar empleado={persona} tamano={24} />
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{shortEmployeeName(persona)}</Text>
            <Text style={{ color: alerta ? MARCA.rojo : colorSistema.texto2, fontSize: 12, fontWeight: alerta ? '700' : '400' }}>
              {desdeHace(desdeCuando ?? fila.created_at, Date.now())}
            </Text>
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}
