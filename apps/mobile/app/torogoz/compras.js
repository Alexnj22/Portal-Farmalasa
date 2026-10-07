// Torogoz · Compras, NATIVO — la pestaña Compras del portal (`TabCompras`):
// la puerta por la que entra la mercadería CON SU COSTO. Las cuatro tarjetas
// (comprado este mes, crédito fiscal del mes, borradores, proveedores
// activos), el control segmentado Recibidas · Borradores · Anuladas, la
// búsqueda por proveedor o número, y para quien configura «Nueva compra» y
// «Proveedores». Las cuentas salen del núcleo.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchCompras, fetchProveedores } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { resumenDeCompras } from '@nucleo/utils/distribucionComercial';
import { TIPOS_COMPRA, VISTAS_COMPRAS } from '@nucleo/utils/distribucionCompras';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Segmentos from '../../componentes/Segmentos';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { PETROLEO, useEmisor } from '../../componentes/torogoz/comercial/Piezas';

const POR_PAGINA = 40;
const rotuloTipo = (t) => TIPOS_COMPRA.find((x) => x.value === t)?.label ?? t;
const VACIO = {
  recibida: 'Sin compras. Registra la primera con «Nueva compra».',
  borrador: 'Sin borradores: todas las compras capturadas ya se recibieron.',
  anulada: 'No se ha anulado ninguna compra.',
};

export default function ComprasTorogoz() {
  const { hasPermission } = useAuth();
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const { emisor } = useEmisor();
  const [compras, setCompras] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [error, setError] = useState('');
  const [vista, setVista] = useState('recibida');
  const [buscar, setBuscar] = useState('');
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([fetchCompras(), fetchProveedores()]);
      setCompras(c); setProveedores(p); setError('');
    } catch (e) {
      setError(mensajeDeDistribucion(e)); setCompras((x) => x ?? []);
    }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const resumen = useMemo(() => resumenDeCompras(compras ?? [], hoySV().slice(0, 7)), [compras]);
  const activos = useMemo(() => proveedores.filter((p) => p.activo).length, [proveedores]);
  const filtradas = useMemo(() => {
    const q = buscar.trim();
    return (compras ?? []).filter((c) => c.estado === vista && (!q || tokenMatch(q, c.proveedor, c.numero)));
  }, [compras, vista, buscar]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Compras', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Proveedor o número', hideWhenScrolling: false,
          onChangeText: (e) => { setCuantos(POR_PAGINA); setBuscar(e.nativeEvent.text); }, onCancelButtonPress: () => setBuscar('') },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FilaDeKpis>
          <Kpi icono="ShoppingCart" rotulo="Comprado este mes" valor={formatMoney(resumen.comprado)} color={PETROLEO}
            apoyo={`${formatQty(resumen.documentos)} documentos recibidos`} />
          <Kpi icono="Landmark" rotulo="Crédito fiscal" valor={formatMoney(resumen.credito)} color={MARCA.verde} apoyo="IVA de los CCF del mes" />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="FileText" rotulo="Borradores" valor={formatQty(resumen.borradores)} color={MARCA.ambar} pide={resumen.borradores > 0}
            apoyo="capturados y sin recibir" onPress={() => { setCuantos(POR_PAGINA); setVista('borrador'); }} />
          <Kpi icono="Truck" rotulo="Proveedores" valor={formatQty(activos)} color={MARCA.violetaClaro} apoyo="activos"
            onPress={puedeConfigurar ? () => router.push('/torogoz/proveedores') : undefined} />
        </FilaDeKpis>
        {puedeConfigurar && emisor ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Nueva compra" color={PETROLEO} onPress={() => router.push({ pathname: '/torogoz/compra/[id]', params: { id: 'nueva' } })} />
          </View>
        ) : null}
        <Segmentos activa={vista} onCambiar={(v) => { setCuantos(POR_PAGINA); setVista(v); }}
          opciones={VISTAS_COMPRAS.map((v) => ({ id: v.key, label: v.label }))} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {compras === null ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {filtradas.slice(0, cuantos).map((c) => (
          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`Compra ${c.numero}`}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/torogoz/compra/[id]', params: { id: String(c.id) } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={20} interactivo>
              <View style={{ padding: 14, flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{c.proveedor}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{`${rotuloTipo(c.tipo_doc)} · ${c.numero}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                    {`${fechaNumerica(c.fecha)} · ${formatQty(c.renglones)} productos`}
                  </Text>
                  {Number(c.condicion) === 2 && c.vence ? (
                    <View style={{ flexDirection: 'row' }}><Pildora texto={`Crédito · vence ${fechaNumerica(c.vence)}`} color={MARCA.azulClaro} /></View>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(c.total))}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{`IVA ${formatMoney(Number(c.iva))}`}</Text>
                </View>
              </View>
            </Vidrio>
          </Pressable>
        ))}
        {filtradas.length > cuantos ? (
          <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde color={PETROLEO} onPress={() => setCuantos((n) => n + POR_PAGINA)} /></View>
        ) : null}
        {compras !== null && !filtradas.length && !error ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 32, fontSize: 15, marginHorizontal: 24 }}>
            {buscar.trim() ? 'Ninguna compra coincide con la búsqueda.' : VACIO[vista]}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
