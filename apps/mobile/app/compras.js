// Compras, NATIVO — qué compró Bodega y a qué costo (`ComprasView` ›
// Facturas): las compras registradas del mes, con su proveedor, ítems y total.
// Tocar una abre su detalle (`compra/[id]`) con cada producto, cantidad,
// costo, lote y vencimiento. Busca por proveedor o número.
//
// El resumen por producto y vincular proveedores siguen en el portal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPurchaseReceiptsPage } from '@nucleo/data/compras';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import PasoDeMes from '../componentes/PasoDeMes';
import { MARCA } from '../componentes/inicio/marca';
import { guardarCompras } from '../componentes/compras/compras';

const POR_PAGINA = 30;

export default function Compras() {
  const [mes, setMes] = useState(mesSV);
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [datos, setDatos] = useState({ filas: [], total: 0 });
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const pedido = useRef(0);
  const [desde, hasta] = useMemo(() => rangoDelMes(mes), [mes]);

  useEffect(() => { setPagina(0); }, [mes, busqueda]);
  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    const from = pagina * POR_PAGINA;
    const { data, count, error: e } = await fetchPurchaseReceiptsPage({ from, to: from + POR_PAGINA - 1, dateStart: desde, dateEnd: hasta, searchTerm: busqueda || null });
    if (yo !== pedido.current) return;
    setError(e ? mensajeAmigable(e) : null);
    guardarCompras(data);
    setDatos((d) => ({ filas: pagina === 0 ? (data || []) : [...d.filas, ...(data || [])], total: count || 0 }));
    setCargando(false);
  }, [desde, hasta, busqueda, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  const totalMes = datos.filas.reduce((s, r) => s + Number(r.total || 0), 0);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Compras', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Proveedor o número', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setPagina(0); await cargar(); setRecargando(false); }} />}>
        <PasoDeMes mes={mes} onCambiar={setMes} />
        {!cargando || datos.filas.length ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
            {`${datos.total.toLocaleString('es-SV')} compra${datos.total === 1 ? '' : 's'}${datos.filas.length === datos.total && datos.total ? ` · ${formatMoney(totalMes)}` : ''}`}
          </Text>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {datos.filas.map((r) => {
          const items = Array.isArray(r.purchase_receipt_items) ? r.purchase_receipt_items.length : 0;
          const proveedor = r.suppliers?.nombre || r.proveedor || 'Sin proveedor';
          return (
            <Pressable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/compra/[id]', params: { id: String(r.id) } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={18} interactivo>
                <View style={{ padding: 12, gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{proveedor}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{formatMoney(r.total)}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[fechaTexto(r.fecha, { day: 'numeric', month: 'short' }), r.erp_purchase_id ? `N.º ${r.erp_purchase_id}` : null, `${items} ítem${items === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                  </Text>
                  {!r.supplier_id || r.estado ? (
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {r.estado ? <Pildora texto={r.estado} color={colorSistema.texto2} /> : null}
                      {!r.supplier_id ? <Pildora texto="Proveedor sin vincular" color={MARCA.ambar} /> : null}
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        {!cargando && datos.total > datos.filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((p) => p + 1)} /></View> : null}
        {!cargando && !datos.filas.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{busqueda ? 'Ninguna compra con esa búsqueda' : 'Sin compras este mes'}</Text>
        ) : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Resumen por producto (portal)" borde color={colorSistema.texto2}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/compras?tab=productos', nombre: 'Compras' } })} />
        </View>
      </ScrollView>
    </>
  );
}
