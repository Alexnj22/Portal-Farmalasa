// El detalle de una compra, NATIVO — lo que en el portal se despliega en la
// fila de `ComprasView`: cada producto con su cantidad, costo unitario y total,
// y su lote y vencimiento; arriba el subtotal, el IVA y el total.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { fetchPurchaseReceiptItems } from '@nucleo/data/compras';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { compraGuardada } from '../../componentes/compras/compras';
import { useAuth } from '@nucleo/context/AuthContext';

export default function Compra() {
  // Los montos son de quien tiene `compras_ver_montos`, como en el portal:
  // sin él se ven los productos, sus cantidades y lotes, nunca el dinero.
  const verMontos = useAuth().hasPermission('compras_ver_montos');
  const { id } = useLocalSearchParams();
  const c = compraGuardada(id);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchPurchaseReceiptItems(Number(id));
    setItems(data || []); setError(e ? mensajeAmigable(e) : null);
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Compra', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {c ? (
          <View style={{ gap: 4, marginHorizontal: 4 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{c.suppliers?.nombre || c.proveedor || 'Sin proveedor'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[fechaTexto(c.fecha, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), c.erp_purchase_id ? `N.º ${c.erp_purchase_id}` : null].filter(Boolean).join(' · ')}</Text>
            {verMontos ? <Text style={{ color: colorSistema.texto, fontSize: 32, fontWeight: '800', marginTop: 4 }}>{formatMoney(c.total)}</Text> : null}
          </View>
        ) : null}
        {c && verMontos ? (
          <Seccion titulo="Totales">
            <Dato primero rotulo="Subtotal" valor={formatMoney(c.subtotal)} />
            <Dato rotulo="IVA" valor={formatMoney(c.iva)} />
            <Dato rotulo="Total" valor={formatMoney(c.total)} fuerte />
          </Seccion>
        ) : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        <Seccion titulo={items ? `Productos · ${items.length}` : 'Productos'}>
          {items == null ? <ActivityIndicator /> : items.length ? items.map((it, i) => (
            <View key={it.linea_num ?? i} style={{ flexDirection: 'row', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{it.descripcion}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                  {[verMontos ? `${formatQty(it.cantidad)} × ${formatMoney(it.precio_unitario)}` : `${formatQty(it.cantidad)} u.`, it.lote && it.lote !== 'GENERICO' ? `lote ${it.lote}` : null, it.erp_product_id ? `cód. ${it.erp_product_id}` : null, it.linea_num != null ? `línea ${it.linea_num}` : null, it.fecha_vencimiento ? `vence ${fechaNumerica(it.fecha_vencimiento)}` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {verMontos ? <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{formatMoney(it.total_linea)}</Text> : null}
            </View>
          )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin productos.</Text>}
        </Seccion>
      </ScrollView>
    </>
  );
}
