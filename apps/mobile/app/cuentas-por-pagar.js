// Cuentas por pagar, NATIVO — `CuentasPorPagarView`: cuánto le debemos a cada
// proveedor, qué está vencido, cuánto queda disponible del crédito, y los pagos.
//
//   · Por proveedor: tocar uno abre sus facturas pendientes con su vencimiento
//     (`cxp-proveedor/[nit]`).
//   · Pagos: los pendientes primero. Gerencia (`can_approve`) los aprueba o
//     anula desde el teléfono — «Compras lo marca, Gerencia aprueba los
//     cheques» —, con la misma función y el mismo motivo del portal.
//
// Registrar un pago (repartirlo factura por factura) y las condiciones de
// crédito se hacen en la ficha del proveedor (`cxp-proveedor/[nit]`), como el
// panel del portal. El período («todo» / desde junio 2026) va en el menú de
// filtros. Los totales salen del núcleo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { anularPago, aprobarPago, fetchCuentasPorPagar, fetchPagos } from '@nucleo/data/cuentasPorPagar';
import { ESTADO_PAGO, FORMAS_DE_PAGO, totalesCuentasPorPagar } from '@nucleo/utils/cuentasPorPagar';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

const COLOR = { warning: MARCA.ambar, success: MARCA.verde, neutral: colorSistema.texto2 };
const forma = (v) => FORMAS_DE_PAGO.find((f) => f.value === v)?.label ?? v ?? '—';

export default function CuentasPorPagar() {
  const { hasPermission } = useAuth();
  const puedeAprobar = hasPermission('cuentas_por_pagar', 'can_approve');
  const [tab, setTab] = useState('proveedores');
  const [filas, setFilas] = useState(null);
  const [pagos, setPagos] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [recargando, setRecargando] = useState(false);
  const [desde, setDesde] = useState('todo');

  const cargar = useCallback(async () => {
    const [a, b] = await Promise.all([fetchCuentasPorPagar(desde === 'todo' ? null : desde), fetchPagos(null, 180)]);
    setFilas(a.filas); setPagos(b.filas);
    setError(a.error?.message || b.error?.message || null);
  }, [desde]);
  useEffect(() => { cargar(); }, [cargar]);

  const t = useMemo(() => totalesCuentasPorPagar(filas), [filas]);
  const q = texto.trim();
  const provVisibles = useMemo(() => (filas || []).filter((f) => !q || tokenMatch(q, f.proveedor, f.emisor_nit))
    .sort((a, b) => Number(b.vencido || 0) - Number(a.vencido || 0) || Number(b.saldo || 0) - Number(a.saldo || 0)), [filas, q]);
  const pagosVisibles = useMemo(() => (pagos || []).filter((p) => !q || tokenMatch(q, p.proveedor, p.referencia)), [pagos, q]);
  const pendientes = (pagos || []).filter((p) => p.estado === 'pendiente');

  // El mismo corte de período que el portal (`PERIODOS`).
  const grupos = [{
    id: 'desde', titulo: 'Período', activa: desde, porDefecto: 'todo', onCambiar: setDesde,
    opciones: [{ id: 'todo', label: 'Todo lo que se debe' }, { id: '2026-06-01', label: 'Desde junio 2026' }],
  }];

  const decidir = (accion, p) => {
    const aprobar = accion === 'aprobar';
    Alert.alert(aprobar ? '¿Aprobar este pago?' : '¿Anular este pago?', `${p.proveedor} · ${formatMoney(p.monto)}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: aprobar ? 'Aprobar' : 'Anular', style: aprobar ? 'default' : 'destructive', onPress: async () => {
        const { error: e } = aprobar
          ? await aprobarPago(p.id, { proveedor: p.proveedor, monto: p.monto, desde: 'app' })
          : await anularPago(p.id, 'Anulado desde Cuentas por pagar', { proveedor: p.proveedor, monto: p.monto, desde: 'app' });
        if (e) { fallo('No se pudo', e); return; }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo(aprobar ? 'Pago aprobado' : 'Pago anulado', p.proveedor);
        cargar();
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Cuentas por pagar', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Proveedor o referencia', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={tab} onCambiar={setTab} opciones={[
          { id: 'proveedores', label: 'Por proveedor' },
          { id: 'pagos', label: pendientes.length ? `Pagos · ${pendientes.length}` : 'Pagos' },
        ]} />
        <FiltrosActivos grupos={grupos} />
        {filas ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Wallet" rotulo="Debemos" valor={formatMoney(t.saldo)} color={MARCA.violeta} apoyo={`${t.proveedores} proveedores`} />
              <Kpi icono="AlertTriangle" rotulo="Vencido" valor={formatMoney(t.vencido)} color={t.vencido > 0 ? MARCA.ambar : MARCA.verde} pide={t.vencido > 0} apoyo={`${t.conVencido} proveedores`} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="Clock" rotulo="En trámite" valor={formatMoney(t.tramite)} color={MARCA.azulClaro}
                apoyo={pendientes.length ? `${pendientes.length} pago${pendientes.length === 1 ? '' : 's'} sin aprobar` : 'nada sin aprobar'}
                onPress={pendientes.length ? () => setTab('pagos') : undefined} />
            </FilaDeKpis>
          </>
        ) : null}
        {tab === 'proveedores' && pendientes.length ? (
          <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${pendientes.length} pago${pendientes.length === 1 ? '' : 's'} esperan la aprobación de Gerencia: su monto está en trámite y no baja la deuda todavía.`} /></View>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas && t.sinPlazo > 0 && tab === 'proveedores' ? (
          <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${t.sinPlazo} proveedor(es) sin días de crédito: sus facturas no pueden decir si están vencidas. Se definen tocando al proveedor.`} /></View>
        ) : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : tab === 'proveedores' ? provVisibles.map((f) => (
          <Pressable key={f.emisor_nit} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/cxp-proveedor/[nit]', params: { nit: f.emisor_nit, nombre: f.proveedor } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo tinte={Number(f.vencido) > 0 ? 'rgba(247,144,9,0.10)' : undefined}>
              <View style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.proveedor}</Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>{formatMoney(f.saldo)}</Text>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[`${f.documentos} factura${Number(f.documentos) === 1 ? '' : 's'}`, f.dias_credito != null ? `${f.dias_credito} días` : 'sin plazo', f.disponible != null ? `disponible ${formatMoney(f.disponible)}` : null].filter(Boolean).join(' · ')}
                </Text>
                {Number(f.vencido) > 0 || Number(f.en_tramite) > 0 ? (
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {Number(f.vencido) > 0 ? <Pildora texto={`Vencido ${formatMoney(f.vencido)}`} color={MARCA.ambar} /> : null}
                    {Number(f.en_tramite) > 0 ? <Pildora texto={`En trámite ${formatMoney(f.en_tramite)}`} color={MARCA.azulClaro} /> : null}
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </Pressable>
        )) : pagosVisibles.map((p) => {
          const e = ESTADO_PAGO[p.estado] ?? ESTADO_PAGO.pendiente;
          return (
            <View key={p.id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18} tinte={p.estado === 'pendiente' ? 'rgba(247,144,9,0.10)' : undefined}>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{p.proveedor}</Text>
                    <Text style={{ color: p.estado === 'anulado' ? colorSistema.texto2 : colorSistema.texto, fontSize: 17, fontWeight: '800', textDecorationLine: p.estado === 'anulado' ? 'line-through' : 'none' }}>{formatMoney(p.monto)}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[fechaNumerica(p.fecha), forma(p.forma), p.referencia, p.registrado_por ? `marcó ${shortEmployeeName({ name: p.registrado_por })}` : null].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <Pildora texto={e.rotulo} color={COLOR[e.severidad]} />
                    {Array.isArray(p.facturas) && p.facturas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${p.facturas.length} factura${p.facturas.length === 1 ? '' : 's'}`}</Text> : null}
                  </View>
                  {p.estado === 'anulado' && p.anulado_motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.anulado_motivo}</Text> : null}
                  {puedeAprobar && p.estado === 'pendiente' ? (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                      <View style={{ flex: 1 }}><BotonGrande texto="Aprobar" color={MARCA.verde} onPress={() => decidir('aprobar', p)} /></View>
                      <View style={{ flex: 1 }}><BotonGrande texto="Anular" borde color={MARCA.rojo} onPress={() => decidir('anular', p)} /></View>
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </View>
          );
        })}
        {filas && !(tab === 'proveedores' ? provVisibles : pagosVisibles).length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {q ? 'Nada con esa búsqueda' : tab === 'proveedores' ? 'No le debemos nada a nadie' : 'Sin pagos en los últimos seis meses'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
