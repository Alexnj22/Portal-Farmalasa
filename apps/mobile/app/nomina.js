// Nómina, NATIVO — `PayrollView`: las quincenas con su estado y su fecha de
// pago (se elige tocando la tarjeta del período), los cuatro totales del
// portal (salario ordinario A, extras y otros B, deducciones y total a pagar),
// el aviso de horas sin aprobar del período, y cada persona con su cargo y su
// líquido. Tocar a alguien abre su boleta (`boleta/[id]`).
//
// Acciones que ya viven acá, con la MISMA función del store que el portal
// (`updatePayrollPeriodStatus`) y con confirmación: Aprobar (borrador con
// renglones) y Marcar pagada (aprobada). «Todas las boletas» arma el MISMO
// papel del portal (`documentoDeBoletas`) en un PDF para compartir o imprimir,
// y se anota como egreso.
//
// También, con la llave de aprobar o editar la nómina: abrir una quincena
// (`nomina/periodo`), Generar / Regenerar con `generatePayrollEntries` (con
// confirmación y avisando antes las horas sin aprobar; regenerar respeta las
// filas ya editadas, como en el portal), editar la fila de una persona
// (mantener presionada → `nomina/fila/[id]`) y el CSV del banco
// (`csvDelBanco`, el MISMO texto que baja el portal; sin la llave de aprobar
// las cuentas salen como ****).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchUnapprovedTimesheetsCount } from '@nucleo/data/payroll';
import { registrarEgreso } from '@nucleo/data/egreso';
import { ESTADO_PLANILLA, csvDelBanco, ordenDeCargo, rotuloDePeriodo, totalesDePlanilla } from '@nucleo/utils/planilla';
import { documentoDeBoletas } from '@nucleo/utils/boletaDePapel';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
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
import { compartirPdf, imprimirPapel } from '../componentes/pdf';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const r2 = (n) => parseFloat((Number(n) || 0).toFixed(2));
const ESTADOS = [
  { id: 'ALL', label: 'Todos los estados' }, { id: 'DRAFT', label: 'Borrador' },
  { id: 'APPROVED', label: 'Aprobada' }, { id: 'PAID', label: 'Pagada' },
];

export default function Nomina() {
  const { user, getScope, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const periodos = useStaffStore((s) => s.payrollPeriods);
  const entradas = useStaffStore((s) => s.payrollEntries);
  const cargando = useStaffStore((s) => s.isLoadingPayroll);
  const fetchPayrollPeriods = useStaffStore((s) => s.fetchPayrollPeriods);
  const fetchPayrollEntries = useStaffStore((s) => s.fetchPayrollEntries);
  const updatePayrollPeriodStatus = useStaffStore((s) => s.updatePayrollPeriodStatus);
  const generatePayrollEntries = useStaffStore((s) => s.generatePayrollEntries);
  const puedeVerCuentas = !!hasPermission?.('payroll', 'can_approve');
  const todas = getScope?.('payroll') === 'ALL';
  const puedeDescargar = !!hasPermission?.('payroll_descargar');
  // Crear una quincena exige EDITAR (la policy de payroll_periods pide can_edit).
  const puedeEditar = !!hasPermission?.('payroll', 'can_edit');
  const puedeDecidir = !!(hasPermission?.('payroll', 'can_approve') || hasPermission?.('payroll', 'can_edit'));
  const [periodoId, setPeriodoId] = useState(null);
  const [estadoFiltro, setEstadoFiltro] = useState('ALL');
  const [salaElegida, setSala] = useState('ALL');
  const sala = todas ? salaElegida : String(user?.branchId ?? '');
  const [texto, setTexto] = useState('');
  const [recargando, setRecargando] = useState(false);
  const [sinAprobar, setSinAprobar] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { fetchPayrollPeriods(); }, [fetchPayrollPeriods]);
  const lista = useMemo(() => [...(periodos || [])]
    .filter((p) => estadoFiltro === 'ALL' || (p.status || 'DRAFT') === estadoFiltro)
    .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))), [periodos, estadoFiltro]);
  const periodo = lista.find((p) => p.id === periodoId) ?? lista[0] ?? null;
  useEffect(() => { if (periodo?.id) fetchPayrollEntries(periodo.id); }, [periodo?.id, fetchPayrollEntries]);

  // Las horas sin aprobar del período: si las hay, la planilla se armaría
  // sobre un dato que nadie revisó (el mismo aviso que el portal).
  useEffect(() => {
    if (!periodo?.start_date || !periodo?.end_date) { setSinAprobar(null); return undefined; }
    let vivo = true;
    setSinAprobar(null);
    fetchUnapprovedTimesheetsCount(periodo.start_date, periodo.end_date).then(({ count }) => { if (vivo) setSinAprobar(count ?? 0); });
    return () => { vivo = false; };
  }, [periodo?.id, periodo?.start_date, periodo?.end_date]);

  // La ficha VIVA de cada persona (cargo y sueldo): la copia pegada a la fila
  // puede haberse armado antes de que el arranque trajera los salarios.
  const fichaPorId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const conFicha = useMemo(() => (entradas || []).map((e) => ({ ...e, employee: { ...(e.employee || {}), ...(fichaPorId.get(String(e.employee_id)) || {}) } })), [entradas, fichaPorId]);

  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? 'Sin sala';
  const visibles = useMemo(() => conFicha
    .filter((e) => sala === 'ALL' || String(e.employee?.branchId ?? e.employee?.branch_id ?? e.branch_id) === sala)
    .filter((e) => !texto.trim() || tokenMatch(texto.trim(), e.employee?.name, e.employee?.code)), [conFicha, sala, texto]);
  const t = totalesDePlanilla(visibles);
  const totalB = visibles.reduce((s, e) => s + r2(e.subtotal_b), 0);
  const totalA = visibles.reduce((s, e) => s + r2(e.subtotal_a), 0);
  const porSala = useMemo(() => {
    const m = new Map();
    for (const e of visibles) { const k = String(e.employee?.branchId ?? e.employee?.branch_id ?? e.branch_id ?? ''); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
    return [...m.entries()].sort((a, b) => ordenDeSala(Number(a[0])) - ordenDeSala(Number(b[0])))
      .map(([k, l]) => [k, l.sort((x, y) => ordenDeCargo(x.employee) - ordenDeCargo(y.employee))]);
  }, [visibles]);
  const grupos = [
    { id: 'estado', titulo: 'Estado', activa: estadoFiltro, porDefecto: 'ALL', onCambiar: (v) => { setEstadoFiltro(v); setPeriodoId(null); }, opciones: ESTADOS },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'ALL', onCambiar: setSala,
      opciones: [{ id: 'ALL', label: 'Todas las salas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : []),
  ];
  const estadoKey = periodo?.status || 'DRAFT';
  const estado = ESTADO_PLANILLA[estadoKey] ?? null;
  const conRenglones = (entradas || []).length > 0;

  const recargar = useCallback(async () => {
    setRecargando(true);
    await fetchPayrollPeriods();
    if (periodo?.id) await fetchPayrollEntries(periodo.id);
    setRecargando(false);
  }, [fetchPayrollPeriods, fetchPayrollEntries, periodo?.id]);

  const cambiarEstado = (status) => {
    const aprobar = status === 'APPROVED';
    const aviso = aprobar && sinAprobar > 0
      ? `Hay ${sinAprobar} timesheet${sinAprobar === 1 ? '' : 's'} sin aprobar en este período. ¿Aprobarla igual?`
      : `¿Seguro que quieres ${aprobar ? 'aprobar' : 'marcar como pagada'} «${periodo.name || rotuloDePeriodo(periodo.start_date, periodo.end_date)}»?`;
    Alert.alert(aprobar ? 'Aprobar planilla' : 'Marcar como pagada', aviso, [
      { text: 'Cancelar', style: 'cancel' },
      { text: aprobar ? 'Aprobar' : 'Marcar pagada', onPress: async () => {
        setOcupado(true);
        trabajando(aprobar ? 'Aprobando…' : 'Marcando como pagada…');
        try {
          await updatePayrollPeriodStatus(periodo.id, status);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Listo', `Planilla ${aprobar ? 'aprobada' : 'marcada como pagada'}.`);
          await fetchPayrollPeriods();
        } catch (e) {
          fallo('No se pudo actualizar el estado', mensajeAmigable(e, 'Intenta de nuevo.'));
        } finally { setOcupado(false); }
      } },
    ]);
  };

  // Generar (o regenerar) la planilla del período. Escribe todas las filas:
  // confirmación siempre, y si hay horas sin aprobar se avisa ANTES, porque
  // la planilla saldría armada sobre un dato que nadie revisó.
  const generar = () => {
    const re = conRenglones;
    const nombre = periodo.name || rotuloDePeriodo(periodo.start_date, periodo.end_date);
    const alcance = sala === 'ALL' ? 'todas las salas' : nombreSala(sala);
    const avisoHoras = sinAprobar > 0 ? `\n\nHay ${sinAprobar} timesheet${sinAprobar === 1 ? '' : 's'} sin aprobar en este período.` : '';
    Alert.alert(re ? 'Regenerar la planilla' : 'Generar la planilla',
      `«${nombre}», ${alcance}. ${re ? 'Se recalculan las filas que no se editaron a mano.' : 'Se arma una fila por persona con sus horas aprobadas.'}${avisoHoras}`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: re ? 'Regenerar' : 'Generar', style: sinAprobar > 0 ? 'destructive' : 'default', onPress: async () => {
          setOcupado(true);
          trabajando(re ? 'Regenerando…' : 'Generando…');
          try {
            const r = await generatePayrollEntries(periodo.id, sala === 'ALL' ? null : sala);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            if (r?.warnings?.length) {
              listo('Planilla generada con advertencias', `${r.warnings.length} persona(s) sin salario base: ${r.warnings.slice(0, 2).join(', ')}${r.warnings.length > 2 ? ' y más…' : ''}`);
            } else listo('Planilla generada', nombre);
          } catch (e) {
            fallo('No se pudo generar', mensajeAmigable(e, 'Intenta de nuevo.'));
          } finally { setOcupado(false); }
        } },
      ]);
  };

  // El CSV del banco: el mismo texto del portal (`csvDelBanco`), compartido
  // con la hoja del sistema y anotado como la salida más sensible que es.
  const csvBanco = async () => {
    if (!visibles.length || !periodo) return;
    try {
      const nombre = `planilla-banco-${String(periodo.name || rotuloDePeriodo(periodo.start_date, periodo.end_date)).replace(/[\\/:*?"<>|]+/g, '-')}.csv`;
      const f = new File(Paths.cache, nombre);
      if (f.exists) f.delete();
      f.create();
      f.write(csvDelBanco(visibles, { cuentasVisibles: puedeVerCuentas }));
      const r = await Share.share({ url: f.uri, title: nombre });
      if (r.action === Share.sharedAction) {
        registrarEgreso('planilla_banco', { formato: 'csv', filas: visibles.length, detalle: { periodo: periodo.name || null, cuentas_visibles: puedeVerCuentas, via: 'app' } });
      }
    } catch (e) { fallo('No se pudo armar el CSV', e?.message || ''); }
  };

  const papeles = () => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Todas las boletas', 'CSV del banco', 'Cancelar'], cancelButtonIndex: 2 },
      (i) => { if (i === 0) boletas(); else if (i === 1) csvBanco(); },
    );
  };

  const boletas = () => {
    if (!visibles.length || !periodo) return;
    const html = () => documentoDeBoletas(visibles, periodo, sucursales || []);
    const anotar = (formato) => registrarEgreso('nomina', { formato, filas: visibles.length, detalle: { periodo: periodo.id, sala: sala === 'ALL' ? null : sala, via: 'app' } });
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `${visibles.length} boleta${visibles.length === 1 ? '' : 's'}`, options: ['Compartir PDF', 'Imprimir', 'Cancelar'], cancelButtonIndex: 2 },
      async (i) => {
        try {
          if (i === 0) { if (await compartirPdf({ html: html(), nombre: `Boletas ${rotuloDePeriodo(periodo.start_date, periodo.end_date)}` })) anotar('pdf'); }
          else if (i === 1) { await imprimirPapel(html()); anotar('impresion'); }
        } catch (e) { fallo('No se pudo armar el papel', e?.message || ''); }
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Nómina', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre o código', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={puedeDescargar && conRenglones ? { icono: 'printer', etiqueta: 'Boletas y banco', onPress: papeles }
        : puedeEditar ? { icono: 'plus', etiqueta: 'Nueva quincena', onPress: () => router.push('/nomina/periodo') } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={recargar} />}>
        <FiltrosActivos grupos={grupos} />

        {/* Las quincenas, como la columna «Períodos» del portal: estado y pago. */}
        {lista.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
            {lista.slice(0, 24).map((p) => {
              const activo = p.id === periodo?.id;
              const e = ESTADO_PLANILLA[p.status || 'DRAFT'] ?? ESTADO_PLANILLA.DRAFT;
              return (
                <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setPeriodoId(p.id); }}
                  style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                  <Vidrio radio={16} interactivo tinte={activo ? 'rgba(0,82,204,0.35)' : undefined}>
                    <View style={{ padding: 12, width: 190, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{p.name || rotuloDePeriodo(p.start_date, p.end_date)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.pay_date ? `Pago: ${fechaTexto(p.pay_date, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Sin fecha de pago'}</Text>
                      <View style={{ flexDirection: 'row' }}><Pildora texto={e.label} color={colorDeVariante(e.variante)} /></View>
                    </View>
                  </Vidrio>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {periodo ? (
          <View style={{ marginHorizontal: 20, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{periodo.name || rotuloDePeriodo(periodo.start_date, periodo.end_date)}</Text>
              {estado ? <Pildora texto={estado.label} color={colorDeVariante(estado.variante)} /> : null}
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {[`${fechaTexto(periodo.start_date, { day: 'numeric', month: 'short' })} → ${fechaTexto(periodo.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}`,
                periodo.pay_date ? `pago ${fechaTexto(periodo.pay_date, { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ) : null}

        {periodo && sinAprobar > 0 ? (
          <Pressable onPress={() => router.push('/auditoria-de-tiempos')} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={16} tinte="rgba(247,144,9,0.18)">
              <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>
                  {`${sinAprobar} timesheet${sinAprobar === 1 ? '' : 's'} sin aprobar en este período`}
                </Text>
                <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>Revisar ›</Text>
              </View>
            </Vidrio>
          </Pressable>
        ) : null}

        {periodo && conRenglones ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Landmark" rotulo="Sal. ordinario" valor={formatMoney(totalA)} color={MARCA.azulClaro} apoyo="subtotal A" />
              <Kpi icono="TrendingUp" rotulo="Extras / Otros" valor={formatMoney(totalB)} color={MARCA.violetaClaro} apoyo="subtotal B" />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="DollarSign" rotulo="Deducciones" valor={formatMoney(t.descuentos)} color={MARCA.rojo} apoyo="ISSS, AFP, renta y otros" />
              <Kpi icono="Wallet" rotulo="Total a pagar" valor={formatMoney(t.liquido)} color={MARCA.verde} apoyo={`${t.personas} persona${t.personas === 1 ? '' : 's'}`} />
            </FilaDeKpis>
          </>
        ) : null}

        {periodo && puedeDecidir && (estadoKey === 'DRAFT' || estadoKey === 'APPROVED') ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto={conRenglones ? 'Regenerar la planilla' : 'Generar la planilla'} borde color={MARCA.azulClaro} onPress={generar} deshabilitado={ocupado} />
          </View>
        ) : null}

        {periodo && puedeDecidir && conRenglones && (estadoKey === 'DRAFT' || estadoKey === 'APPROVED') ? (
          <View style={{ marginHorizontal: 16 }}>
            {estadoKey === 'DRAFT'
              ? <BotonGrande texto="Aprobar planilla" color={MARCA.verde} onPress={() => cambiarEstado('APPROVED')} deshabilitado={ocupado} />
              : <BotonGrande texto="Marcar como pagada" onPress={() => cambiarEstado('PAID')} deshabilitado={ocupado} />}
          </View>
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
                      onLongPress={puedeDecidir && estadoKey !== 'PAID' ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); router.push({ pathname: '/nomina/fila/[id]', params: { id: String(e.id) } }); } : undefined}
                      delayLongPress={350}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0, opacity: pressed ? 0.7 : 1 })}>
                      <Avatar empleado={e.employee ?? { name: '?' }} tamano={36} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{e.employee?.name ? shortEmployeeName(e.employee) : 'Sin ficha'}</Text>
                        {e.employee?.role ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{e.employee.role}</Text> : null}
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                          {[`${e.days_worked ?? '—'} días`, Number(e.subtotal_b) ? `extras ${formatMoney(e.subtotal_b)}` : null, `desc. ${formatMoney(e.total_deductions)}`].filter(Boolean).join(' · ')}
                        </Text>
                        {e.status === 'EDITED' ? <Text style={{ color: MARCA.ambar, fontSize: 11, fontWeight: '700' }}>Editada</Text> : null}
                      </View>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(e.net_pay)}</Text>
                    </Pressable>
                  ))}
                </View>
              </Vidrio>
            </View>
          </View>
        ))}
        {periodos && !periodo ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{estadoFiltro === 'ALL' ? 'Todavía no hay planillas' : 'Ninguna planilla en ese estado'}</Text> : null}
        {periodo && !cargando && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Esta planilla todavía no tiene personas</Text> : null}
        {puedeDecidir && periodo ? (
          <View style={{ marginHorizontal: 16, marginTop: 8, gap: 10 }}>
            {conRenglones && estadoKey !== 'PAID' ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Mantén presionada a una persona para editar su fila.</Text> : null}
            <BotonGrande texto="Nueva quincena" borde color={MARCA.azulClaro} onPress={() => router.push('/nomina/periodo')} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
