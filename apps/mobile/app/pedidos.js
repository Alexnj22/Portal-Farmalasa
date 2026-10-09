// Pedidos a sucursales, NATIVO — «Pedidos» del portal (`TabPedidos` y
// `TabMetricas`): en qué va cada pedido que manda Bodega, con el filtro de
// estado y de período del tablero, cuántos pedidos tuvo cada sala en el
// período, y —con el permiso de la pestaña— los tiempos del despacho.
//
// Tocar una tarjeta abre su ficha (`app/pedido/detalle.js`): la línea de vida
// con quién hizo cada paso, cómo llegó, las diferencias y los productos.
// CONFIRMAR QUE LLEGÓ (`pedido/llegada.js`) y CONTARLO (`pedido/recibir.js`)
// siguen a un toque desde la tarjeta.
//
// El filtro es el del portal (`filtrarPedidos`, núcleo): «Todos» esconde los
// completados SIN observación; el que tiene algo abierto sigue a la vista.
// Con alcance de una sala se ven sólo los suyos; con alcance todas, la sala se
// elige en el menú. Bodega genera el pedido (`pedido/generar`) y, en la
// ficha, inicia, pausa, programa la entrega o anula; la llegada de un reenvío
// se confirma en `pedido/reenvio`. Las rutas de reparto, con su mapa, en
// `pedido/rutas`; finalizar (las cajas y hojas), el papel, el reenvío y armar
// la ruta, desde la ficha. Las reglas de despacho, en `pedido/reglas`.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchPedidosEnCurso } from '@nucleo/data/pedidos';
import { ESTADOS_DEL_TABLERO, filtrarPedidos, pedidosPorSala, rangoDeMes, tieneObservacion } from '@nucleo/utils/tableroDePedidos';
import { BRANCH_A_ERP, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { fechaTexto } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pasos, Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import Metricas from '../componentes/pedidos/Metricas';
import { ETAPA, etapaDeLaTarjeta, PASOS, pasoDeLaEtapa } from '../componentes/pedidos/etapa';

const PERIODOS = [
  { id: 'mes', label: 'Este mes', rango: () => rangoDeMes(0) },
  { id: 'anterior', label: 'Mes anterior', rango: () => rangoDeMes(-1) },
  { id: 'tres', label: 'Últimos 3 meses', rango: () => `${rangoDeMes(-2).split('|')[0]}|${rangoDeMes(0).split('|')[1]}` },
  { id: 'todo', label: 'Todo', rango: () => null },
];

function Tarjeta({ r, todas, puede }) {
  const etapa = etapaDeLaTarjeta(r);
  const [rotulo, color] = ETAPA[etapa] ?? [etapa, MARCA.azulClaro];
  const abrir = (pathname) => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname, params: { pedidoId: String(r.pedido_id), sucId: String(r.erp_sucursal_id), numero: String(r.numero ?? '') } }); };
  const observado = tieneObservacion(r);
  return (
    <Pressable onPress={() => abrir('/pedido/detalle')} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{`Pedido #${r.numero}${todas ? ` · ${ERP_NAMES[r.erp_sucursal_id] ?? ''}` : ''}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[r.codigo, r.created_at ? fechaTexto(String(r.created_at).slice(0, 10), { day: 'numeric', month: 'short' }) : null, r.total_cajas ? `${r.total_cajas} caja${r.total_cajas === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Pildora texto={rotulo} color={color} />
            <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
          </View>
          <Pasos pasos={PASOS} actual={pasoDeLaEtapa(etapa)} color={color} />
          {r.pedido_status === 'anulado' ? <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '600' }}>Anulado.</Text> : null}
          {r.llegada_tipo && r.llegada_tipo !== 'completa' ? (
            <Text style={{ color: MARCA.ambar, fontSize: 13 }}>
              {r.llegada_tipo === 'caja_danada' ? 'Llegó con cajas dañadas.' : r.llegada_tipo === 'mixto' ? 'Llegó con cajas dañadas y faltantes.' : 'Faltaron cajas al llegar.'}
            </Text>
          ) : null}
          {r.diferencias_reportadas_at && !r.confirmado_correccion_at ? (
            <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>Tiene diferencias sin resolver — tócalo para verlas.</Text>
          ) : observado && r.pedido_status === 'completado' ? (
            <Text style={{ color: MARCA.ambar, fontSize: 13 }}>Completado con observación.</Text>
          ) : null}
          {puede && etapa === 'transito' ? <BotonGrande texto="Confirmar que llegó" color={MARCA.azul} onPress={() => abrir('/pedido/llegada')} /> : null}
          {puede && etapa === 'contando' ? <BotonGrande texto="Contar lo que llegó" color={MARCA.verde} onPress={() => abrir('/pedido/recibir')} /> : null}
          {puede && (r.reenvios_historial ?? []).some((c) => c.sent_at && !c.arrived_at) ? (
            <BotonGrande texto="Llegó el reenvío" color={MARCA.azul} borde onPress={() => abrir('/pedido/reenvio')} />
          ) : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Pedidos() {
  const { user, hasPermission, getScope } = useAuth();
  const todas = getScope?.('pedidos') === 'ALL';
  const puede = hasPermission('pedidos', 'can_edit');
  const verMetricas = hasPermission('pedidos_tab_metricas');
  const verRutas = hasPermission('pedidos_tab_rutas');
  const verReglas = hasPermission('pedidos_tab_reglas');
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [vista, setVista] = useState('pedidos');
  const [salaElegida, setSala] = useState('todas');
  const [estado, setEstado] = useState('all');
  const [periodo, setPeriodo] = useState('mes');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchPedidosEnCurso();
    setError(e ? 'No se pudieron cargar los pedidos.' : null);
    setFilas(data ?? []);
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const rango = PERIODOS.find((p) => p.id === periodo)?.rango() ?? null;
  // Lo de mi alcance: mi sala, o la elegida, o todas.
  const mias = useMemo(() => (filas || []).filter((r) => (todas
    ? (salaElegida === 'todas' || String(r.erp_sucursal_id) === salaElegida)
    : Number(r.erp_sucursal_id) === Number(miErp))), [filas, todas, salaElegida, miErp]);
  const visibles = useMemo(() => filtrarPedidos(mias, { estado, rango })
    .sort((a, b) => ERP_ORDEN.indexOf(Number(a.erp_sucursal_id)) - ERP_ORDEN.indexOf(Number(b.erp_sucursal_id)) || (b.numero ?? 0) - (a.numero ?? 0)),
  [mias, estado, rango]);
  const porSala = useMemo(() => {
    const c = pedidosPorSala(mias, rango);
    return ERP_ORDEN.filter((id) => c.get(id)).map((id) => ({ id, nombre: ERP_NAMES[id], total: c.get(id) }));
  }, [mias, rango]);

  const grupos = vista === 'metricas' ? [] : [
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'todas', onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas las salas' }, ...ERP_ORDEN.map((e) => ({ id: String(e), label: ERP_NAMES[e] }))] }] : []),
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'all', onCambiar: setEstado,
      opciones: ESTADOS_DEL_TABLERO.map((e) => ({ id: e.value, label: e.label })) },
    { id: 'periodo', titulo: 'Período', activa: periodo, porDefecto: 'mes', onCambiar: setPeriodo,
      opciones: PERIODOS.map((p) => ({ id: p.id, label: p.label })) },
  ];
  const totalPeriodo = porSala.reduce((t, s) => t + s.total, 0);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedidos', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {verMetricas ? <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'pedidos', label: 'Pedidos' }, { id: 'metricas', label: 'Tiempos' }]} /> : null}
        {vista === 'metricas' ? <Metricas /> : (
          <>
            <FiltrosActivos grupos={grupos} />
            {!todas && miErp == null ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Tu ficha no está asignada a una sala que reciba pedidos." /></View> : null}
            {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
            {filas && porSala.length ? (
              <View style={{ marginHorizontal: 16 }}>
                <Vidrio radio={22}>
                  <View style={{ padding: 14, gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>
                        {`Pedidos · ${PERIODOS.find((p) => p.id === periodo)?.label.toLowerCase()}`}
                      </Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{totalPeriodo}</Text>
                    </View>
                    {porSala.length > 1 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {porSala.map((s) => (
                          <Pressable key={s.id} disabled={!todas}
                            onPress={() => { Haptics.selectionAsync().catch(() => {}); setSala(salaElegida === String(s.id) ? 'todas' : String(s.id)); }}
                            style={({ pressed }) => ({ minHeight: 34, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 999, opacity: pressed ? 0.7 : 1,
                              backgroundColor: salaElegida === String(s.id) ? `${MARCA.azulClaro}40` : `${MARCA.azulClaro}1F` })}>
                            <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{`${s.nombre} · ${s.total}`}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </Vidrio>
              </View>
            ) : null}
            {filas == null ? null : visibles.length
              ? visibles.map((r) => <Tarjeta key={`${r.pedido_id}-${r.erp_sucursal_id}`} r={r} todas={todas} puede={puede} />)
              : (
                <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 50, fontSize: 15 }}>
                  {estado === 'all' ? 'No hay pedidos en curso en este período.' : 'Ningún pedido con este filtro.'}
                </Text>
              )}
            {(todas && puede) || verRutas || verReglas ? (
              <View style={{ marginHorizontal: 16, gap: 8 }}>
                {todas && puede ? <BotonGrande texto="Generar pedido" color={MARCA.azul} onPress={() => router.push('/pedido/generar')} /> : null}
                {verRutas ? <BotonGrande texto="Rutas de reparto" borde onPress={() => router.push('/pedido/rutas')} /> : null}
                {verReglas ? <BotonGrande texto="Reglas de despacho" borde onPress={() => router.push('/pedido/reglas')} /> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
