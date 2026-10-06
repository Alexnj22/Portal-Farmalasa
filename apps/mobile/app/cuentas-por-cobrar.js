// Cuentas por cobrar, NATIVO — la cartera del portal (`CuentasPorCobrarView`):
// quién debe, cuánto y desde cuándo, el más viejo primero porque es a quien hay
// que ir a cobrar. Arriba cuánto suma lo que se ve y cuántos se pasaron del
// plazo, y si la lista está al día (una lista congelada se ve igual de bien
// que una fresca). La cartera es el espejo del portal (`creditos_de_clientes`).
//
// Lo que se ve y cómo se nombra sale del núcleo (`cartera`, `edadDelCredito`,
// `severidadDeDias`), igual que en el portal. «Con saldo / Pasados / Todos» en
// el segmentado; la sala en el menú; la búsqueda en la barra. Tocar uno abre su
// ficha. Un crédito con un cobro esperando firma lo dice: así nadie lo cobra
// dos veces.
//
// Como el portal, la lista se le pide a la CAJA mientras se mira: al abrir, cada
// minuto a la vista y cuando una búsqueda no encuentra a nadie (puede ser «lo
// acaban de vender»). `refrescarCreditosDeHoy` lleva el tope en la base —una
// lectura por sala por minuto, compartida—, así que pedirlo seguido es barato.
// Con saldo / Por vencer / Vencidos / Todos en el segmentado (`VER_CARTERA`);
// sala, vendedor y orden (`ORDEN_CARTERA`) en el menú; de 50 en 50.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { edadDelCredito, fetchCreditos, fetchCreditosReservados, fetchUltimaLectura, refrescarCreditosDeHoy } from '@nucleo/data/creditos';
import { carteraFiltrada, desdeLaLectura, ORDEN_CARTERA, pagadoPct, VER_CARTERA } from '@nucleo/utils/cartera';
import { BotonGrande } from '../componentes/formulario/Piezas';
import { colorDeEdad } from '../componentes/creditos/edad';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

// 50 por página, como el portal: la sala más cargada no queda partida.
const POR_PAGINA = 50;

const fecha = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: '2-digit' }) : '');

function Tarjeta({ c, sala, vendedor, enAprobacion }) {
  const abrir = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/credito/[id]', params: {
      id: String(c.id), sala: String(c.branch_id), credito: String(c.credito), documento: c.documento ?? '',
      cliente: c.cliente ?? '', fecha: c.fecha ?? '', dias: String(c.dias ?? ''), saldo: String(c.saldo ?? 0), total: String(c.total ?? 0),
      enAprobacion: enAprobacion ? '1' : '',
    } });
  };
  return (
    <Pressable onPress={abrir} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo>
        <View style={{ padding: 14, gap: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{c.cliente}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[sala, c.documento].filter(Boolean).join(' · ')}</Text>
            </View>
            {c.anulado_el ? <Pildora texto="Anulado" color={colorSistema.texto2} />
              : <Pildora texto={`${c.dias} d`} color={colorDeEdad(c.dias, c.saldo)} />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(c.saldo)}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`de ${formatMoney(c.total)}`}</Text>
          </View>
          {!c.anulado_el ? (
            <View style={{ height: 5, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
              <View style={{ width: `${pagadoPct(c)}%`, height: 5, backgroundColor: MARCA.verde }} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {c.vendedor?.name ? <Avatar empleado={vendedor ?? { name: c.vendedor.name }} tamano={22} /> : null}
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>
              {[vendedor ? shortEmployeeName(vendedor) : c.vendedor?.name ? shortEmployeeName(c.vendedor) : 'Sin vendedor', fecha(c.fecha), c.ultimo_abono_el ? `abonó ${fecha(c.ultimo_abono_el)}` : null].filter(Boolean).join(' · ')}
            </Text>
            {enAprobacion ? <Pildora texto="Esperando aprobación" color={MARCA.ambar} /> : null}
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function CuentasPorCobrar() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const todas = getScope?.('cuentas_por_cobrar') === 'ALL';
  const miSala = String(user?.branchId ?? user?.branch_id ?? '');
  const [salaElegida, setSala] = useState('todas');
  const [ver, setVer] = useState('DEBEN');
  const [orden, setOrden] = useState('ANTIGUOS');
  const [vendedor, setVendedor] = useState('');
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  const [leidoSala, setLeidoSala] = useState(null);
  const [texto, setTexto] = useState('');
  const [creditos, setCreditos] = useState(null);
  const [reservados, setReservados] = useState(new Map());
  const [lectura, setLectura] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const sala = todas ? (salaElegida === 'todas' ? null : salaElegida) : miSala;
  const cargar = useCallback(async () => {
    const [r, l, res] = await Promise.all([
      fetchCreditos({ sala, soloConSaldo: ver !== 'TODOS' }).catch((e) => ({ error: e })),
      fetchUltimaLectura(),
      fetchCreditosReservados(sala),
    ]);
    setError(r?.error ? 'No se pudo leer la cartera.' : null);
    setCreditos(r?.creditos ?? []);
    setReservados(res?.porCredito ?? new Map());
    setLectura(l);
  }, [sala, ver]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Pedirle a la caja lo de hoy. Si algo cambió, se relee la lista.
  const refrescar = useCallback(async (motivo = null) => {
    const r = await refrescarCreditosDeHoy({ sala, motivo }).catch(() => null);
    if (r?.leido_el) setLeidoSala(r.leido_el);
    if (r?.cambiadas > 0) cargar();
    return r;
  }, [sala, cargar]);
  // Al abrir y cada minuto mientras la pantalla está a la vista y la app al frente.
  useFocusEffect(useCallback(() => {
    const siSeVe = () => { if (AppState.currentState === 'active') refrescar(); };
    siSeVe();
    const t = setInterval(siSeVe, 60_000);
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') refrescar(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [refrescar]));
  useEffect(() => { setCuantos(POR_PAGINA); }, [ver, orden, vendedor, texto, sala]);

  const nombreDeSala = useMemo(() => new Map((sucursales || []).map((b) => [b.id, b.name])), [sucursales]);
  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const conEdad = useMemo(() => (creditos || []).map((c) => ({ ...c, ...edadDelCredito(c.fecha, c.saldo) })), [creditos]);
  const visibles = useMemo(() => carteraFiltrada(conEdad, { ver, busqueda: texto, nombreDeSala, orden, vendedor }), [conEdad, ver, texto, nombreDeSala, orden, vendedor]);

  // Una búsqueda que no encuentra a nadie puede ser «lo acaban de vender»: se
  // le pregunta a la caja una vez por término, cuando dejan de escribir.
  const buscado = useRef('');
  useEffect(() => {
    const termino = texto.trim();
    if (creditos == null || visibles.length || termino.length < 3 || buscado.current === termino) return undefined;
    const t = setTimeout(() => { buscado.current = termino; refrescar('busqueda'); }, 800);
    return () => clearTimeout(t);
  }, [texto, visibles.length, creditos, refrescar]);

  // El sello dice la lectura MÁS RECIENTE: la del cron o la de la pantalla.
  const leidoEl = useMemo(() => {
    const a = lectura?.corrio_el ? Date.parse(lectura.corrio_el) : 0;
    const b = leidoSala ? Date.parse(leidoSala) : 0;
    return a || b ? new Date(Math.max(a, b)).toISOString() : null;
  }, [lectura, leidoSala]);

  // Quién vendió, sacado de la propia cartera (como el portal).
  const opcionesVendedor = useMemo(() => {
    const vistos = new Map();
    for (const c of creditos || []) {
      if (c.vendedor_id == null || vistos.has(String(c.vendedor_id))) continue;
      const ficha = porId.get(String(c.vendedor_id)) ?? c.vendedor;
      vistos.set(String(c.vendedor_id), shortEmployeeName(ficha?.name ?? ''));
    }
    return [...vistos].filter(([, n]) => n).sort((a, b) => a[1].localeCompare(b[1], 'es')).map(([id, label]) => ({ id, label }));
  }, [creditos, porId]);
  const debido = visibles.reduce((t, c) => t + (Number(c.saldo) || 0), 0);
  const vencidos = conEdad.filter((c) => c.saldo > 0.004 && c.vencido).length;

  const salas = useMemo(() => (sucursales || []).filter((b) => b.name !== 'Bodega' && b.name !== 'Administracion')
    .sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const grupos = [
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'todas', onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas.map((b) => ({ id: String(b.id), label: b.name }))] }] : []),
    { id: 'vendedor', titulo: 'Vendedor', activa: vendedor, porDefecto: '', onCambiar: setVendedor,
      opciones: [{ id: '', label: 'Todos los vendedores' }, ...opcionesVendedor] },
    { id: 'orden', titulo: 'Orden', activa: orden, porDefecto: 'ANTIGUOS', onCambiar: setOrden,
      opciones: ORDEN_CARTERA.map((o) => ({ id: o.value, label: o.label })) },
  ];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Cuentas por cobrar', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Cliente, documento o monto', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {creditos ? (
          <FilaDeKpis>
            <Kpi icono="HandCoins" rotulo="Por cobrar" valor={formatMoney(debido, { decimales: 0 })} color={MARCA.verde}
              apoyo={leidoEl ? desdeLaLectura(leidoEl) : null} />
            <Kpi icono="AlertTriangle" rotulo="Pasados del plazo" valor={String(vencidos)} color={vencidos ? MARCA.ambar : MARCA.azul}
              onPress={vencidos ? () => setVer('VENCIDOS') : undefined} />
          </FilaDeKpis>
        ) : null}
        <Segmentos activa={ver} onCambiar={setVer}
          opciones={VER_CARTERA.map((v) => ({ id: v.value, label: v.value === 'DEBEN' ? 'Saldo' : v.label }))} />
        {creditos ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${visibles.length} crédito${visibles.length === 1 ? '' : 's'} · ${formatMoney(debido)}`}</Text> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {creditos == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.slice(0, cuantos).map((c) => (
          <Tarjeta key={`${c.branch_id}-${c.credito}`} c={c} sala={sala ? null : nombreDeSala.get(c.branch_id)}
            vendedor={porId.get(String(c.vendedor_id))} enAprobacion={reservados.has(`${c.branch_id}:${c.credito}`)} />
        ))}
        {visibles.length > cuantos ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande borde texto={`Ver ${Math.min(POR_PAGINA, visibles.length - cuantos)} más · quedan ${visibles.length - cuantos}`} onPress={() => setCuantos((n) => n + POR_PAGINA)} />
          </View>
        ) : null}
        {creditos && !visibles.length && !error ? (
          <View style={{ alignItems: 'center', paddingTop: 40, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>
              {texto ? 'Ningún crédito con esa búsqueda' : ver === 'VENCIDOS' ? 'Nadie se pasó del plazo' : ver === 'POR_VENCER' ? 'Nada vence esta semana' : 'Nadie debe nada'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
