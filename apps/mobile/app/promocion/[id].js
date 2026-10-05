// El detalle de una promoción, NATIVO: vigencia y estado, y cada producto con
// cuánto se ha vendido en total y en cada sala (`get_promocion`). Si el
// producto tiene lote, cuánto queda. Lo que se paga se ve en el portal.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { fetchPromocion } from '@nucleo/data/promociones';
import { estadoVisible, fmtLote, fmtUnidades, fmtVigencia, mensajeDeCarga, MOTIVO_CIERRE } from '@nucleo/utils/promocionesUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeVariante } from '../../componentes/colorDeVariante';

export default function Promocion() {
  const { id } = useLocalSearchParams();
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    try { setP(await fetchPromocion(id)); setError(null); } catch (e) { setError(mensajeDeCarga(e, 'No se pudo cargar la promoción.')); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  const e = p ? estadoVisible(p) : null;
  const renglones = Array.isArray(p?.renglones) ? p.renglones : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Promoción', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {!p && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {p ? (
          <>
            <View style={{ gap: 6, marginHorizontal: 4 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 21, fontWeight: '800' }}>{p.nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{fmtVigencia(p.inicio, p.fin)}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}><Pildora texto={e.rotulo} color={colorDeVariante(e.variant)} /></View>
              {p.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{p.nota}</Text> : null}
            </View>
            {renglones.map((r) => {
              const reparto = Array.isArray(r.reparto) ? r.reparto : [];
              return (
                <Seccion key={r.id} titulo={r.laboratorio || 'Producto'}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.producto}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{`${fmtUnidades(r.vendido_base)} vendidas`}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {r.lote_total != null ? <Pildora texto={`Lote ${fmtLote(r.lote_total)} · quedan ${fmtLote(r.queda)}`} color={MARCA.azulClaro} /> : null}
                    {r.estado === 'cerrado' ? <Pildora texto={MOTIVO_CIERRE?.[r.cerrado_motivo] ?? 'Cerrado'} color={colorSistema.texto2} /> : null}
                    {r.fin && r.fin !== p.fin ? <Pildora texto={fmtVigencia(r.inicio, r.fin)} color={colorSistema.texto2} /> : null}
                  </View>
                  {reparto.map((s, i) => (
                    <View key={s.branch_id} style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 7, marginTop: i ? 0 : 2 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>{s.sala}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>
                        {Number(s.asignado_vigente) > 0 ? `${fmtUnidades(s.vendido)} de ${fmtUnidades(s.asignado_vigente)}` : fmtUnidades(s.vendido)}
                      </Text>
                    </View>
                  ))}
                </Seccion>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
