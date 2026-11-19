// La caja que viene de varios lotes, NATIVO — gemelo de
// `src/views/traslados/VariosLotesDeLaCaja.jsx` (2026-11-16): un lote, su
// vencimiento y cuántas unidades trae, por fila. Cada lote se elige con
// `LoteDeLaCaja`, así que ofrece los ya registrados y frena un número
// registrado con otra fecha. Lo que falta lo dice `faltaEnVariosLotes`
// (núcleo); esta pieza sólo pinta.
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Presionable as Pressable } from '../Tocable';
import LoteDeLaCaja from '../LoteDeLaCaja';
import { FILA_DE_VARIOS_LOTES } from '@nucleo/utils/loteDeCaja';
import { colorSistema } from '../Formulario';
import { Campo } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

function Boton({ texto, color, onPress, accessibilityLabel }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      hitSlop={6} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function VariosLotesDeLaCaja({ erpProductId, producto, total, filas, onChange, onUnSoloLote }) {
  const cambiar = (k, cambio) => onChange(filas.map((f, j) => (j === k ? { ...f, ...cambio } : f)));
  const suma = filas.reduce((n, f) => n + (Number(String(f.unidades).trim()) || 0), 0);
  return (
    <View style={{ gap: 8 }}>
      {filas.map((f, k) => (
        <View key={k} style={{ gap: 6, borderRadius: 12, borderWidth: 1, borderColor: colorSistema.separador, padding: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>{`Lote ${k + 1}`}</Text>
            {filas.length > 2 ? (
              <Boton texto="Quitar" color={MARCA.rojo} accessibilityLabel={`Quitar el lote ${k + 1}`}
                onPress={() => onChange(filas.filter((_, j) => j !== k))} />
            ) : null}
          </View>
          <LoteDeLaCaja erpProductId={erpProductId} producto={producto} valor={f.caja} onChange={(v) => cambiar(k, { caja: v })} />
          <Campo multiline={false} value={f.unidades} placeholder="Unidades de este lote" keyboardType="number-pad"
            accessibilityLabel="Unidades de este lote" onChangeText={(t) => cambiar(k, { unidades: t.replace(/\D/g, '') })} />
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Boton texto="+ Otro lote" color={MARCA.azulClaro} onPress={() => onChange([...filas, FILA_DE_VARIOS_LOTES()])} />
        <Boton texto="Es un solo lote" color={colorSistema.texto2} onPress={onUnSoloLote} />
        <Text style={{ marginLeft: 'auto', color: suma === total ? MARCA.verde : colorSistema.texto2, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {`${suma} de ${total} unidades`}
        </Text>
      </View>
    </View>
  );
}
