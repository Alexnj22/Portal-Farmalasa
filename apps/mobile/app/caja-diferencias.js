// Diferencias de caja, NATIVO — la pestaña «Diferencias» de Efectivo del
// portal (`DiasConDiferencia`): qué días tuvieron faltante o sobrante, cómo
// quedó cada uno y qué falta hacer. La unidad es el DÍA, no el corte: lo
// primero que se lee es cómo cerró. Faltantes y sobrantes no se restan entre
// sí (LA REGLA de `diferenciasDeCaja`), por eso van en dos vistas.
//
// Los días, su estado, el desglose (abonado, con causa, por cobrar, sin
// resolver) y el orden por urgencia salen del núcleo (`useDiasConDiferencia`,
// `porSigno`, `desgloseDelDia`, `ordenarDias`), igual que en el portal.
// Tocar un día abre su ficha con los cortes que no cuadraron.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import useDiasConDiferencia from '@nucleo/hooks/useDiasConDiferencia';
import {
  desgloseDelDia, diaEnFiltro, diaEnMes, mesesDeLosDias, ordenarDias, pendientesDeRegistrar, porSigno, responsablesDelDia, resumenDeDias,
} from '@nucleo/utils/diferenciasDeCaja';
import { etiquetaMes, fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
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
import { BarraDelDia, ESTADO_DIF, montoDelDia } from '../componentes/cortes/diferencias';

export default function CajaDiferencias() {
  const { user, getScope, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('cortes_caja') === 'ALL';
  const miSala = String(user?.branchId ?? user?.branch_id ?? '');
  const [signo, setSigno] = useState('falta');
  const [filtro, setFiltro] = useState('PENDIENTES');
  const [mes, setMes] = useState(() => hoySV().slice(0, 7));
  const [salaElegida, setSala] = useState('todas');
  const [recargando, setRecargando] = useState(false);
  const { dias, resoluciones, cargando, error, recargar } = useDiasConDiferencia({ activo: true, hasta: hoySV() });
  const puedeAnotar = hasPermission?.('cortes_caja_resolver');
  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));
  // «Sin faltantes» sólo después de haber leído: antes de la primera lectura la
  // lista vacía no dice nada.
  const [vioCargar, setVioCargar] = useState(false);
  useEffect(() => { if (cargando) setVioCargar(true); }, [cargando]);
  const leyo = (vioCargar && !cargando) || dias.length > 0 || !!error;

  const sala = todas ? (salaElegida === 'todas' ? '' : salaElegida) : miSala;
  const nombreDeSala = useMemo(() => new Map((sucursales || []).map((b) => [String(b.id), b.name])), [sucursales]);
  const delMes = useMemo(() => porSigno(dias, signo)
    .filter((d) => !sala || String(d.branch_id) === String(sala))
    .filter((d) => diaEnMes(d, mes)), [dias, signo, sala, mes]);
  const resumen = useMemo(() => resumenDeDias(delMes), [delMes]);
  const porAnotar = useMemo(() => pendientesDeRegistrar(resoluciones, { sala }), [resoluciones, sala]);
  const visibles = useMemo(() => ordenarDias(delMes.filter((d) => diaEnFiltro(d, filtro))), [delMes, filtro]);

  const meses = useMemo(() => {
    const m = mesesDeLosDias(dias);
    if (!m.includes(hoySV().slice(0, 7))) m.unshift(hoySV().slice(0, 7));
    return m;
  }, [dias]);
  const salas = useMemo(() => [...(sucursales || [])].filter((b) => b.name !== 'Administracion')
    .sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const grupos = [
    { id: 'mes', titulo: 'Mes', activa: mes, porDefecto: hoySV().slice(0, 7), onCambiar: setMes,
      opciones: [...meses.map((m) => ({ id: m, label: etiquetaMes(m) })), { id: 'TODOS', label: 'Todos los meses' }] },
    { id: 'estado', titulo: 'Estado', activa: filtro, porDefecto: 'PENDIENTES', onCambiar: setFiltro,
      opciones: [{ id: 'PENDIENTES', label: 'Lo pendiente' }, { id: 'TODOS', label: 'Todos los días' },
        ...Object.entries(ESTADO_DIF).map(([k, [l]]) => ({ id: k, label: l }))] },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'todas', onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas.map((b) => ({ id: String(b.id), label: b.name }))] }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Diferencias', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await recargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {puedeAnotar && porAnotar.length ? (
          <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/asentar-diferencias'); }} style={({ pressed }) => ({ marginHorizontal: 16, opacity: pressed ? 0.55 : 1 })}>
            <Vidrio radio={18} interactivo tinte="rgba(52,120,246,0.14)">
              <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${porAnotar.length} ${porAnotar.length === 1 ? 'movimiento' : 'movimientos'} por anotar en el sistema`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Dinero que ya entró o salió del cajón por una diferencia.</Text>
                </View>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Anotar ›</Text>
              </View>
            </Vidrio>
          </Pressable>
        ) : null}
        <Segmentos activa={signo} onCambiar={(v) => { setSigno(v); setFiltro(v === 'sobra' ? 'TODOS' : 'PENDIENTES'); }}
          opciones={[{ id: 'falta', label: 'Faltantes' }, { id: 'sobra', label: 'Sobrantes' }]} />
        {!cargando || dias.length ? (
          signo === 'falta' ? (
            <FilaDeKpis>
              <Kpi icono="AlertTriangle" rotulo="Sin resolver" valor={String(resumen.sin_resolver)} color={resumen.sin_resolver ? MARCA.rojo : MARCA.verde}
                onPress={() => setFiltro('sin_resolver')} />
              <Kpi icono="HandCoins" rotulo="Por cobrar" valor={formatMoney(resumen.saldo)} color={MARCA.ambar}
                apoyo={`${resumen.con_saldo} día${resumen.con_saldo === 1 ? '' : 's'}`} onPress={() => setFiltro('con_saldo')} />
            </FilaDeKpis>
          ) : (
            <FilaDeKpis>
              <Kpi icono="Archive" rotulo="Acumulado" valor={formatMoney(resumen.montoAcumulado)} color={MARCA.ambar}
                apoyo="sobrantes sin causa" onPress={() => setFiltro('acumulado')} />
              <Kpi icono="Clock" rotulo="Por confirmar" valor={String(resumen.por_confirmar)} color={MARCA.violeta}
                onPress={() => setFiltro('por_confirmar')} />
            </FilaDeKpis>
          )
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="No se pudieron leer los días con diferencia." /></View> : null}
        {!leyo && !dias.length ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((d) => {
          const [estado, color] = ESTADO_DIF[d.estadoDif] ?? ESTADO_DIF.resuelto;
          const desglose = desgloseDelDia(d, signo);
          const personas = signo === 'sobra' ? [] : responsablesDelDia(d);
          return (
            <Pressable key={`${d.branch_id}|${d.fecha}`}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/caja-dia', params: { sala: String(d.branch_id), fecha: d.fecha, signo } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={20} interactivo>
                <View style={{ padding: 14, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{nombreDeSala.get(String(d.branch_id)) ?? `Sala ${d.branch_id}`}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fechaTexto(d.fecha, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
                    </View>
                    <Pildora texto={estado} color={color} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={{ color: signo === 'sobra' ? MARCA.ambar : MARCA.rojo, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(montoDelDia(d, signo))}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{signo === 'sobra' ? 'sobraron' : `faltaron · recuperado ${formatMoney(desglose.cubierto)} (${desglose.pct}%)`}</Text>
                  </View>
                  <BarraDelDia desglose={desglose} signo={signo} />
                  {signo === 'falta' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {personas.slice(0, 4).map((p) => <Avatar key={p.employee_id} empleado={{ name: p.nombre }} tamano={24} />)}
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, flex: 1 }}>
                        {personas.length ? personas.slice(0, 2).map((p) => shortEmployeeName({ name: p.nombre })).join(', ') + (personas.length > 2 ? ` y ${personas.length - 2} más` : '') : 'Sin responsables asignados'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {leyo && !cargando && !visibles.length && !error ? (
          <View style={{ alignItems: 'center', paddingTop: 40, gap: 6, marginHorizontal: 24 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{signo === 'sobra' ? 'Sin sobrantes' : 'Sin faltantes pendientes'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>
              {signo === 'sobra' ? 'Ningún corte quedó arriba de lo esperado.' : 'Todos tienen su causa, o están pagados y anotados en el sistema.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
