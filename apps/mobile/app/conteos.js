// Conteos de inventario, NATIVO — la lista del portal (`ConteoInventarioView`):
// los conteos de mi sala (o de todas) con su avance, ítems, diferencias y valor
// neto, y arriba las cuatro tarjetas del portal —Conteos, Abiertos, Por
// aprobar, Sin ajustar—, que filtran al tocarlas. Las cuentas son del núcleo
// (`resumenDeConteos`, `FOCOS_CONTEO`). Tocar uno abre la pantalla de contar.
// «Nuevo conteo» abre `conteo/nuevo`; aprobar, recontar y registrar el ajuste
// viven en la pantalla del conteo.
//
// Como el portal: buscador (por sucursal o alcance), filtro de sucursal para
// quien ve todas, y eliminar un conteo manteniéndolo presionado — con el
// permiso propio, o mientras no esté finalizado (la base lo vuelve a decidir).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ALCANCE_CONTEO as ALCANCE, ESTADO_CONTEO, faltaAjusteDelConteo, FOCOS_CONTEO, resumenDeConteos, valorNetoDelConteo } from '@nucleo/utils/conteoDeInventario';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const COLOR = { BORRADOR: colorSistema.texto2, EN_PROGRESO: MARCA.ambar, FINALIZADO: MARCA.azulClaro, CERRADO: MARCA.verde };

export default function Conteos() {
  const { user, getScope, hasPermission } = useAuth();
  const conteos = useStaffStore((s) => s.conteosInventario);
  const cargando = useStaffStore((s) => s.conteosInventarioLoading);
  const fetchConteosInventario = useStaffStore((s) => s.fetchConteosInventario);
  const fetchConteoResumen = useStaffStore((s) => s.fetchConteoResumen);
  // Los totales de la fila se llenan al finalizar: el avance de uno ABIERTO sale del resumen en vivo.
  const [resumenes, setResumenes] = useState({});
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('conteo_inventario') === 'ALL';
  // Por defecto, lo abierto: es lo que se viene a hacer al teléfono.
  const [foco, setFoco] = useState('ABIERTOS');
  const verMontos = hasPermission('conteo_inventario_ver_montos');
  const [recargando, setRecargando] = useState(false);
  const [salaFiltro, setSalaFiltro] = useState('todas');
  const [texto, setTexto] = useState('');
  const busca = useTextoRebotado(texto).trim();
  const eliminarConteoInventario = useStaffStore((s) => s.eliminarConteoInventario);
  const puedeEditar = hasPermission('conteo_inventario', 'can_edit');
  const puedeBorrar = (c) => puedeEditar && (hasPermission('conteo_inventario_eliminar') || ['BORRADOR', 'EN_PROGRESO'].includes(c.status));
  useFocusEffect(useCallback(() => { fetchConteosInventario(); }, [fetchConteosInventario]));

  const nombreDeSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}`;
  const mios = useMemo(() => (conteos || []).filter((c) => (todas ? (salaFiltro === 'todas' || String(c.branch_id) === salaFiltro) : String(c.branch_id) === String(user?.branchId))),
    [conteos, todas, salaFiltro, user?.branchId]);
  const visibles = useMemo(() => mios.filter((c) => foco === 'TODOS' || FOCOS_CONTEO[foco](c))
    .filter((c) => !busca || tokenMatch(busca, c.branches?.name ?? nombreDeSala(c.branch_id), ALCANCE[c.scope_type], c.scope_filter, ESTADO_CONTEO[c.status]))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [mios, foco, busca]);
  const salasConConteo = useMemo(() => [...new Set((conteos || []).map((c) => String(c.branch_id)))], [conteos]);
  const grupos = todas ? [{ id: 'sala', titulo: 'Sucursal', activa: salaFiltro, porDefecto: 'todas', onCambiar: setSalaFiltro,
    opciones: [{ id: 'todas', label: 'Todas' }, ...salasConConteo.map((b) => ({ id: b, label: nombreDeSala(b) }))] }] : [];
  const eliminar = (c) => {
    if (!puedeBorrar(c)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert('¿Eliminar este conteo?', `Se borra el conteo de ${nombreDeSala(c.branch_id)} del ${fechaTexto(c.created_at, { day: 'numeric', month: 'short', year: 'numeric' })} (${ESTADO_CONTEO[c.status] ?? c.status}) con todos sus renglones y el historial de quién contó cada uno. No se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        trabajando('Eliminando…');
        try {
          const r = await eliminarConteoInventario(c.id);
          listo('Conteo eliminado', `Se borraron ${r?.total_items ?? 0} renglón(es).`);
          fetchConteosInventario();
        } catch (e) { fallo('No se pudo eliminar', mensajeAmigable(e)); }
      } },
    ]);
  };
  const resumen = useMemo(() => resumenDeConteos(mios), [mios]);
  const alternar = (f) => setFoco((x) => (x === f ? 'TODOS' : f));
  useEffect(() => {
    const ids = mios.filter((c) => ['BORRADOR', 'EN_PROGRESO'].includes(c.status)).map((c) => c.id);
    if (!ids.length) return undefined;
    let vivo = true;
    Promise.all(ids.map((cid) => fetchConteoResumen(cid).then((r) => [cid, r]).catch(() => [cid, null])))
      .then((pares) => { if (vivo) setResumenes(Object.fromEntries(pares)); });
    return () => { vivo = false; };
  }, [mios, fetchConteoResumen]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Conteos', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Sucursal o alcance', hideWhenScrolling: false, onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') } }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await fetchConteosInventario(); setRecargando(false); }} />}>
        <FilaDeKpis>
          <Kpi icono="ClipboardCheck" rotulo="Conteos" valor={resumen.total.toLocaleString('es-SV')} apoyo={foco === 'TODOS' ? 'viendo todos' : 'ver todos'}
            color={MARCA.azulClaro} onPress={() => setFoco('TODOS')} />
          <Kpi icono="Clock" rotulo="Abiertos" valor={String(resumen.abiertos)} apoyo={foco === 'ABIERTOS' ? 'filtrando' : 'contándose ahora'} pide={resumen.abiertos > 0}
            color={MARCA.ambar} onPress={() => alternar('ABIERTOS')} />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="FileCheck" rotulo="Por aprobar" valor={String(resumen.porAprobar)} apoyo={foco === 'POR_APROBAR' ? 'filtrando' : 'esperan otra firma'} pide={resumen.porAprobar > 0}
            color={MARCA.azulClaro} onPress={() => alternar('POR_APROBAR')} />
          <Kpi icono="AlertTriangle" rotulo="Sin ajustar" valor={String(resumen.sinAjuste)} apoyo={foco === 'SIN_AJUSTE' ? 'filtrando' : 'el stock sin corregir'} pide={resumen.sinAjuste > 0}
            color={MARCA.rojo} onPress={() => alternar('SIN_AJUSTE')} />
        </FilaDeKpis>
        <FiltrosActivos grupos={grupos} />
        {visibles.some(puedeBorrar) ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>Mantén presionado un conteo para eliminarlo.</Text> : null}
        {cargando && !mios.length ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((c) => {
          const r = resumenes[c.id];
          const total = Number(r?.total_items ?? c.total_items) || 0;
          const contados = Number(r?.contados ?? c.total_contados) || 0;
          const pct = total ? Math.round((contados / total) * 100) : 0;
          return (
            <Pressable key={c.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/conteo/[id]', params: { id: String(c.id) } }); }}
              onLongPress={puedeBorrar(c) ? () => eliminar(c) : undefined} delayLongPress={400}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={20} interactivo>
                <View style={{ padding: 14, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{nombreDeSala(c.branch_id)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {[fechaTexto(c.created_at, { day: 'numeric', month: 'short', year: 'numeric' }), ALCANCE[c.scope_type] ?? null, c.scope_filter || null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Pildora texto={ESTADO_CONTEO[c.status] ?? c.status} color={COLOR[c.status] ?? colorSistema.texto2} />
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                    <View style={{ width: `${pct}%`, height: 6, backgroundColor: pct >= 100 ? MARCA.verde : MARCA.azulClaro }} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {`${contados.toLocaleString('es-SV')} de ${total.toLocaleString('es-SV')} renglones contados (${pct}%)${Number(r?.con_diferencia ?? c.total_diferencias) ? ` · ${r?.con_diferencia ?? c.total_diferencias} con diferencia` : ''}`}
                  </Text>
                  {/* El valor neto se sella al cerrar: en uno abierto todavía no existe. */}
                  {verMontos && !['BORRADOR', 'EN_PROGRESO'].includes(c.status) && (c.valor_sobrante != null || c.valor_faltante != null) ? (() => {
                    const neto = valorNetoDelConteo(c);
                    return (
                      <Text style={{ color: neto < 0 ? MARCA.rojo : neto > 0 ? MARCA.azulClaro : colorSistema.texto2, fontSize: 14, fontWeight: '700' }}>
                        {`Valor neto ${formatMoney(neto)}`}
                        <Text style={{ color: colorSistema.texto2, fontWeight: '400', fontSize: 12 }}>{`  faltante ${formatMoney(c.valor_faltante || 0)} · sobrante ${formatMoney(c.valor_sobrante || 0)}`}</Text>
                      </Text>
                    );
                  })() : null}
                  {faltaAjusteDelConteo(c) ? <Pildora texto="Falta registrar el ajuste" color={MARCA.rojo} /> : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {!cargando && !visibles.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {foco === 'TODOS' ? 'Sin conteos' : 'Nada pendiente aquí'}
          </Text>
        ) : null}
        {hasPermission('conteo_inventario', 'can_edit') ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Nuevo conteo" color={MARCA.azul}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/conteo/nuevo'); }} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
