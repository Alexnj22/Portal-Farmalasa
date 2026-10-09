// Clientes, NATIVO — la lista de fichas del portal (`ClientesView.jsx`): se
// busca por nombre, DUI, NIT, NRC o teléfono en la barra del sistema, y los
// filtros (categoría, estado de la ficha, sólo «Por revisar») van en el menú.
// Son ~28 mil fichas: todo lo pagina el servidor (`get_customers_page`, de a
// 25) y la búsqueda se descarta si llega tarde. Tocar una abre su ficha.
//
// No hay alta: las fichas las da de alta el punto de venta.
//
// A la par del portal: las cinco tarjetas (Clientes, Completas, Por completar,
// Contribuyentes, A revisar); «Por completar» es el MISMO criterio del portal
// —ficha vacía, con compras y sin mostrador—, no «parcial». En el menú,
// además de categoría/ficha/revisar: departamento y su municipio, «Con código»,
// «Sin mostrador» y el orden (`ORDEN_CLIENTES`). La pestaña «Por revisar» trae
// las fichas que se congelaron o que parecen repetidas, con «Marcar revisado».
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useMasAlFinal } from '../componentes/ListaPaginada';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { descartarClientePorRevisar, fetchClientesPorRevisar, fetchCustomersPage, fetchCustomersStats } from '@nucleo/data/customers';
import { DEPARTAMENTOS, municipiosDe } from '@nucleo/data/elSalvadorGeo';
import { motivoPorRevisar, ORDEN_CLIENTES } from '@nucleo/utils/clientesPorRevisar';
import Segmentos from '../componentes/Segmentos';
import { colorDeVariante } from '../componentes/colorDeVariante';
import { fallo } from '../componentes/Progreso';
import { anotar } from '@nucleo/data/audit';
import { CATEGORIAS_CLIENTE } from '@nucleo/utils/clienteValidacion';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

// «Por revisar»: fichas que no se completaron solas a propósito.
function PorRevisar() {
  const { hasPermission } = useAuth();
  const puede = hasPermission('clientes', 'can_edit');
  const [familia, setFamilia] = useState('');
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    try { setD(await fetchClientesPorRevisar({ familia, pageSize: 200 })); setError(null); }
    catch (e) { setError(e?.message || 'No se pudo cargar la lista.'); setD((x) => x ?? { total: 0, congelado: 0, repetido: 0, rows: [] }); }
  }, [familia]);
  useEffect(() => { cargar(); }, [cargar]);
  const marcar = (fila) => Alert.alert(fila.descartado_at ? 'Volver a la lista' : 'Marcar revisado', fila.name, [
    { text: 'Cancelar', style: 'cancel' },
    { text: fila.descartado_at ? 'Volver' : 'Marcar', onPress: async () => {
      try { await descartarClientePorRevisar(fila.id, !!fila.descartado_at, { nombre: fila.name, motivo: fila.motivo }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); cargar(); }
      catch (e) { fallo('No se pudo guardar', e?.message || ''); }
    } },
  ]);
  if (!d) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="Lock" rotulo="Fiscales congelados" valor={d.congelado.toLocaleString('es-SV')} color={MARCA.azulClaro} pide={familia === 'congelado'}
          apoyo="se completan a mano" onPress={() => setFamilia((v) => (v === 'congelado' ? '' : 'congelado'))} />
        <Kpi icono="Users" rotulo="Posible repetido" valor={d.repetido.toLocaleString('es-SV')} color={MARCA.ambar} pide={familia === 'repetido'}
          apoyo="nombre, DUI o NIT ya usado" onPress={() => setFamilia((v) => (v === 'repetido' ? '' : 'repetido'))} />
      </FilaDeKpis>
      <View style={{ marginHorizontal: 16 }}>
        <Aviso texto="Estas fichas no se completaron solas a propósito. Las fiscales se congelan porque cada dato que se declara a Hacienda necesita una persona que lo confirme. Las de posible repetido no se crearon porque ya hay un cliente con ese nombre, DUI o NIT, y crearlas partiría al cliente en dos." />
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {d.rows.map((f) => {
        const m = motivoPorRevisar(f.motivo);
        return (
          <Pressable key={f.id} disabled={!f.customer_id}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); anotar('CLIENTES_VER_FICHA', f.customer_id, { nombre: f.name, desde: 'por-revisar' }); router.push({ pathname: '/cliente/[id]', params: { id: String(f.customer_id) } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              <View style={{ padding: 14, gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{f.name}</Text>
                  <Pildora texto={m.label} color={colorDeVariante(m.variant)} />
                </View>
                {f.detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{f.detalle}</Text> : null}
                {!f.customer_id ? <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '600' }}>Sin ficha en el portal</Text> : null}
                {puede ? (
                  <Pressable onPress={() => marcar(f)} hitSlop={6}
                    style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: `${MARCA.verde}2E`, opacity: pressed ? 0.7 : 1 })}>
                    <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>{f.descartado_at ? 'Volver a la lista' : 'Marcar revisado'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </Vidrio>
          </Pressable>
        );
      })}
      {!d.rows.length ? <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 24, fontSize: 15 }}>{familia ? 'Sin pendientes en este grupo' : 'Sin fichas por revisar'}</Text> : null}
    </>
  );
}

const FICHA = { completa: ['Completa', MARCA.verde], parcial: ['Por completar', MARCA.ambar], vacia: ['Vacía', MARCA.rojo] };

function Fila({ c, verMontos }) {
  const [ficha, color] = FICHA[c.ficha] ?? [c.ficha ?? '—', colorSistema.texto2];
  const doc = c.dui ? `DUI ${c.dui}` : c.nit ? `NIT ${c.nit}` : c.pasaporte ? `Pasaporte ${c.pasaporte}` : 'Sin documento';
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); anotar('CLIENTES_VER_FICHA', c.id, { desde: 'app' }); router.push({ pathname: '/cliente/[id]', params: { id: String(c.id) } }); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo>
        <View style={{ padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Avatar empleado={{ name: c.name }} tamano={42} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{c.name}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {[c.categoria, doc, c.distrito || c.municipio, c.departamento].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pildora texto={ficha} color={color} />
              {c.mostrador ? <Pildora texto="Mostrador" color={colorSistema.texto2} /> : null}
              {c.erp_id && !c.mostrador ? <Pildora texto={`Código ${c.erp_id}`} color={MARCA.azulClaro} /> : null}
              {c.dui_sospechoso ? <Pildora texto="DUI inválido" color={MARCA.rojo} /> : null}
              {c.nombre_corrupto ? <Pildora texto="Nombre dañado" color={MARCA.ambar} /> : null}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            {verMontos && c.total != null ? <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(c.total, { decimales: 0 })}</Text> : null}
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${c.facturas ?? 0} fact.`}</Text>
            {c.ultima_fecha ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaTexto(String(c.ultima_fecha).slice(0, 10), { day: 'numeric', month: 'short' })}</Text> : null}
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Clientes() {
  const { hasPermission } = useAuth();
  const verMontos = hasPermission('clientes_ver_montos');
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350);
  const [categoria, setCategoria] = useState('todas');
  const [ficha, setFicha] = useState('todas');
  const [revisar, setRevisar] = useState('todas');
  const [departamento, setDepartamento] = useState('todos');
  const [municipio, setMunicipio] = useState('todos');
  const [conCodigo, setConCodigo] = useState('no');
  const [sinMostrador, setSinMostrador] = useState('no');
  const [soloPorCompletar, setSoloPorCompletar] = useState(false);
  const [orden, setOrden] = useState('nombre');
  const [pestana, setPestana] = useState('lista');
  const veClientes = hasPermission('clientes', 'can_view');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({ rows: [], total: 0, aproximado: false });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const pedido = useRef(0);

  useEffect(() => { fetchCustomersStats().then(setStats).catch(() => setStats(null)); }, []);
  useEffect(() => { setPagina(1); }, [busqueda, categoria, ficha, revisar, departamento, municipio, conCodigo, sinMostrador, soloPorCompletar, orden]);
  useEffect(() => { setMunicipio('todos'); }, [departamento]);

  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    try {
      const r = await fetchCustomersPage({
        search: busqueda.trim() || null, categoria: categoria === 'todas' ? null : categoria,
        ficha: soloPorCompletar ? 'vacia' : ficha === 'todas' ? null : ficha, revisar: revisar === 'todas' ? null : revisar,
        departamento: departamento === 'todos' ? null : departamento, municipio: municipio === 'todos' ? null : municipio,
        erp: conCodigo === 'si' ? 'con' : null,
        actividad: soloPorCompletar ? 'con' : null,
        mostrador: sinMostrador === 'si' || soloPorCompletar ? 'sin' : null,
        sort: orden, dir: ORDEN_CLIENTES.find((o) => o.value === orden)?.dir ?? 'asc',
        page: pagina, pageSize: 25,
      });
      if (yo !== pedido.current) return;   // llegó tarde: ya se pidió otra cosa
      setError(null);
      setDatos((d) => (pagina === 1 ? r : { ...r, rows: [...d.rows, ...r.rows] }));
    } catch (e) {
      if (yo === pedido.current) setError('No se pudieron cargar los clientes.');
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [busqueda, categoria, ficha, revisar, departamento, municipio, conCodigo, sinMostrador, soloPorCompletar, orden, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  const grupos = [
    { id: 'categoria', titulo: 'Categoría', activa: categoria, porDefecto: 'todas', onCambiar: setCategoria,
      opciones: [{ id: 'todas', label: 'Todas' }, ...CATEGORIAS_CLIENTE.map((c) => ({ id: c, label: c })), { id: '__sin__', label: 'Sin categoría' }] },
    { id: 'ficha', titulo: 'Ficha', activa: ficha, porDefecto: 'todas', onCambiar: setFicha,
      opciones: [{ id: 'todas', label: 'Todas' }, { id: 'completa', label: 'Completas' }, { id: 'parcial', label: 'Por completar' }, { id: 'vacia', label: 'Vacías' }] },
    { id: 'revisar', titulo: 'A revisar', activa: revisar, porDefecto: 'todas', onCambiar: setRevisar,
      opciones: [{ id: 'todas', label: 'Sin filtro' }, { id: 'dui', label: 'DUI inválido' }, { id: 'telefono', label: 'Teléfono' }, { id: 'nombre', label: 'Nombre dañado' }, { id: 'duplicado', label: 'Duplicados' }] },
    { id: 'departamento', titulo: 'Departamento', activa: departamento, porDefecto: 'todos', onCambiar: setDepartamento,
      opciones: [{ id: 'todos', label: 'Todos' }, ...DEPARTAMENTOS.map((d) => ({ id: d, label: d }))] },
    // El municipio cuelga del departamento: una lista de 44 sin su
    // departamento es una lista que nadie puede recorrer.
    ...(departamento !== 'todos' ? [{ id: 'municipio', titulo: 'Municipio', activa: municipio, porDefecto: 'todos', onCambiar: setMunicipio,
      opciones: [{ id: 'todos', label: 'Todos' }, ...municipiosDe(departamento).map((m) => ({ id: m, label: m }))] }] : []),
    { id: 'codigo', titulo: 'Código', activa: conCodigo, porDefecto: 'no', onCambiar: setConCodigo,
      opciones: [{ id: 'no', label: 'Con o sin código' }, { id: 'si', label: 'Con código' }] },
    { id: 'mostrador', titulo: 'Mostrador', activa: sinMostrador, porDefecto: 'no', onCambiar: setSinMostrador,
      opciones: [{ id: 'no', label: 'Incluir mostrador' }, { id: 'si', label: 'Sin mostrador' }] },
    { id: 'orden', titulo: 'Orden', activa: orden, porDefecto: 'nombre', onCambiar: setOrden,
      opciones: ORDEN_CLIENTES.map((o) => ({ id: o.value, label: o.label })) },
  ];
  const quedan = datos.total > datos.rows.length;
  const alFinal = useMasAlFinal(() => setPagina((p) => p + 1), pestana === 'lista' && !cargando && quedan);
  const [recargando, setRecargando] = useState(false);
  const recargar = async () => {
    setRecargando(true);
    fetchCustomersStats().then(setStats).catch(() => {});
    if (pagina === 1) await cargar(); else setPagina(1);
    setRecargando(false);
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Clientes', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, DUI, NIT, NRC, teléfono…', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={pestana === 'lista' ? grupos : []} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" {...alFinal}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={recargar} />}>
        <FiltrosActivos grupos={grupos} />
        {veClientes ? (
          <Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'lista', label: 'Clientes' }, { id: 'revisar', label: 'Por revisar' }]} />
        ) : null}
        {pestana === 'revisar' ? <PorRevisar /> : null}
        {pestana === 'lista' && stats && !busqueda ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Users" rotulo="Clientes" valor={(stats.total ?? 0).toLocaleString('es-SV')} color={MARCA.azul} apoyo="en el catálogo" />
              <Kpi icono="IdCard" rotulo="Completas" valor={(stats.completas ?? 0).toLocaleString('es-SV')} color={MARCA.verde} apoyo="según su categoría" />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="Receipt" rotulo="Por completar" valor={(stats.por_completar ?? 0).toLocaleString('es-SV')} color={MARCA.ambar} pide={soloPorCompletar}
                apoyo={soloPorCompletar ? 'filtrando · toca para quitar' : 'compran y no tienen datos'} onPress={() => setSoloPorCompletar((v) => !v)} />
              <Kpi icono="ShieldCheck" rotulo="Contribuyentes" valor={(stats.contribuyentes ?? 0).toLocaleString('es-SV')} color={MARCA.violetaClaro} apoyo="se declaran a Hacienda" />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="ShieldAlert" rotulo="A revisar" valor={(stats.a_revisar ?? 0).toLocaleString('es-SV')} color={stats.a_revisar ? MARCA.rojo : MARCA.verde}
                apoyo="DUI, teléfono o nombre" />
            </FilaDeKpis>
          </>
        ) : null}
        {pestana !== 'lista' ? null : <>
        {datos.aproximado && busqueda ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran nombres parecidos." /></View> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {!cargando || datos.rows.length ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
            {`${datos.total.toLocaleString('es-SV')} ficha${datos.total === 1 ? '' : 's'}`}
          </Text>
        ) : null}
        {datos.rows.map((c) => <Fila key={c.id} c={c} verMontos={verMontos} />)}
        {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        {!cargando && quedan ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((p) => p + 1)} /></View> : null}
        {!cargando && !datos.rows.length && !error ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40, fontSize: 15 }}>Ninguna ficha con esos filtros.</Text>
        ) : null}
        </>}
      </ScrollView>
    </>
  );
}
