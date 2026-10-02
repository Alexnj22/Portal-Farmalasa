// Clientes, NATIVO — la lista de fichas del portal (`ClientesView.jsx`): se
// busca por nombre, DUI, NIT, NRC o teléfono en la barra del sistema, y los
// filtros (categoría, estado de la ficha, sólo «Por revisar») van en el menú.
// Son ~28 mil fichas: todo lo pagina el servidor (`get_customers_page`, de a
// 25) y la búsqueda se descarta si llega tarde. Tocar una abre su ficha.
//
// No hay alta: las fichas las da de alta el punto de venta.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchCustomersPage, fetchCustomersStats } from '@nucleo/data/customers';
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
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{c.name}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
              {[c.categoria, doc, c.municipio].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pildora texto={ficha} color={color} />
              {c.mostrador ? <Pildora texto="Mostrador" color={colorSistema.texto2} /> : null}
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
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({ rows: [], total: 0, aproximado: false });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const pedido = useRef(0);

  useEffect(() => { fetchCustomersStats().then(setStats).catch(() => setStats(null)); }, []);
  useEffect(() => { setPagina(1); }, [busqueda, categoria, ficha, revisar]);

  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    try {
      const r = await fetchCustomersPage({
        search: busqueda.trim() || null, categoria: categoria === 'todas' ? null : categoria,
        ficha: ficha === 'todas' ? null : ficha, revisar: revisar === 'todas' ? null : revisar, page: pagina, pageSize: 25,
      });
      if (yo !== pedido.current) return;   // llegó tarde: ya se pidió otra cosa
      setError(null);
      setDatos((d) => (pagina === 1 ? r : { ...r, rows: [...d.rows, ...r.rows] }));
    } catch (e) {
      if (yo === pedido.current) setError('No se pudieron cargar los clientes.');
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [busqueda, categoria, ficha, revisar, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  const grupos = [
    { id: 'categoria', titulo: 'Categoría', activa: categoria, porDefecto: 'todas', onCambiar: setCategoria,
      opciones: [{ id: 'todas', label: 'Todas' }, ...CATEGORIAS_CLIENTE.map((c) => ({ id: c, label: c })), { id: '__sin__', label: 'Sin categoría' }] },
    { id: 'ficha', titulo: 'Ficha', activa: ficha, porDefecto: 'todas', onCambiar: setFicha,
      opciones: [{ id: 'todas', label: 'Todas' }, { id: 'completa', label: 'Completas' }, { id: 'parcial', label: 'Por completar' }, { id: 'vacia', label: 'Vacías' }] },
    { id: 'revisar', titulo: 'A revisar', activa: revisar, porDefecto: 'todas', onCambiar: setRevisar,
      opciones: [{ id: 'todas', label: 'Sin filtro' }, { id: 'dui', label: 'DUI inválido' }, { id: 'telefono', label: 'Teléfono' }, { id: 'nombre', label: 'Nombre dañado' }, { id: 'duplicado', label: 'Duplicados' }] },
  ];
  const quedan = datos.total > datos.rows.length;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Clientes', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, DUI, NIT, NRC, teléfono…', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <FiltrosActivos grupos={grupos} />
        {stats && !busqueda ? (
          <FilaDeKpis>
            <Kpi icono="Users" rotulo="Fichas" valor={(stats.total ?? 0).toLocaleString('es-SV')} color={MARCA.azul} />
            <Kpi icono="AlertTriangle" rotulo="Por completar" valor={(stats.por_completar ?? 0).toLocaleString('es-SV')} color={MARCA.ambar}
              onPress={() => setFicha('parcial')} />
          </FilaDeKpis>
        ) : null}
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
      </ScrollView>
    </>
  );
}
