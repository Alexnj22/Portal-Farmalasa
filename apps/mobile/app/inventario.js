// Inventario, NATIVO — la vista del portal (`TabInventario.jsx`): lo que hay en
// una sala, producto por producto, con el lote, las unidades y lo que vence
// primero. Arriba, las mismas cuatro cifras (productos, vencidos, por vencer en
// seis meses e inversión), y las tarjetas de vencidos y por vencer filtran.
//
// Todo lo cuenta el servidor (`inventory_grouped`, de a 25) y la aritmética de
// unidades y vencimientos sale del núcleo (`inventarioDeSala`), así que el
// teléfono y el portal dicen el mismo número. Arranca en la sala de quien la
// abre; la sala, la categoría y el orden van en el menú de la barra. Tocar un
// producto abre su ficha: cuánto hay en cada sala y en qué lotes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  fetchAllVencidosInventory, fetchExpiredInventoryCount, fetchInventarioAgrupado,
  fetchInventarioInversion, fetchInventarioProximosAVencer, fetchProductCategories,
} from '@nucleo/data/inventarioTab';
import { buscarIdsDeProducto } from '@nucleo/data/busquedaProductos';
import { loteAMostrar, unidadesVencidasPorProducto, vencimientoDe } from '@nucleo/utils/inventarioDeSala';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const POR_PAGINA = 25;
// El color de cada franja de vencimiento; «lejos» no se pinta.
const FRANJA = { vencido: MARCA.rojo, pronto: MARCA.ambar, trimestre: MARCA.ambar, semestre: MARCA.violeta };
const fechaCorta = (f) => fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: '2-digit' });

function Tarjeta({ g, conSala, vencidas }) {
  const unidades = Number(g.total_unidades) || 0;
  const venc = vencimientoDe(g.earliest_venc);
  const lote = loteAMostrar(g);
  const pres = g.presentaciones || [];
  const abrir = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/producto/[id]', params: { id: String(g.erp_product_id), nombre: g.descripcion } });
  };
  return (
    <Pressable onPress={abrir} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{g.descripcion || '—'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                {[conSala ? ERP_NAMES[g.erp_sucursal_id] : null, g.laboratorio, lote !== '—' ? `Lote ${lote}` : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: unidades ? (venc?.vencido ? MARCA.rojo : colorSistema.texto) : colorSistema.texto2, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {unidades.toLocaleString('es-SV')}
              </Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{unidades === 1 ? 'unidad' : 'unidades'}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {venc && FRANJA[venc.franja] ? (
              <Pildora color={FRANJA[venc.franja]}
                texto={venc.vencido ? `Venció ${fechaCorta(g.earliest_venc)}` : venc.franja === 'pronto' ? (venc.dias === 0 ? 'Vence hoy' : `Vence en ${venc.dias} d`) : `Vence ${fechaCorta(g.earliest_venc)}`} />
            ) : null}
            {vencidas ? <Pildora color={MARCA.rojo} texto={`${vencidas.toLocaleString('es-SV')} en vencidos`} /> : null}
            {g.es_antibiotico ? <Pildora color={MARCA.violeta} texto="Bajo Receta" /> : null}
            {pres.slice(0, 3).map((p) => <Pildora key={p} color={colorSistema.texto2} texto={p} />)}
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Inventario() {
  const { user } = useAuth();
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [sala, setSala] = useState(miErp == null ? 'todas' : String(miErp));
  const [vista, setVista] = useState('todo');
  const [categoria, setCategoria] = useState('todas');
  const [orden, setOrden] = useState('laboratorio');
  const [areaVencidos, setAreaVencidos] = useState('no');
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({ filas: [], total: 0, parecidos: false });
  const [cifras, setCifras] = useState(null);
  const [vencidasPorProducto, setVencidas] = useState({});
  const [categorias, setCategorias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState(null);
  const pedido = useRef(0);

  const erp = sala === 'todas' ? null : Number(sala);
  const esBodega = erp === ERP_BODEGA;
  const enArea = esBodega && areaVencidos === 'si';
  const cat = categoria === 'todas' ? null : categoria;
  const q = busqueda.trim() || null;

  useEffect(() => {
    fetchProductCategories().then(({ data }) => setCategorias((data || []).map((r) => r.nombre))).catch(() => {});
  }, []);
  useEffect(() => {
    let vivo = true;
    fetchAllVencidosInventory(erp).then((d) => { if (vivo) setVencidas(unidadesVencidasPorProducto(d)); }).catch(() => {});
    return () => { vivo = false; };
  }, [erp]);
  useEffect(() => { setPagina(1); }, [erp, vista, cat, orden, enArea, q]);

  // Las cuatro cifras no dependen de la página ni de la vista.
  const cargarCifras = useCallback(async () => {
    const base = { p_erp_id: erp, p_lab_id: null, p_categoria: cat, p_search: q };
    const [prox, inv, venc] = await Promise.all([
      fetchInventarioProximosAVencer(base), fetchInventarioInversion(base), fetchExpiredInventoryCount(erp, hoySV()),
    ]);
    setCifras({ proximos: Number(prox.data) || 0, inversion: Number(inv.data) || 0, vencidos: venc.count ?? 0 });
  }, [erp, cat, q]);
  useEffect(() => { cargarCifras().catch(() => setCifras(null)); }, [cargarCifras]);

  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    try {
      const [{ data, error: e }, parecidos] = await Promise.all([
        fetchInventarioAgrupado({
          p_erp_id: erp, p_vencidos: vista === 'vencidos', p_proximos: vista === 'proximos', p_area_vencidos: enArea,
          p_lab_id: null, p_categoria: cat, p_search: q, p_sort: orden, p_sort_dir: orden === 'unidades' ? 'desc' : 'asc',
          p_limit: POR_PAGINA, p_offset: (pagina - 1) * POR_PAGINA,
        }),
        q ? buscarIdsDeProducto(q, { limite: 1, soloActivos: false }) : { aproximado: false },
      ]);
      if (yo !== pedido.current) return;   // llegó tarde: ya se pidió otra cosa
      if (e) throw e;
      const filas = data || [];
      setError(null);
      setDatos((d) => ({
        filas: pagina === 1 ? filas : [...d.filas, ...filas],
        total: filas.length ? Number(filas[0].total) : (pagina === 1 ? 0 : d.total),
        parecidos: !!parecidos?.aproximado && filas.length > 0,
      }));
    } catch {
      if (yo === pedido.current) setError('No se pudo cargar el inventario.');
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [erp, vista, enArea, cat, q, orden, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  const recargar = async () => {
    setRecargando(true);
    await Promise.all([cargar(), cargarCifras().catch(() => {})]);
    setRecargando(false);
  };

  const grupos = [
    { id: 'sala', titulo: 'Sala', activa: sala, porDefecto: miErp == null ? 'todas' : String(miErp), onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas las salas' }, ...ERP_ORDEN.map((id) => ({ id: String(id), label: ERP_NAMES[id] }))] },
    ...(esBodega ? [{ id: 'area', titulo: 'Ubicación', activa: areaVencidos, porDefecto: 'no', onCambiar: setAreaVencidos,
      opciones: [{ id: 'no', label: 'Toda la bodega' }, { id: 'si', label: 'Sólo área de vencidos' }] }] : []),
    { id: 'categoria', titulo: 'Categoría', activa: categoria, porDefecto: 'todas', onCambiar: setCategoria,
      opciones: [{ id: 'todas', label: 'Todas' }, ...categorias.map((c) => ({ id: c, label: c }))] },
    { id: 'orden', titulo: 'Ordenar por', activa: orden, porDefecto: 'laboratorio', onCambiar: setOrden,
      opciones: [{ id: 'laboratorio', label: 'Laboratorio' }, { id: 'descripcion', label: 'Producto' }, { id: 'unidades', label: 'Más unidades' }] },
  ];
  const quedan = datos.total > datos.filas.length;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Inventario', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Producto, laboratorio o código', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={recargar} />}>
        <FiltrosActivos grupos={grupos} />
        {cifras ? (
          <>
            <FilaDeKpis>
              <Kpi icono="AlertTriangle" rotulo="Vencidos" apoyo="por fecha" valor={cifras.vencidos.toLocaleString('es-SV')} color={MARCA.rojo}
                onPress={() => setVista('vencidos')} />
              <Kpi icono="CalendarClock" rotulo="Por vencer" apoyo="en 6 meses" valor={cifras.proximos.toLocaleString('es-SV')} color={MARCA.ambar}
                onPress={() => setVista('proximos')} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="Boxes" rotulo="Productos" valor={datos.total.toLocaleString('es-SV')} color={MARCA.azul} />
              <Kpi icono="Wallet" rotulo="Inversión" apoyo="costo sin IVA" valor={formatMoney(cifras.inversion, { decimales: 0 })} color={MARCA.verde} />
            </FilaDeKpis>
          </>
        ) : null}
        <Segmentos activa={vista} onCambiar={setVista}
          opciones={[{ id: 'todo', label: 'Todo' }, { id: 'proximos', label: 'Por vencer' }, { id: 'vencidos', label: 'Vencidos' }]} />
        {datos.parecidos ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran productos parecidos." /></View> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {datos.filas.map((g) => {
          const k = `${g.erp_sucursal_id}_${g.erp_product_id}`;
          return <Tarjeta key={k} g={g} conSala={erp == null} vencidas={vencidasPorProducto[k] || 0} />;
        })}
        {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        {!cargando && quedan ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((p) => p + 1)} /></View> : null}
        {!cargando && !datos.filas.length && !error ? (
          <View style={{ alignItems: 'center', paddingTop: 40, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>
              {vista === 'vencidos' ? 'Nada vencido' : vista === 'proximos' ? 'Nada vence en seis meses' : 'Sin productos'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
