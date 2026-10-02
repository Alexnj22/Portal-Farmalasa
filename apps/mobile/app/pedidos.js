// Pedidos a sucursales, NATIVO — lo que la SALA hace en «Pedidos» del portal
// (34 personas al mes): ver en qué va el pedido que le manda Bodega, CONFIRMAR
// QUE LLEGÓ (`app/pedido/llegada.js`) y CONTARLO hoja por hoja
// (`app/pedido/recibir.js`). La etapa sale de `getBranchStage` del núcleo, la
// misma del tablero del portal.
//
// Con alcance de una sala se ven sólo los suyos; con alcance todas, la sala se
// elige en el menú de filtros. Lo de Bodega (generar, preparar, rutas,
// métricas, reglas) sigue en el portal.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchPedidosEnCurso } from '@nucleo/data/pedidos';
import { getBranchStage } from '@nucleo/utils/tableroDePedidos';
import { BRANCH_A_ERP, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { fechaTexto } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pasos, Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const ETAPA = {
  sin_iniciar: ['En cola', colorSistema.texto2], preparando: ['Preparando', MARCA.azulClaro], pausado: ['En pausa', MARCA.ambar],
  preparado: ['Listo para salir', MARCA.azulClaro], transito: ['En camino', MARCA.azulClaro], contando: ['Por contar', MARCA.ambar], erp: ['Recibido', MARCA.verde],
};
const PASOS = [
  { id: 'preparando', rotulo: 'Preparando' }, { id: 'transito', rotulo: 'En camino' },
  { id: 'contando', rotulo: 'Llegó' }, { id: 'erp', rotulo: 'Recibido' },
];
const paso = (e) => (e === 'sin_iniciar' || e === 'pausado' || e === 'preparado' ? 'preparando' : e);

export default function Pedidos() {
  const { user, hasPermission, getScope } = useAuth();
  const todas = getScope?.('pedidos') === 'ALL';
  const puede = hasPermission('pedidos', 'can_edit');
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [salaElegida, setSala] = useState('todas');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchPedidosEnCurso();
    setError(e ? 'No se pudieron cargar los pedidos.' : null);
    setFilas(data ?? []);
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const visibles = useMemo(() => (filas || [])
    .filter((r) => (todas ? (salaElegida === 'todas' || String(r.erp_sucursal_id) === salaElegida) : Number(r.erp_sucursal_id) === Number(miErp)))
    .sort((a, b) => ERP_ORDEN.indexOf(Number(a.erp_sucursal_id)) - ERP_ORDEN.indexOf(Number(b.erp_sucursal_id)) || (b.numero ?? 0) - (a.numero ?? 0)),
  [filas, todas, salaElegida, miErp]);

  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'todas', onCambiar: setSala,
    opciones: [{ id: 'todas', label: 'Todas las salas' }, ...ERP_ORDEN.map((e) => ({ id: String(e), label: ERP_NAMES[e] }))] }] : [];

  const ir = (pathname, r) => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname, params: { pedidoId: r.pedido_id, sucId: String(r.erp_sucursal_id), numero: String(r.numero ?? '') } }); };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedidos', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {!todas && miErp == null ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Tu ficha no está asignada a una sala que reciba pedidos." /></View> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? null : visibles.length ? visibles.map((r) => {
          // Un pedido ya ENVIADO está en camino aunque su sala no tenga hora de
          // salida propia: el portal ofrece «Confirmar llegada» igual.
          const base = getBranchStage(r);
          const etapa = base === 'preparado' && (r.pedido_status ?? r.status) === 'enviado' ? 'transito' : base;
          const [rotulo, color] = ETAPA[etapa] ?? [etapa, MARCA.azulClaro];
          return (
            <View key={`${r.pedido_id}-${r.erp_sucursal_id}`} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={22}>
                <View style={{ padding: 14, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{`Pedido #${r.numero}${todas ? ` · ${ERP_NAMES[r.erp_sucursal_id] ?? ''}` : ''}`}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {[r.codigo, r.created_at ? fechaTexto(String(r.created_at).slice(0, 10), { day: 'numeric', month: 'short' }) : null, r.total_cajas ? `${r.total_cajas} caja${r.total_cajas === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Pildora texto={rotulo} color={color} />
                  </View>
                  <Pasos pasos={PASOS} actual={paso(etapa)} color={color} />
                  {r.llegada_tipo && r.llegada_tipo !== 'completa' ? (
                    <Text style={{ color: MARCA.ambar, fontSize: 13 }}>
                      {r.llegada_tipo === 'caja_danada' ? 'Llegó con cajas dañadas.' : r.llegada_tipo === 'mixto' ? 'Llegó con cajas dañadas y faltantes.' : 'Faltaron cajas al llegar.'}
                    </Text>
                  ) : null}
                  {puede && etapa === 'transito' ? <BotonGrande texto="Confirmar que llegó" color={MARCA.azul} onPress={() => ir('/pedido/llegada', r)} /> : null}
                  {puede && etapa === 'contando' ? <BotonGrande texto="Contar lo que llegó" color={MARCA.verde} onPress={() => ir('/pedido/recibir', r)} /> : null}
                </View>
              </Vidrio>
            </View>
          );
        }) : (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 60, fontSize: 15 }}>No hay pedidos en curso.</Text>
        )}
        {todas ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Generar, rutas y métricas (portal)" borde
              onPress={() => router.push({ pathname: '/portal', params: { ruta: '/pedidos', nombre: 'Pedidos' } })} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
