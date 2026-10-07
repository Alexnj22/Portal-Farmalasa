// Torogoz · Pedidos, NATIVO (`TabPedidos` del portal): pendientes (preventas
// por facturar), finalizados y anulados de los últimos 60 días, con los
// números de arriba —pendientes, facturados hoy, sin sello, sin comprobante y
// rechazados—, la búsqueda por cliente o número y el detalle de cada uno.
//
// La pestaña va en la dirección (`?vista=`), como en el portal; así el
// «Preventas» del Inicio abre directo en Pendientes.
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { contarPagosSinComprobante, fetchPedidos } from '@nucleo/data/distribucion';
import { ESTADO_DOCUMENTO, TIPO_DOCUMENTO, VISTAS_PEDIDOS, rotuloTipoCliente } from '@nucleo/utils/distribucionComun';
import { VENTANA_PEDIDOS_DIAS, controlCorto, estadoDePedido, pedidosDeLaVista, resumenDePedidos } from '@nucleo/utils/distribucionPedidos';
import { totalDePedido } from '@nucleo/utils/distribucionMotor';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import Segmentos from '../../componentes/Segmentos';
import Vidrio from '../../componentes/Vidrio';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import { Esqueleto } from '../../componentes/inicio/Widget';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import Etiqueta from '../../componentes/torogoz/rutas/Etiqueta';
import { recordarPedido } from '../../componentes/torogoz/pedidos/elegido';

const PETROLEO = '#0f6e7d';
const POR_PAGINA = 40;
const OPCIONES = VISTAS_PEDIDOS.map((v) => ({ id: v.key, label: v.label }));

function FilaPedido({ p }) {
  const est = estadoDePedido(p);
  const dte = p.dist_dte;
  const estDte = dte ? ESTADO_DOCUMENTO[dte.estado] : null;
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); recordarPedido(p); router.push(`/torogoz/pedido/${p.id}`); }}
      accessibilityRole="button" accessibilityLabel={`Pedido ${p.id} de ${p.dist_clientes?.nombre ?? ''}`}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.985 : 1 }] })}>
      <Vidrio radio={18} interactivo>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{p.dist_clientes?.nombre ?? 'Cliente'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                {`Pedido ${p.id} · ${rotuloTipoCliente(p.dist_clientes?.tipo)}${p.condicion === 2 ? ` · crédito ${p.plazo_dias} días` : ''}`}
              </Text>
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {formatMoney(dte ? dte.total_pagar : totalDePedido(p))}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <Etiqueta variante={est.variant} texto={est.label} />
            {estDte && dte.estado !== 'sellado' ? <Etiqueta variante={estDte.variant} texto={estDte.label} /> : null}
            <Text style={{ flex: 1, textAlign: 'right', color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
              {[dte ? `${TIPO_DOCUMENTO[dte.tipo]?.corto ?? ''} ${controlCorto(dte.numero_control)}` : null, shortEmployeeName(p.employees) || null, fechaNumerica(p.created_at)].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function TorogozPedidos() {
  const params = useLocalSearchParams();
  const vista = OPCIONES.some((o) => o.id === params.vista) ? params.vista : 'pendientes';
  const { hasPermission } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  const [pedidos, setPedidos] = useState(null);
  const [sinComprobante, setSinComprobante] = useState(0);
  const [error, setError] = useState('');
  const [recargando, setRecargando] = useState(false);
  const [texto, setTexto] = useState('');
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  const buscar = useTextoRebotado(texto);
  const pedidoRef = useRef(0);

  const cargar = useCallback(async () => {
    const mio = ++pedidoRef.current;
    setError('');
    try {
      const [p, sc] = await Promise.all([fetchPedidos({ desde: sumarDias(hoySV(), -VENTANA_PEDIDOS_DIAS) }), contarPagosSinComprobante()]);
      if (mio !== pedidoRef.current) return;
      setPedidos(p); setSinComprobante(sc);
    } catch {
      if (mio === pedidoRef.current) setError('No se pudieron cargar los pedidos. Revisa la conexión e intenta de nuevo.');
    }
  }, []);
  // Se relee al volver del detalle: facturar o anular cambia la lista.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const filtrados = useMemo(() => pedidosDeLaVista(pedidos, vista, buscar), [pedidos, vista, buscar]);
  const stats = useMemo(() => resumenDePedidos(pedidos, hoySV()), [pedidos]);
  const cargando = pedidos === null && !error;
  const v = (n) => (cargando ? '…' : formatQty(n));

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Pedidos', headerLargeTitle: false,
        headerSearchBarOptions: {
          placeholder: 'Cliente o número', hideWhenScrolling: false,
          onChangeText: (e) => { setTexto(e.nativeEvent.text); setCuantos(POR_PAGINA); }, onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {puedeVender ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Nueva venta" color={PETROLEO} onPress={() => router.push('/torogoz/venta')} />
          </View>
        ) : null}
        <FilaDeKpis>
          <Kpi icono="ClipboardList" rotulo="Pendientes" color={PETROLEO} valor={v(stats.porFacturar)} apoyo="Preventas por finalizar"
            onPress={() => router.setParams({ vista: 'pendientes' })} />
          <Kpi icono="Check" rotulo="Hoy" color={MARCA.verde} valor={v(stats.facturadosHoy)} apoyo="Facturados hoy" />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="Clock" rotulo="Sin sello" color={MARCA.ambar} pide={stats.sinSello > 0} valor={v(stats.sinSello)} apoyo="Aún no cuentan ante Hacienda" />
          <Kpi icono="AlertTriangle" rotulo="Rechazados" color={MARCA.rojo} pide={stats.rechazados > 0} valor={v(stats.rechazados)} apoyo="Hay que volver a facturar" />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="Receipt" rotulo="Sin comprobante" color={MARCA.ambar} pide={sinComprobante > 0} valor={v(sinComprobante)} apoyo="Tarjeta, transferencia o cheque" />
        </FilaDeKpis>
        <Segmentos opciones={OPCIONES} activa={vista} onCambiar={(x) => { setCuantos(POR_PAGINA); router.setParams({ vista: x }); }} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {cargando ? <View style={{ marginHorizontal: 16 }}><Vidrio radio={18}><View style={{ padding: 14 }}><Esqueleto lineas={5} /></View></Vidrio></View> : null}
        {pedidos && !filtrados.length ? (
          <View style={{ marginHorizontal: 16 }}>
            <Aviso texto={buscar ? 'Ningún pedido coincide con la búsqueda.' : vista === 'pendientes' ? 'Sin pendientes: todas las preventas están finalizadas.' : vista === 'anulados' ? 'Sin anulados.' : 'Sin pedidos finalizados.'} />
          </View>
        ) : null}
        {filtrados.slice(0, cuantos).map((p) => <FilaPedido key={p.id} p={p} />)}
        {filtrados.length > cuantos ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande borde color={PETROLEO} texto={`Ver ${Math.min(POR_PAGINA, filtrados.length - cuantos)} más de ${formatQty(filtrados.length - cuantos)}`}
              onPress={() => setCuantos((c) => c + POR_PAGINA)} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
