// Lo que le debemos a un proveedor, NATIVO — el panel de `CuentasPorPagarView`
// en lectura: cada factura con lo que le queda, su vencimiento y si está
// vencida o en trámite. Pagar se registra en el portal.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { fetchDetalleProveedor } from '@nucleo/data/cuentasPorPagar';
import { dteTypeLabel } from '@nucleo/utils/dteTypes';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';

export default function ProveedorPorPagar() {
  const { nit, nombre } = useLocalSearchParams();
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    const { filas, error: e } = await fetchDetalleProveedor(String(nit));
    setDocs(filas); setError(e?.message ?? null);
  }, [nit]);
  useEffect(() => { cargar(); }, [cargar]);
  const lista = docs || [];
  const saldo = lista.reduce((s, d) => s + Number(d.saldo || 0), 0);
  const vencido = lista.filter((d) => Number(d.dias_vencido) > 0).reduce((s, d) => s + Number(d.saldo || 0), 0);
  const tramite = lista.reduce((s, d) => s + Number(d.en_tramite || 0), 0);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: String(nombre || 'Proveedor'), headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {docs == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <>
            <Seccion titulo="Resumen">
              <Dato primero rotulo="Debemos" valor={formatMoney(saldo)} fuerte />
              <Dato rotulo="Vencido" valor={formatMoney(vencido)} />
              <Dato rotulo="En trámite" valor={formatMoney(tramite)} />
              <Dato rotulo="NIT" valor={String(nit)} />
            </Seccion>
            <Seccion titulo={`Facturas pendientes · ${lista.length}`}>
              {lista.length ? lista.map((d, i) => {
                const venc = Number(d.dias_vencido) > 0;
                return (
                  <View key={d.document_id ?? i} style={{ gap: 3, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`${dteTypeLabel(d.tipo_dte)} · ${fechaNumerica(d.fecha_emision)}`}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{formatMoney(d.saldo)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {d.vence ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`vence ${fechaNumerica(d.vence)}`}</Text> : <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>sin plazo</Text>}
                      {venc ? <Pildora texto={`Vencida hace ${d.dias_vencido} días`} color={MARCA.ambar} /> : null}
                      {Number(d.en_tramite) > 0 ? <Pildora texto={`En trámite ${formatMoney(d.en_tramite)}`} color={MARCA.azulClaro} /> : null}
                    </View>
                  </View>
                );
              }) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No le debemos nada.</Text>}
            </Seccion>
          </>
        )}
      </ScrollView>
    </>
  );
}
