// Facturas de sala — el panel de supervisión, NATIVO (`FacturasSalaView` del
// portal): las facturas que alguna sala TOMÓ en el período y si ya se cargaron
// como compra. Arriba los cuatro estados con su cuenta —Sin cargar, Atrasadas
// (3 días o más; con su monto), Cargadas y Liberadas— que al tocarlos filtran;
// el período (30, 90 o 365 días) y la sala en el menú; buscar por proveedor,
// sala o quién la tomó. Cada factura dice quién la tomó y cuándo (y si fue por
// su línea), y con `facturas_sala` can_edit se puede LIBERAR —devolverla al
// montón, también una ya cargada por error—. El monto, sólo con
// `facturas_sala_ver_montos`, como el portal.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchFacturasSalaPanel, resumenRenglones, soltarFactura } from '@nucleo/data/facturasSala';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const DIAS_ALERTA = 3;
const PERIODOS = [{ id: '30', label: 'Últimos 30 días' }, { id: '90', label: 'Últimos 90 días' }, { id: '365', label: 'Último año' }];
const POR_PAGINA = 40;

function estadoDe(f) {
  if (f.liberada_at) return 'liberadas';
  if (f.registrada) return 'cargadas';
  if ((f.dias_sin_cargar ?? 0) >= DIAS_ALERTA) return 'atrasadas';
  return 'sin_cargar';
}

export default function FacturasSalaPanel() {
  const { hasPermission } = useAuth();
  const verMontos = hasPermission('facturas_sala_ver_montos');
  const puedeLiberar = hasPermission('facturas_sala', 'can_edit');
  const [dias, setDias] = useState('90');
  const [sala, setSala] = useState('todas');
  const [estado, setEstado] = useState('');
  const [buscar, setBuscar] = useState('');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [cuantas, setCuantas] = useState(POR_PAGINA);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { filas: f, error: e } = await fetchFacturasSalaPanel(Number(dias));
    setError(e?.message ?? '');
    setFilas(f || []);
  }, [dias]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const salas = useMemo(() => [...new Set((filas || []).map((f) => f.sala).filter(Boolean))].sort(), [filas]);
  const conteos = useMemo(() => {
    const c = { sin_cargar: 0, atrasadas: 0, cargadas: 0, liberadas: 0, monto_atrasado: 0 };
    for (const f of filas || []) {
      const e = estadoDe(f);
      c[e] += 1;
      if (e === 'atrasadas') c.monto_atrasado += Number(f.monto_total || 0);
    }
    return c;
  }, [filas]);
  const visibles = useMemo(() => (filas || []).filter((f) => {
    if (estado && estadoDe(f) !== estado) return false;
    if (sala !== 'todas' && f.sala !== sala) return false;
    return !buscar.trim() || tokenMatch(buscar, f.etiqueta, f.emisor_nombre, f.sala, f.tomada_por, f.items_text, String(f.monto_total));
  }), [filas, estado, sala, buscar]);

  const alternar = (clave) => { setEstado((e) => (e === clave ? '' : clave)); setCuantas(POR_PAGINA); };
  const liberar = (f) => Alert.alert('¿Liberar la factura?', `${f.etiqueta ?? f.emisor_nombre ?? 'La factura'} vuelve al montón y otra sala la puede tomar.${f.registrada ? ' Ya estaba cargada como compra.' : ''}`, [
    { text: 'No', style: 'cancel' },
    { text: 'Liberar', style: 'destructive', onPress: async () => {
      trabajando('Liberando…');
      const { error: e } = await soltarFactura(f.claim_id, 'Liberada desde Facturas de Sala');
      if (e) { fallo('No se pudo liberar', e); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Factura liberada', 'Vuelve a estar disponible para las salas.');
      cargar();
    } },
  ]);

  const grupos = [
    { id: 'dias', titulo: 'Período', activa: dias, porDefecto: '90', onCambiar: setDias, opciones: PERIODOS },
    { id: 'sala', titulo: 'Sala', activa: sala, porDefecto: 'todas', onCambiar: setSala, opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas.map((s) => ({ id: s, label: s }))] },
  ];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Facturas tomadas', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Proveedor, sala, quién la tomó…', hideWhenScrolling: false, onChangeText: (e) => setBuscar(e.nativeEvent.text), onCancelButtonPress: () => setBuscar('') } }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {filas ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Clock" rotulo="Sin cargar" valor={String(conteos.sin_cargar)} color={MARCA.azulClaro} pide={estado === 'sin_cargar'}
                apoyo={`menos de ${DIAS_ALERTA} días`} onPress={() => alternar('sin_cargar')} />
              <Kpi icono="AlertTriangle" rotulo="Atrasadas" valor={String(conteos.atrasadas)} color={conteos.atrasadas ? MARCA.ambar : MARCA.verde} pide={estado === 'atrasadas'}
                apoyo={verMontos && conteos.monto_atrasado ? formatMoney(conteos.monto_atrasado) : `${DIAS_ALERTA} días o más`} onPress={() => alternar('atrasadas')} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="Check" rotulo="Cargadas" valor={String(conteos.cargadas)} color={MARCA.verde} pide={estado === 'cargadas'}
                apoyo="ya registradas" onPress={() => alternar('cargadas')} />
              <Kpi icono="Ban" rotulo="Liberadas" valor={String(conteos.liberadas)} color={colorSistema.texto2} pide={estado === 'liberadas'}
                apoyo="al montón otra vez" onPress={() => alternar('liberadas')} />
            </FilaDeKpis>
          </>
        ) : null}
        {filas && conteos.atrasadas ? (
          <View style={{ marginHorizontal: 16 }}>
            <Aviso tono="cuidado" texto={`${conteos.atrasadas} factura${conteos.atrasadas === 1 ? '' : 's'} tomada${conteos.atrasadas === 1 ? '' : 's'} hace ${DIAS_ALERTA} días o más y todavía sin cargar como compra${verMontos ? ` · ${formatMoney(conteos.monto_atrasado)}` : ''}.`} />
          </View>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.slice(0, cuantas).map((f) => {
          const e = estadoDe(f);
          const [rotulo, color] = e === 'liberadas' ? ['Liberada', colorSistema.texto2] : e === 'cargadas' ? ['Cargada', MARCA.verde]
            : e === 'atrasadas' ? [`Sin cargar · ${f.dias_sin_cargar}d`, MARCA.ambar] : ['Sin cargar', MARCA.azulClaro];
          return (
            <View key={f.claim_id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18}>
                <View style={{ padding: 13, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{f.etiqueta ?? '—'}</Text>
                    {verMontos ? <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.monto_total)}</Text> : null}
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{[f.emisor_nombre, f.fecha_emision ? fechaTexto(String(f.fecha_emision).slice(0, 10), { day: 'numeric', month: 'short', year: '2-digit' }) : null].filter(Boolean).join(' · ')}</Text>
                  {f.items_text ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={2}>{resumenRenglones(f.items_text)}</Text> : null}
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {`${f.sala ?? 'Sin sala'} · la tomó ${f.tomada_por ?? '—'}${f.tomada_at ? ` el ${fechaTexto(String(f.tomada_at).slice(0, 10), { day: '2-digit', month: 'short' })}` : ''}${f.origen === 'linea' ? ' · por su línea' : ''}`}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Pildora texto={rotulo} color={color} />
                    <View style={{ flex: 1 }} />
                    {puedeLiberar && !f.liberada_at ? (
                      <Pressable onPress={() => liberar(f)} hitSlop={6} accessibilityRole="button"
                        style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, backgroundColor: `${MARCA.rojo}1F`, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                        <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '700' }}>Liberar</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </Vidrio>
            </View>
          );
        })}
        {filas && visibles.length > cuantas ? (
          <Pressable onPress={() => setCuantas((n) => n + POR_PAGINA)} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{`Ver más · quedan ${visibles.length - cuantas}`}</Text>
          </Pressable>
        ) : null}
        {filas && !visibles.length && !error ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 30 }}>Sin facturas tomadas en este período</Text> : null}
      </ScrollView>
    </>
  );
}
