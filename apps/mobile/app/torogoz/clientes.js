// Torogoz · Clientes, NATIVO — la pestaña Clientes del portal (`TabClientes`):
// las cuatro tarjetas (activos, con NRC, sin licencia, con crédito), el tipo
// en el menú de filtros, la búsqueda en la barra (por nombre, ruta, NIT/DUI o
// NRC; los documentos se comparan por sus dígitos) y «Nuevo cliente» para quien
// vende. La licencia de la SRS es la columna que importa: sin licencia vigente
// no se le vende. Las reglas salen del núcleo (`distribucionComercial`).
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchClientes } from '@nucleo/data/distribucion';
import { ubicacionMH } from '@nucleo/data/geoCodigosMH';
import { anotar } from '@nucleo/data/audit';
import { estadoLicencia, filtrarClientes, resumenDeClientes } from '@nucleo/utils/distribucionComercial';
import { TIPO_CLIENTE, rotuloTipoCliente } from '@nucleo/utils/distribucionComun';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { formatearNit, formatearNrc } from '@nucleo/utils/nitUtils';
import { hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { PETROLEO, colorDe, guardarElegida, useEmisor } from '../../componentes/torogoz/comercial/Piezas';
import { useMasAlFinal } from '../../componentes/ListaPaginada';

const POR_PAGINA = 40;

function Fila({ c, hoy }) {
  const lic = estadoLicencia(c, hoy);
  const doc = c.tipo_documento === '36' ? formatearNit(c.num_documento) : c.num_documento;
  const donde = [c.ruta, ubicacionMH(c.departamento, c.municipio, c.distrito)].filter(Boolean).join(' · ');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={c.nombre}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        guardarElegida('cliente', c);
        anotar('DISTRIBUCION_VER_CLIENTE', String(c.id), { nombre: c.nombre });
        router.push({ pathname: '/torogoz/cliente/[id]', params: { id: String(c.id) } });
      }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo>
        <View style={{ padding: 14, flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{c.nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {[rotuloTipoCliente(c.tipo), c.gran_contribuyente ? 'retiene 1%' : null, !c.activo ? 'inactivo' : null].filter(Boolean).join(' · ')}
            </Text>
            {doc || c.nrc ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                {[doc, c.nrc ? `NRC ${formatearNrc(c.nrc)}` : null].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            {donde ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{donde}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              <Pildora texto={lic.label} color={colorDe(lic.variant)} />
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            {c.plazo_dias > 0 ? (
              <>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(c.limite_credito)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${c.plazo_dias} días`}</Text>
              </>
            ) : <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Contado</Text>}
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function ClientesTorogoz() {
  const { hasPermission } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  const { emisor } = useEmisor();
  const [clientes, setClientes] = useState(null);
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');
  const [tipo, setTipo] = useState('todos');
  const [soloSinLicencia, setSoloSinLicencia] = useState(false);
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  // Al acercarse al final se pinta la página siguiente sola; «Ver más» queda de respaldo.
  const alFinal = useMasAlFinal(() => setCuantos((n) => n + POR_PAGINA));
  const [recargando, setRecargando] = useState(false);
  const pedido = useRef(0);
  const hoy = hoySV();

  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    try {
      const r = await fetchClientes();
      if (yo === pedido.current) { setClientes(r); setError(''); }
    } catch {
      if (yo === pedido.current) { setError('No se pudieron cargar los clientes. Revisa la conexión e intenta de nuevo.'); setClientes((x) => x ?? []); }
    }
  }, []);
  // Se relee al volver de una ficha: lo guardado se ve sin tirar hacia abajo.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const filtrados = useMemo(() => filtrarClientes(clientes ?? [], { buscar, tipo: tipo === 'todos' ? '' : tipo, soloSinLicencia, hoy }),
    [clientes, buscar, tipo, soloSinLicencia, hoy]);
  const stats = useMemo(() => resumenDeClientes(clientes ?? [], hoy), [clientes, hoy]);
  const cambiar = (fn) => (v) => { setCuantos(POR_PAGINA); fn(v); };

  const grupos = [
    { id: 'tipo', titulo: 'Tipo', activa: tipo, porDefecto: 'todos', onCambiar: cambiar(setTipo),
      opciones: [{ id: 'todos', label: 'Todos' }, ...TIPO_CLIENTE.map((t) => ({ id: t.value, label: t.label }))] },
    { id: 'licencia', titulo: 'Licencia', activa: soloSinLicencia ? 'sin' : 'todas', porDefecto: 'todas', onCambiar: (v) => cambiar(setSoloSinLicencia)(v === 'sin'),
      opciones: [{ id: 'todas', label: 'Todas' }, { id: 'sin', label: 'Sin licencia o por vencer' }] },
  ];
  const hayFiltro = !!buscar.trim() || tipo !== 'todos' || soloSinLicencia;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Clientes', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, ruta, NIT, DUI o NRC', hideWhenScrolling: false,
          onChangeText: (e) => cambiar(setBuscar)(e.nativeEvent.text), onCancelButtonPress: () => setBuscar(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <FilaDeKpis>
          <Kpi icono="Users" rotulo="Clientes" valor={String(stats.activos)} color={PETROLEO} apoyo="activos" />
          <Kpi icono="ShieldCheck" rotulo="Con NRC" valor={String(stats.contribuyentes)} color={MARCA.verde} apoyo="reciben Crédito Fiscal" />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="ShieldAlert" rotulo="Sin licencia" valor={String(stats.sinLicencia)} color={MARCA.rojo} pide={stats.sinLicencia > 0}
            apoyo={soloSinLicencia ? 'filtrando · toca para quitar' : 'sin, vencida o por vencer'} onPress={() => cambiar(setSoloSinLicencia)(!soloSinLicencia)} />
          <Kpi icono="CreditCard" rotulo="Con crédito" valor={String(stats.credito)} color={MARCA.azulClaro} apoyo="plazo aprobado" />
        </FilaDeKpis>
        {puedeVender && emisor ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Nuevo cliente" color={PETROLEO} onPress={() => router.push({ pathname: '/torogoz/cliente/[id]', params: { id: 'nuevo' } })} />
          </View>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {clientes === null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
            {`${filtrados.length} cliente${filtrados.length === 1 ? '' : 's'}`}
          </Text>
        )}
        {filtrados.slice(0, cuantos).map((c) => <Fila key={c.id} c={c} hoy={hoy} />)}
        {filtrados.length > cuantos ? (
          <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde color={PETROLEO} onPress={() => setCuantos((n) => n + POR_PAGINA)} /></View>
        ) : null}
        {clientes !== null && !filtrados.length && !error ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 32, fontSize: 15, marginHorizontal: 24 }}>
            {hayFiltro ? 'Ningún cliente coincide con la búsqueda o el filtro.' : puedeVender ? 'Sin clientes. Agrega el primero con «Nuevo cliente».' : 'Sin clientes.'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
