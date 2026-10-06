// Compras, NATIVO — `ComprasView` con sus dos pestañas:
//   · Facturas: las compras del mes con su proveedor, estado («Vigente» o el
//     del documento), ítems y total; tocar una abre su detalle (`compra/[id]`)
//     con cada producto, cantidad, costo, lote y vencimiento. Filtro por
//     proveedor en el menú, y el aviso «N facturas sin proveedor vinculado»
//     que filtra al tocarlo, como el portal.
//   · Productos: el historial de compra de cada producto
//     (`componentes/fiscal/ProductosComprados`).
// Todo el dinero, sólo con `compras_ver_montos`. Vincular un proveedor sigue
// en el portal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPurchaseReceiptsPage, fetchSuppliersBasic, fetchUnlinkedPurchaseReceiptsCount } from '@nucleo/data/compras';
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
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import ProductosComprados from '../componentes/fiscal/ProductosComprados';
import { useAuth } from '@nucleo/context/AuthContext';

const POR_PAGINA = 30;

export default function Compras() {
  // Sin `compras_ver_montos` la lista no lleva dinero (igual que el portal).
  const verMontos = useAuth().hasPermission('compras_ver_montos');
  const [tab, setTab] = useState('facturas');
  const [mes, setMes] = useState(mesSV);
  const [proveedorId, setProveedorId] = useState('todos');
  const [sinProveedor, setSinProveedor] = useState(false);
  const [proveedores, setProveedores] = useState([]);
  const [sinVincular, setSinVincular] = useState(0);
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [datos, setDatos] = useState({ filas: [], total: 0 });
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const pedido = useRef(0);
  const [desde, hasta] = useMemo(() => rangoDelMes(mes), [mes]);

  useEffect(() => { setPagina(0); }, [mes, busqueda, proveedorId, sinProveedor]);
  useEffect(() => {
    fetchSuppliersBasic().then(({ data }) => setProveedores(data || []));
    fetchUnlinkedPurchaseReceiptsCount().then(({ count }) => setSinVincular(count || 0));
  }, []);
  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    const from = pagina * POR_PAGINA;
    const { data, count, error: e } = await fetchPurchaseReceiptsPage({ from, to: from + POR_PAGINA - 1, dateStart: desde, dateEnd: hasta, searchTerm: busqueda || null, sinProveedor, supplierId: proveedorId === 'todos' ? null : proveedorId });
    if (yo !== pedido.current) return;
    setError(e ? mensajeAmigable(e) : null);
    guardarCompras(data);
    setDatos((d) => ({ filas: pagina === 0 ? (data || []) : [...d.filas, ...(data || [])], total: count || 0 }));
    setCargando(false);
  }, [desde, hasta, busqueda, pagina, sinProveedor, proveedorId]);
  useEffect(() => { cargar(); }, [cargar]);

  const totalMes = datos.filas.reduce((s, r) => s + Number(r.total || 0), 0);
  const grupos = tab === 'facturas' ? [{
    id: 'prov', titulo: 'Proveedor', activa: proveedorId, porDefecto: 'todos', onCambiar: (v) => { setProveedorId(v); setSinProveedor(false); },
    opciones: [{ id: 'todos', label: 'Todos' }, ...proveedores.map((p) => ({ id: String(p.id), label: p.nombre }))],
  }] : [];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Compras', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: tab === 'facturas' ? 'Proveedor o número' : 'Código del producto', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setPagina(0); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={tab} onCambiar={setTab} opciones={[{ id: 'facturas', label: 'Facturas' }, { id: 'productos', label: 'Productos' }]} />
        {tab === 'productos' ? <ProductosComprados busqueda={busqueda} verMontos={verMontos} /> : null}
        {tab === 'facturas' ? (<>
        <PasoDeMes mes={mes} onCambiar={setMes} />
        <FiltrosActivos grupos={grupos} />
        {sinVincular > 0 ? (
          <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setSinProveedor((v) => !v); setProveedorId('todos'); }} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={16} tinte="rgba(247,144,9,0.14)">
              <Text style={{ padding: 12, color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>
                {`${sinVincular} factura${sinVincular === 1 ? '' : 's'} sin proveedor vinculado · ${sinProveedor ? 'ver todas' : 'filtrar'}`}
              </Text>
            </Vidrio>
          </Pressable>
        ) : null}
        {!cargando || datos.filas.length ? (
          <FilaDeKpis>
            <Kpi icono="ShoppingCart" rotulo="Compras" valor={datos.total.toLocaleString('es-SV')} color={MARCA.azul} apoyo={sinProveedor ? 'sin proveedor' : 'en el mes'} />
            {verMontos ? <Kpi icono="DollarSign" rotulo="Total" valor={datos.filas.length === datos.total ? formatMoney(totalMes) : '…'} color={MARCA.violeta} apoyo={datos.filas.length === datos.total ? 'del mes' : 'carga todas para sumar'} /> : null}
          </FilaDeKpis>
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
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{proveedor}</Text>
                    {verMontos ? <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{formatMoney(r.total)}</Text> : null}
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[fechaTexto(r.fecha, { day: 'numeric', month: 'short' }), r.erp_purchase_id ? `N.º ${r.erp_purchase_id}` : null, `${items} ítem${items === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {!r.estado || r.estado === 'VIGENTE' ? <Pildora texto="Vigente" color={MARCA.verde} /> : <Pildora texto={r.estado} color={MARCA.rojo} />}
                    {!r.supplier_id ? <Pildora texto="Proveedor sin vincular" color={MARCA.ambar} /> : null}
                  </View>
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        {!cargando && datos.total > datos.filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((p) => p + 1)} /></View> : null}
        {!cargando && !datos.filas.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{busqueda ? 'Ninguna compra con esa búsqueda' : sinProveedor ? 'Ninguna sin proveedor este mes' : 'Sin compras este mes'}</Text>
        ) : null}
        </>) : null}
      </ScrollView>
    </>
  );
}
