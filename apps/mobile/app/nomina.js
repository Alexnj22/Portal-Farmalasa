// Nómina, NATIVO — `PayrollView` para consultarla: el período (quincena), su
// estado, lo que se paga en total y por sala, y cada persona con su líquido.
// Tocar a alguien abre su boleta (`boleta/[id]`) con ingresos, descuentos y
// el líquido en letras.
//
// Generar, editar, aprobar, pagar e imprimir siguen en el portal. Lo puro sale
// del núcleo (`planilla`): orden por cargo, estado, período, monto en letras.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ESTADO_PLANILLA, ordenDeCargo, rotuloDePeriodo, totalesDePlanilla } from '@nucleo/utils/planilla';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';

export default function Nomina() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const periodos = useStaffStore((s) => s.payrollPeriods);
  const entradas = useStaffStore((s) => s.payrollEntries);
  const cargando = useStaffStore((s) => s.isLoadingPayroll);
  const fetchPayrollPeriods = useStaffStore((s) => s.fetchPayrollPeriods);
  const fetchPayrollEntries = useStaffStore((s) => s.fetchPayrollEntries);
  const todas = getScope?.('payroll') === 'ALL';
  const [periodoId, setPeriodoId] = useState(null);
  const [salaElegida, setSala] = useState('ALL');
  const sala = todas ? salaElegida : String(user?.branchId ?? '');
  const [texto, setTexto] = useState('');
  const [recargando, setRecargando] = useState(false);

  useEffect(() => { fetchPayrollPeriods(); }, [fetchPayrollPeriods]);
  const lista = useMemo(() => [...(periodos || [])].sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))), [periodos]);
  const periodo = lista.find((p) => p.id === periodoId) ?? lista[0] ?? null;
  useEffect(() => { if (periodo?.id) fetchPayrollEntries(periodo.id); }, [periodo?.id, fetchPayrollEntries]);

  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? 'Sin sala';
  const visibles = useMemo(() => (entradas || [])
    .filter((e) => sala === 'ALL' || String(e.employee?.branchId ?? e.employee?.branch_id ?? e.branch_id) === sala)
    .filter((e) => !texto.trim() || tokenMatch(texto.trim(), e.employee?.name, e.employee?.code)), [entradas, sala, texto]);
  const t = totalesDePlanilla(visibles);
  const porSala = useMemo(() => {
    const m = new Map();
    for (const e of visibles) { const k = String(e.employee?.branchId ?? e.employee?.branch_id ?? e.branch_id ?? ''); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
    return [...m.entries()].sort((a, b) => ordenDeSala(Number(a[0])) - ordenDeSala(Number(b[0])))
      .map(([k, l]) => [k, l.sort((x, y) => ordenDeCargo(x.employee) - ordenDeCargo(y.employee))]);
  }, [visibles]);
  const grupos = [
    { id: 'periodo', titulo: 'Quincena', activa: String(periodo?.id ?? ''), porDefecto: String(lista[0]?.id ?? ''), onCambiar: (v) => setPeriodoId(Number(v) || v),
      opciones: lista.slice(0, 24).map((p) => ({ id: String(p.id), label: rotuloDePeriodo(p.start_date, p.end_date) })) },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'ALL', onCambiar: setSala,
      opciones: [{ id: 'ALL', label: 'Todas las salas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : []),
  ];
  const estado = ESTADO_PLANILLA[periodo?.status] ?? null;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Nómina', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre o código', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await fetchPayrollPeriods(); if (periodo?.id) await fetchPayrollEntries(periodo.id); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {periodo ? (
          <View style={{ marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{rotuloDePeriodo(periodo.start_date, periodo.end_date)}</Text>
            {estado ? <Pildora texto={estado.label} color={colorDeVariante(estado.variante)} /> : null}
          </View>
        ) : null}
        {periodo ? (
          <FilaDeKpis>
            <Kpi icono="Wallet" rotulo="Líquido a pagar" valor={formatMoney(t.liquido)} color={MARCA.verde} apoyo={`${t.personas} personas`} />
            <Kpi icono="DollarSign" rotulo="Descuentos" valor={formatMoney(t.descuentos)} color={MARCA.ambar} apoyo={`ordinario ${formatMoney(t.ordinario)}`} />
          </FilaDeKpis>
        ) : null}
        {(cargando && !(entradas || []).length) || periodos == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : porSala.map(([k, l]) => (
          <View key={k} style={{ gap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>
              {`${nombreSala(k)} · ${formatMoney(l.reduce((s, e) => s + Number(e.net_pay || 0), 0))}`}
            </Text>
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 12, gap: 10 }}>
                  {l.map((e, i) => (
                    <Pressable key={e.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/boleta/[id]', params: { id: String(e.id) } }); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                      <Avatar empleado={e.employee ?? { name: '?' }} tamano={34} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{e.employee ? shortEmployeeName(e.employee) : 'Sin ficha'}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${e.days_worked ?? '—'} días · desc. ${formatMoney(e.total_deductions)}`}</Text>
                      </View>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{formatMoney(e.net_pay)}</Text>
                    </Pressable>
                  ))}
                </View>
              </Vidrio>
            </View>
          </View>
        ))}
        {periodos && !periodo ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Todavía no hay planillas</Text> : null}
        {periodo && !cargando && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Esta planilla todavía no tiene personas</Text> : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Generar, aprobar e imprimir (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/nomina', nombre: 'Nómina' } })} />
        </View>
      </ScrollView>
    </>
  );
}
