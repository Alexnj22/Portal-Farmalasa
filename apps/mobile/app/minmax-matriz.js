// La matriz ABC × XYZ de una sala, NATIVA — la de `TabMinMax` del portal
// (`AbcXyzMatrix`): cuántos productos de la sala caen en cada cruce de
// importancia (A·B·C, por venta acumulada) y estabilidad de la demanda (X
// estable, Y moderada, Z errática). Tocar una celda abre la revisión de la
// sala filtrada por esa clase. El conteo es del núcleo (`matrizAbcXyz`).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchAnalisisDeStock } from '@nucleo/data/stockParams';
import { matrizAbcXyz } from '@nucleo/utils/minmaxTabla';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const XYZ = [['X', 'estable'], ['Y', 'moderada'], ['Z', 'errática']];
const ABC = [['A', MARCA.verde], ['B', MARCA.azulClaro], ['C', MARCA.ambar]];

export default function MatrizAbcXyz() {
  const { sala } = useLocalSearchParams();
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    Promise.resolve(fetchAnalisisDeStock({ p_erp_sucursal_id: Number(sala) })).then(({ data, error: e }) => {
      if (e) throw e;
      setM(matrizAbcXyz(data ?? []));
    }).catch((e) => { setError(mensajeAmigable(e)); setM({}); });
  }, [sala]);
  const max = m ? Math.max(1, ...Object.values(m)) : 1;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Matriz ABC·XYZ', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', marginHorizontal: 4 }}>{ERP_NAMES[Number(sala)] ?? ''}</Text>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {!m ? <ActivityIndicator /> : (
          <Vidrio radio={22}>
            <View style={{ padding: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ width: 36 }} />
                {XYZ.map(([x, d]) => (
                  <View key={x} style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{x}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{d}</Text>
                  </View>
                ))}
              </View>
              {ABC.map(([a, color]) => (
                <View key={a} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={{ width: 36, color, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>{a}</Text>
                  {XYZ.map(([x]) => {
                    const n = m[`${a}${x}`] ?? 0;
                    return (
                      <Pressable key={x} disabled={!n} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/minmax-sala', params: { sala: String(sala), abc: a, xyz: x } }); }}
                        style={({ pressed }) => ({ flex: 1, height: 72, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: `${color}${Math.round(20 + (n / max) * 60).toString(16).padStart(2, '0')}`, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                        <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{n}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </Vidrio>
        )}
        <Aviso texto="A·B·C: cuánto pesa el producto en la venta de la sala. X·Y·Z: qué tan pareja es su demanda. Sólo clasifican: no cambian el MIN·MAX." />
      </ScrollView>
    </>
  );
}
