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
//
// «Reportar un error» (2026-10-21, como el portal): durante 2 días desde que
// la sala cerró la recepción (`puedeReportarError`, núcleo; Supervisión sin
// plazo) la tarjeta vuelve a abrir `pedido/recibir` — corregir lo ya contado
// y anotar un extra. El plazo lo decide la base.
//
// Como el tablero del portal: buscador por número (y nota), la lista se
// actualiza sola cuando cambia un pedido (`escucharCambios`) y, para una sala,
// un aviso cuando Bodega le manda un pedido nuevo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Pressable, ScrollView, Text, View } from 'react-native';
import Refrescar from '../componentes/Refrescar';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchPedidosEnCurso } from '@nucleo/data/pedidos';
import { escucharCambios } from '@nucleo/data/tiempoReal';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { ESTADOS_DEL_TABLERO, filtrarPedidos, pedidosPorSala, puedeReportarError, rangoDeMes, tieneObservacion } from '@nucleo/utils/tableroDePedidos';
import { esCargoDeSupervision } from '@nucleo/utils/decisionDiferencia';
import { BRANCH_A_ERP, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { fechaTexto } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Vacio } from '../componentes/formulario/Piezas';
import { Pasos, Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
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

function Tarjeta({ r, todas, puede, miErp, esSupervision }) {
  const etapa = etapaDeLaTarjeta(r);
  const [rotulo, color] = ETAPA[etapa] ?? [etapa, MARCA.azulClaro];
  const abrir = (pathname) => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname, params: { pedidoId: String(r.pedido_id), sucId: String(r.erp_sucursal_id), numero: String(r.numero ?? '') } }); };
  const observado = tieneObservacion(r);
  return (
    <Pressable onPress={() => abrir('/pedido/detalle')} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo>
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
          {puede && etapa === 'erp' && r.pedido_status !== 'anulado' && (esSupervision || (miErp != null && Number(miErp) === Number(r.erp_sucursal_id)))
            && puedeReportarError({ recibidoAt: r.recibido_erp_at, pendientes: 0, esSupervision }) ? (
            <BotonGrande texto="Reportar un error de la recepción" color={MARCA.ambar} borde onPress={() => abrir('/pedido/recibir')} />
          ) : null}
          {puede && (r.reenvios_historial ?? []).some((c) => c.sent_at && !c.arrived_at) ? (
            <BotonGrande texto="Llegó el reenvío" color={MARCA.azul} borde onPress={() => abrir('/pedido/reenvio')} />
          ) : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

// El resumen del período (2026-11-11, usuario: «pedidos este mes, mejóralo, se
// ve feo»). Antes: un rótulo chico, el total y una nube de píldoras «Sala · N»
// que se partía en renglones desparejos. Ahora: el total grande con su
// período, y una fila por sala con una barra proporcional — se compara de un
// vistazo quién pidió más. Tocar una sala la filtra (sólo con alcance de
// todas); tocarla otra vez vuelve a «todas».
function ResumenDelPeriodo({ periodo, total, salas, elegida, puedeElegir, onElegir }) {
  const max = Math.max(1, ...salas.map((x) => x.total));
  const hayElegida = elegida && elegida !== 'todas';
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>Pedidos</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{periodo}</Text>
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: 38 }}>{total}</Text>
          </View>
          {salas.length > 1 ? (
            <View style={{ gap: 2 }}>
              {salas.map((x) => {
                const esta = elegida === String(x.id);
                const apagada = hayElegida && !esta;
                return (
                  <Pressable key={x.id} disabled={!puedeElegir} accessibilityRole={puedeElegir ? 'button' : undefined}
                    accessibilityLabel={`${x.nombre}, ${x.total} pedidos`}
                    onPress={() => { Haptics.selectionAsync().catch(() => {}); onElegir(esta ? 'todas' : String(x.id)); }}
                    style={({ pressed }) => ({ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: apagada ? 0.45 : pressed ? 0.7 : 1 })}>
                    <Text numberOfLines={1} style={{ width: 104, color: colorSistema.texto, fontSize: 15, fontWeight: esta ? '700' : '500' }}>{x.nombre}</Text>
                    <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: `${MARCA.azulClaro}1F`, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.max(4, (x.total / max) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: esta ? MARCA.azul : MARCA.azulClaro }} />
                    </View>
                    <Text style={{ minWidth: 28, textAlign: 'right', color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{x.total}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </Vidrio>
    </View>
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
  const esSupervision = esCargoDeSupervision(user?.rango);
  const [vista, setVista] = useState('pedidos');
  const [salaElegida, setSala] = useState('todas');
  const [estado, setEstado] = useState('all');
  const [periodo, setPeriodo] = useState('mes');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [buscar, setBuscar] = useState('');
  const [nuevo, setNuevo] = useState(null);   // { numero } del pedido que acaba de salir a mi sala

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchPedidosEnCurso();
    setError(e ? 'No se pudieron cargar los pedidos.' : null);
    setFilas(data ?? []);
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // En vivo, como el portal: un cambio de un pedido o del estado de una sala
  // recarga (juntando ráfagas en una sola lectura). A una sala, además, se le
  // avisa cuando Bodega le manda un pedido nuevo.
  const espera = useRef(null);
  const aviso = useRef(null);
  const avisados = useRef(new Set());
  useEffect(() => {
    const recargar = () => { clearTimeout(espera.current); espera.current = setTimeout(cargar, 800); };
    const quitar = escucharCambios('pedidos-app', [
      { tabla: 'pedidos', alCambiar: (payload) => {
        recargar();
        const ids = payload.new?.sucursal_ids ?? [];
        if (!todas && miErp != null && payload.new?.status === 'enviado' && ids.map(Number).includes(Number(miErp))
          && !avisados.current.has(payload.new.id)) {
          avisados.current.add(payload.new.id);   // un pedido avisa una vez, aunque se siga actualizando
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setNuevo({ numero: payload.new.numero });
          clearTimeout(aviso.current);
          aviso.current = setTimeout(() => setNuevo(null), 8000);
        }
      } },
      { tabla: 'pedido_sucursal_status', alCambiar: recargar },
    ]);
    return () => { quitar(); clearTimeout(espera.current); clearTimeout(aviso.current); };
  }, [cargar, todas, miErp]);

  const rango = PERIODOS.find((p) => p.id === periodo)?.rango() ?? null;
  // Lo de mi alcance: mi sala, o la elegida, o todas.
  const mias = useMemo(() => (filas || []).filter((r) => (todas
    ? (salaElegida === 'todas' || String(r.erp_sucursal_id) === salaElegida)
    : Number(r.erp_sucursal_id) === Number(miErp))), [filas, todas, salaElegida, miErp]);
  const q = buscar.trim();
  const visibles = useMemo(() => filtrarPedidos(mias, { estado, rango })
    .filter((r) => !q || tokenMatch(q, String(r.numero ?? ''), r.codigo, r.notes))
    .sort((a, b) => ERP_ORDEN.indexOf(Number(a.erp_sucursal_id)) - ERP_ORDEN.indexOf(Number(b.erp_sucursal_id)) || (b.numero ?? 0) - (a.numero ?? 0)),
  [mias, estado, rango, q]);
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

  // La barra admite una sola acción junto al filtro: las tres van en su menú.
  const abrirMas = () => {
    const ops = [
      ...(verRutas ? [['Rutas de reparto', () => router.push('/pedido/rutas')]] : []),
      ...(verReglas ? [['Reglas de despacho', () => router.push('/pedido/reglas')]] : []),
    ];
    ActionSheetIOS.showActionSheetWithOptions({ options: [...ops.map((o) => o[0]), 'Cancelar'], cancelButtonIndex: ops.length },
      (i) => { if (i < ops.length) ops[i][1](); });
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_FIJA, title: 'Pedidos',
        headerSearchBarOptions: vista === 'metricas' ? undefined : {
          placeholder: 'Número de pedido', hideWhenScrolling: false,
          onChangeText: (e) => setBuscar(e.nativeEvent.text), onCancelButtonPress: () => setBuscar(''),
        } }} />
      <MenuDeFiltros grupos={grupos} extra={verRutas || verReglas ? { icono: 'ellipsis.circle', etiqueta: 'Más acciones', onPress: abrirMas } : null} />
      {/* Fijo arriba al desplazar (2026-11-11). */}
      {verMetricas ? (
        <FijoArriba>
          <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'pedidos', label: 'Pedidos' }, { id: 'metricas', label: 'Tiempos' }]} />
        </FijoArriba>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {vista === 'metricas' ? <Metricas /> : (
          <>
            <FiltrosActivos grupos={grupos} />
            {nuevo ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto={`Bodega te mandó el pedido #${nuevo.numero}: ya va en camino.`} /></View> : null}
            {!todas && miErp == null ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Tu ficha no está asignada a una sala que reciba pedidos." /></View> : null}
            {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
            {/* Generar a la vista (2026-11-11, usuario: «¿por qué no se puede
                generar un pedido aquí?»): estaba escondido en «Más acciones». */}
            {todas && puede ? (
              <View style={{ marginHorizontal: 16 }}>
                <BotonGrande texto="Generar pedido" onPress={() => router.push('/pedido/generar')} />
              </View>
            ) : null}
            {filas && porSala.length ? (
              <ResumenDelPeriodo periodo={PERIODOS.find((p) => p.id === periodo)?.label} total={totalPeriodo}
                salas={porSala} elegida={salaElegida} puedeElegir={todas} onElegir={setSala} />
            ) : null}
            {filas == null ? null : visibles.length
              ? visibles.map((r) => <Tarjeta key={`${r.pedido_id}-${r.erp_sucursal_id}`} r={r} todas={todas} puede={puede} miErp={miErp} esSupervision={esSupervision} />)
              : (
                <Vacio titulo={q ? `Ningún pedido coincide con «${q}».` : estado === 'all' ? 'No hay pedidos en curso en este período.' : 'Ningún pedido con este filtro.'} icono={q ? 'Search' : undefined} />
              )}
          </>
        )}
      </ScrollView>
    </>
  );
}
