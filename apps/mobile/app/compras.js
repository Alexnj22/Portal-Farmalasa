// Compras, NATIVO — `ComprasView` con sus dos pestañas:
//   · Facturas: las compras del mes con su proveedor, estado («Vigente» o el
//     del documento), ítems y total; tocar una abre su detalle (`compra/[id]`)
//     con cada producto, cantidad, costo, lote y vencimiento. Filtro por
//     proveedor en el menú, y el aviso «N facturas sin proveedor vinculado»
//     que filtra al tocarlo, como el portal. Mes por mes o un rango libre
//     desde/hasta, como el selector de fechas del portal.
//   · Productos: el historial de compra de cada producto
//     (`componentes/fiscal/ProductosComprados`).
// Filtro «cómo entró» (desde el portal / a mano) y la marca «cargada desde el
// portal» con quién y cuándo, como el portal (`fetchIdsDesdePortal`,
// `fetchCargadasDesdePortal`).
// Todo el dinero, sólo con `compras_ver_montos`. El portal no vincula el
// proveedor desde Compras: se vincula en la ficha del proveedor
// («Registrado como»), que en la app es `proveedor/[id]`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../componentes/Tocable';
import Refrescar from '../componentes/Refrescar';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchCargadasDesdePortal, fetchIdsDesdePortal, fetchPurchaseReceiptsPage, fetchSuppliersBasic, fetchUnlinkedPurchaseReceiptsCount } from '@nucleo/data/compras';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import Avatar from '../componentes/Avatar';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Cargando, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import PasoDeMes from '../componentes/PasoDeMes';
import Fecha from '../componentes/formulario/Fecha';
import Tocable from '../componentes/Tocable';
import { MARCA } from '../componentes/inicio/marca';
import { guardarCompras } from '../componentes/compras/compras';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import ProductosComprados from '../componentes/fiscal/ProductosComprados';
import { useAuth } from '@nucleo/context/AuthContext';

const POR_PAGINA = 30;
// «Cómo entró», con los mismos valores que `ORIGENES` del portal.
const ORIGENES = [
  { id: 'todas', label: 'Todas' },
  { id: 'portal', label: 'Desde el portal' },
  { id: 'mano', label: 'A mano' },
];

export default function Compras() {
  // Sin `compras_ver_montos` la lista no lleva dinero (igual que el portal).
  const { hasPermission } = useAuth();
  const verMontos = hasPermission('compras_ver_montos');
  // Cada pestaña con su permiso `compras_tab_*`, como `ComprasView` del portal.
  const pestanas = [{ id: 'facturas', label: 'Facturas' }, { id: 'productos', label: 'Productos' }]
    .filter((t) => hasPermission(`compras_tab_${t.id}`));
  const [tabElegida, setTab] = useState(null);
  const tab = pestanas.some((t) => t.id === tabElegida) ? tabElegida : (pestanas[0]?.id ?? null);
  const [mes, setMes] = useState(mesSV);
  const [proveedorId, setProveedorId] = useState('todos');
  const [sinProveedor, setSinProveedor] = useState(false);
  const [proveedores, setProveedores] = useState([]);
  const [sinVincular, setSinVincular] = useState(0);
  const [origen, setOrigen] = useState('todas');
  const [delPortal, setDelPortal] = useState({});
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [datos, setDatos] = useState({ filas: [], total: 0 });
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const pedido = useRef(0);
  // Mes a mes, o un rango libre desde/hasta como el `LiquidDatePicker` del
  // portal. El rango arranca en el mes que se estaba mirando.
  const [libre, setLibre] = useState(null);
  const [desde, hasta] = useMemo(() => (libre ? [libre.desde, libre.hasta] : rangoDelMes(mes)), [mes, libre]);
  const ponerLibre = (cambio) => setLibre((r) => {
    const n = { ...(r || { desde, hasta }), ...cambio };
    return n.desde > n.hasta ? ('desde' in cambio ? { ...n, hasta: n.desde } : { ...n, desde: n.hasta }) : n;
  });

  useEffect(() => { setPagina(0); }, [desde, hasta, busqueda, proveedorId, sinProveedor, origen]);
  useEffect(() => {
    fetchSuppliersBasic().then(({ data }) => setProveedores(data || []));
    fetchUnlinkedPurchaseReceiptsCount().then(({ count }) => setSinVincular(count || 0));
  }, []);
  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    const from = pagina * POR_PAGINA;
    const filtroOrigen = origen === 'todas' ? '' : origen;
    let idsPortal = null;
    let eOrigen = null;
    if (filtroOrigen) {
      const r = await fetchIdsDesdePortal();
      if (yo !== pedido.current) return;
      eOrigen = r.error;
      idsPortal = r.ids;
    }
    const { data, count, error: e } = await fetchPurchaseReceiptsPage({ from, to: from + POR_PAGINA - 1, dateStart: desde, dateEnd: hasta, searchTerm: busqueda || null, sinProveedor, supplierId: proveedorId === 'todos' ? null : proveedorId, origen: filtroOrigen, idsPortal });
    if (yo !== pedido.current) return;
    // Si no se pudo saber qué entró desde el portal, el filtro no es confiable: se dice.
    setError(e ? mensajeAmigable(e) : eOrigen ? 'No se pudo saber cuáles entraron desde el portal. Intenta de nuevo.' : null);
    guardarCompras(data);
    setDatos((d) => ({ filas: pagina === 0 ? (data || []) : [...d.filas, ...(data || [])], total: count || 0 }));
    setCargando(false);
    const { porCompra, error: eCarga } = await fetchCargadasDesdePortal((data || []).map((r) => r.erp_purchase_id));
    if (yo !== pedido.current) return;
    if (eCarga) console.warn('[compras] no se pudo leer qué entró desde el portal:', eCarga.message);
    setDelPortal((d) => (pagina === 0 ? porCompra : { ...d, ...porCompra }));
  }, [desde, hasta, busqueda, pagina, sinProveedor, proveedorId, origen]);
  useEffect(() => { cargar(); }, [cargar]);

  const totalMes = datos.filas.reduce((s, r) => s + Number(r.total || 0), 0);
  const grupos = tab === 'facturas' ? [{
    id: 'prov', titulo: 'Proveedor', activa: proveedorId, porDefecto: 'todos', onCambiar: (v) => { setProveedorId(v); setSinProveedor(false); },
    opciones: [{ id: 'todos', label: 'Todos' }, ...proveedores.map((p) => ({ id: String(p.id), label: p.nombre }))],
  }, {
    id: 'origen', titulo: 'Cómo entró', activa: origen, porDefecto: 'todas', onCambiar: setOrigen, opciones: ORIGENES,
  }] : [];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_FIJA, title: 'Compras',
        headerSearchBarOptions: {
          placeholder: tab === 'facturas' ? 'Proveedor o número' : 'Código del producto', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      {/* Fijo arriba al desplazar (2026-11-11). */}
      {pestanas.length > 1 ? (
        <FijoArriba>
          <Segmentos activa={tab} onCambiar={setTab} opciones={pestanas} />
        </FijoArriba>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); setPagina(0); await cargar(); setRecargando(false); }} />}>
        {!tab ? <Text style={{ marginHorizontal: 20, color: colorSistema.texto2, fontSize: 15 }}>No tienes acceso a ninguna pestaña de Compras.</Text> : null}
        {tab === 'productos' ? <ProductosComprados busqueda={busqueda} verMontos={verMontos} /> : null}
        {tab === 'facturas' ? (<>
        {libre ? (
          <View style={{ marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Desde</Text>
            <Fecha valor={libre.desde} onCambiar={(v) => ponerLibre({ desde: v })} />
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>hasta</Text>
            <Fecha valor={libre.hasta} onCambiar={(v) => ponerLibre({ hasta: v })} />
          </View>
        ) : <PasoDeMes mes={mes} onCambiar={setMes} />}
        <Tocable onPress={() => setLibre((r) => (r ? null : { desde, hasta }))} hitSlop={8} style={{ alignSelf: 'center', minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{libre ? 'Volver a mes por mes' : 'Elegir un rango de fechas'}</Text>
        </Tocable>
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
            <Kpi icono="ShoppingCart" rotulo="Compras" valor={datos.total.toLocaleString('es-SV')} color={MARCA.azul} apoyo={sinProveedor ? 'sin proveedor' : libre ? 'en el rango' : 'en el mes'} />
            {verMontos ? <Kpi icono="DollarSign" rotulo="Total" valor={datos.filas.length === datos.total ? formatMoney(totalMes) : '…'} color={MARCA.violeta} apoyo={datos.filas.length === datos.total ? (libre ? 'del rango' : 'del mes') : 'carga todas para sumar'} /> : null}
          </FilaDeKpis>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {datos.filas.map((r) => {
          const items = Array.isArray(r.purchase_receipt_items) ? r.purchase_receipt_items.length : 0;
          const proveedor = r.suppliers?.nombre || r.proveedor || 'Sin proveedor';
          const carga = delPortal[r.erp_purchase_id];
          return (
            <Pressable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/compra/[id]', params: { id: String(r.id) } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={20} interactivo>
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
                    {carga ? <Pildora texto="Desde el portal" color={MARCA.azulClaro} /> : null}
                    {carga?.estado === 'sin_verificar' ? <Pildora texto="Sin comprobar" color={MARCA.ambar} /> : null}
                  </View>
                  {carga ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Cargada desde el portal por</Text>
                      <Avatar empleado={{ id: carga.employee_id, name: carga.empleado }} tamano={20} />
                      <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{shortEmployeeName(carga.empleado)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`· ${fechaHora12(carga.cargada_el, { day: '2-digit', month: '2-digit', year: 'numeric' })}`}</Text>
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {cargando ? <Cargando /> : null}
        {!cargando && datos.total > datos.filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((p) => p + 1)} /></View> : null}
        {!cargando && !datos.filas.length && !error ? (
          <Vacio>{busqueda ? 'Ninguna compra con esa búsqueda' : sinProveedor ? `Ninguna sin proveedor ${libre ? 'en el rango' : 'este mes'}` : `Sin compras ${libre ? 'en el rango' : 'este mes'}`}</Vacio>
        ) : null}
        </>) : null}
      </ScrollView>
    </>
  );
}
