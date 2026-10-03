// Conteos de inventario, NATIVO — la lista del portal (`ConteoInventarioView`):
// los conteos de mi sala (o de todas), los abiertos primero, con su avance.
// Tocar uno abre la pantalla de contar. Crear un conteo, aprobarlo y registrar
// el ajuste se hacen en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ALCANCE_CONTEO as ALCANCE, ESTADO_CONTEO } from '@nucleo/utils/conteoDeInventario';
import { fechaTexto } from '@nucleo/utils/fecha';
import Segmentos from '../componentes/Segmentos';
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
  const [vista, setVista] = useState('abiertos');
  const [recargando, setRecargando] = useState(false);
  useFocusEffect(useCallback(() => { fetchConteosInventario(); }, [fetchConteosInventario]));

  const nombreDeSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}`;
  const mios = useMemo(() => (conteos || []).filter((c) => todas || String(c.branch_id) === String(user?.branchId)), [conteos, todas, user?.branchId]);
  const visibles = useMemo(() => mios.filter((c) => vista === 'todos' || ['BORRADOR', 'EN_PROGRESO'].includes(c.status))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [mios, vista]);
  const abiertos = mios.filter((c) => ['BORRADOR', 'EN_PROGRESO'].includes(c.status)).length;
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
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Conteos', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await fetchConteosInventario(); setRecargando(false); }} />}>
        <Segmentos activa={vista} onCambiar={setVista}
          opciones={[{ id: 'abiertos', label: abiertos ? `Abiertos · ${abiertos}` : 'Abiertos' }, { id: 'todos', label: 'Todos' }]} />
        {cargando && !mios.length ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((c) => {
          const r = resumenes[c.id];
          const total = Number(r?.total_items ?? c.total_items) || 0;
          const contados = Number(r?.contados ?? c.total_contados) || 0;
          const pct = total ? Math.round((contados / total) * 100) : 0;
          return (
            <Pressable key={c.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/conteo/[id]', params: { id: String(c.id) } }); }}
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
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {!cargando && !visibles.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {vista === 'abiertos' ? 'No hay conteos abiertos' : 'Sin conteos'}
          </Text>
        ) : null}
        {hasPermission('conteo_inventario', 'can_edit') ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Crear o aprobar un conteo (portal)" borde color={MARCA.azulClaro}
              onPress={() => router.push({ pathname: '/portal', params: { ruta: '/conteo-inventario', nombre: 'Conteo de inventario' } })} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
