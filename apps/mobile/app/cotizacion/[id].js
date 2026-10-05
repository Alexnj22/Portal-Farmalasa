// El detalle de una cotización, NATIVO: el cliente, los productos con su
// presentación, cantidad, precio y subtotal, y los totales —base, IVA,
// retención y total— con la misma cuenta del portal (`totalesDeCotizacion`).
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { fetchCotizacionItems } from '@nucleo/data/cotizaciones';
import { totalesDeCotizacion } from '@nucleo/utils/cotizacion';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { cotizacionGuardada } from '../../componentes/cotizaciones/cache';

export default function Cotizacion() {
  const { id } = useLocalSearchParams();
  const c = cotizacionGuardada(id);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchCotizacionItems(id);
    setItems(data || []); setError(e ? mensajeAmigable(e) : null);
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  const t = items ? totalesDeCotizacion(items, c?.applies_retention) : null;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: c?.numero || 'Cotización', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {c ? (
          <View style={{ gap: 5, marginHorizontal: 4 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{c.customer_name || 'Sin cliente'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[c.numero, fechaTexto(c.fecha, { day: 'numeric', month: 'long', year: 'numeric' }), c.payment_type].filter(Boolean).join(' · ')}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pildora texto={c.document_type || 'COF'} color={c.document_type === 'CCF' ? MARCA.violeta : colorSistema.texto2} />
              {c.status === 'ANULADA' ? <Pildora texto="Anulada" color={MARCA.rojo} /> : null}
            </View>
          </View>
        ) : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        <Seccion titulo={items ? `Productos · ${items.length}` : 'Productos'}>
          {items == null ? <ActivityIndicator /> : items.map((it, i) => (
            <View key={it.id ?? i} style={{ flexDirection: 'row', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{it.product_nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[it.presentacion_desc, `${formatQty(it.cantidad, { decimalesMax: 3 })} × ${formatMoney(it.precio_unitario)}`].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{formatMoney(it.subtotal)}</Text>
            </View>
          ))}
        </Seccion>
        {t ? (
          <Seccion titulo="Totales">
            <Dato primero rotulo="Base" valor={formatMoney(t.base)} />
            <Dato rotulo="IVA 13%" valor={formatMoney(t.iva)} />
            {t.retention ? <Dato rotulo="Retención 1%" valor={`−${formatMoney(t.retention)}`} /> : null}
            <Dato rotulo="Total" valor={formatMoney(t.total)} fuerte />
          </Seccion>
        ) : null}
        {c?.notes ? <Seccion titulo="Notas"><Text style={{ color: colorSistema.texto, fontSize: 15 }}>{c.notes}</Text></Seccion> : null}
      </ScrollView>
    </>
  );
}
