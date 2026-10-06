// Mín·Máx de un producto, NATIVO — la ficha de UN producto en todas las salas,
// con el análisis del panel del portal (`tabminmax/ExpandedPanel`):
//
//   · el stock de la red (con y sin Bodega);
//   · cada sala con su barra de existencia contra MIN y MAX, la alerta, la
//     clase ABC·XYZ, la velocidad y el borrador si lo hay;
//   · al tocarla: los días de cobertura contra el ciclo, la proyección a 30,
//     60 y 90 días, el historial de cálculos y —con permiso y alcance— ajustar
//     el par, restaurarlo al calculado u ocultar el producto en esa sala;
//   · los lotes que vencen en 60 días con hasta cuándo mandarlos a Bodega, el
//     traslado sugerido a la sala propia y las últimas compras y ventas.
//
// Guardar usa `planDeGuardadoMinMax` y restaurar `planDeRestaurarMinMax`, las
// mismas decisiones del portal (EN VIVO si la sala ya publicó y no hay
// borrador, si no al BORRADOR; Bodega guarda un delta sobre la suma de las
// salas; un A o B a 0·0 pregunta). Con alcance de una sala, sólo se edita la
// propia. La revisión de la sala entera (publicar y descartar en lote, la
// matriz ABC·XYZ) sigue en el portal: es trabajo de escritorio.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import { fetchNombreDeProducto } from '@nucleo/data/productos';
import {
  fetchLotesPorVencer, fetchPoliticaDeVencimiento, fetchProductCostHistory, fetchResumenDelProductoPorSala,
  fetchStockConfigFull, fetchStockParams, fetchStockParamsHistory, fetchUltimasVentasDelProducto,
  ocultarProductoMinMax, salaTieneMinMaxPublicado, updateStockParams, upsertStockParams,
} from '@nucleo/data/stockParams';
import { diasDeCobertura, planDeGuardadoMinMax, planDeRestaurarMinMax, estadoDeProyeccion } from '@nucleo/utils/minmaxGuardar';
import { ALERTA_ETIQUETA } from '@nucleo/constants/minmax';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { BarraDeExistencia, COLOR_MAX, COLOR_MIN, Cobertura } from '../componentes/minmax/Barras';
import { LotesPorVencer, UltimasCompras, UltimasVentas } from '../componentes/minmax/Detalle';
import { fallo, listo, trabajando } from '../componentes/Progreso';

// Los rótulos son los del núcleo (los mismos chips del portal); el color, el
// de su estado.
const COLOR_ALERTA = {
  out_of_stock: MARCA.rojo, below_min: MARCA.ambar, approaching: '#EAB308', ok: MARCA.verde,
  overstocked: MARCA.azulClaro, dead_stock: colorSistema.texto2, no_data: colorSistema.texto2,
};
const COLUMNAS = 'abc_class, demand_variability, daily_velocity, velocity_30d, draft_abc_class, draft_status, draft_min, draft_max, min_units, max_units, manual_min, manual_max, calc_min, calc_max, is_hidden';

function Cifra({ rotulo, valor, color }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.13)' }}>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{rotulo}</Text>
    </View>
  );
}

function Proyeccion({ stock, velocidad, min }) {
  if (!(velocidad > 0) || !(stock > 0)) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin proyección: no hay venta o no hay existencia.</Text>;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {[30, 60, 90].map((d) => {
        const { unidades: p, agotado, casi } = estadoDeProyeccion(stock, velocidad, d);
        const color = agotado ? MARCA.rojo : (casi || p < min) ? MARCA.ambar : MARCA.verde;
        return (
          <View key={d} style={{ flex: 1, alignItems: 'center', padding: 8, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.13)' }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>{`+${d} días`}</Text>
            <Text style={{ color, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{agotado ? '0' : casi ? '< 1' : formatQty(p)}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{agotado ? 'se agota' : casi ? 'casi nada' : 'unidades'}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Historial({ producto, sucursal }) {
  const [filas, setFilas] = useState(null);
  useEffect(() => {
    fetchStockParamsHistory(producto, sucursal).then(({ data }) => setFilas(data || [])).catch(() => setFilas([]));
  }, [producto, sucursal]);
  if (filas == null) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Cargando…</Text>;
  if (!filas.length) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin historial de cálculos.</Text>;
  return filas.slice(0, 8).map((h, i) => (
    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
      <Text style={{ width: 62, color: colorSistema.texto2, fontSize: 13 }}>{fechaTexto(h.captured_at, { day: '2-digit', month: 'short' })}</Text>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'] }}>
        <Text style={{ color: COLOR_MIN, fontWeight: '800' }}>{formatQty(h.min_units ?? 0)}</Text>
        {'  ·  '}
        <Text style={{ color: COLOR_MAX, fontWeight: '800' }}>{formatQty(h.max_units ?? 0)}</Text>
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{`${Number(h.daily_velocity || 0).toFixed(1)}/día`}</Text>
      {h.abc_class ? <Pildora texto={`${h.abc_class}${h.demand_variability ?? ''}`} color={MARCA.violetaClaro} /> : null}
    </View>
  ));
}

function Sala({ fila, productoId, ciclo, puedeEditar, onGuardar, onRestaurar, onOcultar, onMostrar }) {
  const [abierta, setAbierta] = useState(false);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const alerta = ALERTA_ETIQUETA[fila.alert_status] ?? fila.alert_status ?? '—';
  const colorAlerta = COLOR_ALERTA[fila.alert_status] ?? colorSistema.texto2;
  const borrador = fila.draft_status === 'pending';
  const esBodega = fila.erp_sucursal_id === ERP_BODEGA;
  const stock = Number(fila.current_stock) || 0;
  const vel = Number(fila.daily_velocity) || 0;
  const clase = fila.abc_class ? `${fila.abc_class}${fila.demand_variability ?? ''}` : null;
  const abrir = () => {
    Haptics.selectionAsync().catch(() => {});
    setMin(String(borrador ? fila.draft_min ?? '' : fila.effective_min ?? ''));
    setMax(String(borrador ? fila.draft_max ?? '' : fila.effective_max ?? ''));
    setAbierta((a) => !a);
  };
  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={abrir} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        <Vidrio radio={20} interactivo>
          <View style={{ padding: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{ERP_NAMES[fila.erp_sucursal_id] ?? fila.erp_sucursal_id}</Text>
              {clase ? <Pildora texto={clase} color={MARCA.violetaClaro} /> : null}
              <Pildora texto={alerta} color={colorAlerta} />
            </View>
            <BarraDeExistencia existencia={stock} min={fila.effective_min} max={fila.effective_max} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Cifra rotulo="Existencia" valor={formatQty(stock)} color={stock === 0 ? MARCA.rojo : undefined} />
              <Cifra rotulo="MIN · MAX" valor={`${fila.effective_min ?? '—'} · ${fila.effective_max ?? '—'}`} />
              {borrador ? <Cifra rotulo="Borrador" valor={`${fila.draft_min ?? '—'} · ${fila.draft_max ?? '—'}`} color={MARCA.ambar} />
                : <Cifra rotulo="Venta/día" valor={vel ? vel.toFixed(2) : '—'} />}
            </View>
            {fila.vencidos_stock > 0 ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>{`${formatQty(fila.vencidos_stock)} u. en el área de vencidos (no cuentan)`}</Text> : null}
            {fila.is_hidden ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Oculto en esta sala: no se le calcula Mín·Máx.</Text> : null}
          </View>
        </Vidrio>
      </Pressable>
      {abierta ? (
        <Vidrio radio={20}>
          <View style={{ padding: 14, gap: 14 }}>
            <Cobertura dias={diasDeCobertura(stock, vel)} ciclo={ciclo} />
            <View style={{ gap: 6 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>PROYECCIÓN</Text>
              <Proyeccion stock={stock} velocidad={vel} min={Number(fila.effective_min) || 0} />
              {vel ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`a ${vel.toFixed(2)} unidades por día${fila.velocity_30d != null ? ` · últimos 30 días ${Number(fila.velocity_30d).toFixed(2)}` : ''}`}</Text> : null}
            </View>
            {puedeEditar ? (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: COLOR_MIN, fontSize: 12, fontWeight: '800', textAlign: 'center' }}>MIN</Text>
                    <Campo multiline={false} value={min} onChangeText={(v) => setMin(v.replace(/\D/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 22, fontWeight: '800' }} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: COLOR_MAX, fontSize: 12, fontWeight: '800', textAlign: 'center' }}>MAX</Text>
                    <Campo multiline={false} value={max} onChangeText={(v) => setMax(v.replace(/\D/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 22, fontWeight: '800' }} />
                  </View>
                </View>
                {fila.calc_min != null || fila.calc_max != null ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>{`Calculado: ${fila.calc_min ?? '—'} · ${fila.calc_max ?? '—'}`}</Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><BotonGrande texto="Guardar" color={MARCA.azul} onPress={async () => { if (await onGuardar(fila, min, max)) setAbierta(false); }} /></View>
                  {!esBodega ? <View style={{ flex: 1 }}><BotonGrande texto="Poner 0" borde color={MARCA.rojo} onPress={async () => { if (await onGuardar(fila, '0', '0')) setAbierta(false); }} /></View> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><BotonGrande texto="Restaurar" borde color={MARCA.violetaClaro} onPress={() => onRestaurar(fila)} /></View>
                  {!esBodega ? (
                    <View style={{ flex: 1 }}>
                      {fila.is_hidden
                        ? <BotonGrande texto="Mostrar" borde color={MARCA.verde} onPress={() => onMostrar(fila)} />
                        : <BotonGrande texto="Ocultar" borde color={colorSistema.texto2} onPress={() => onOcultar(fila)} />}
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}
            <View style={{ gap: 4 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>HISTORIAL DE CÁLCULOS</Text>
              <Historial producto={productoId} sucursal={fila.erp_sucursal_id} />
            </View>
          </View>
        </Vidrio>
      ) : null}
    </View>
  );
}

export default function MinMaxProducto() {
  const { producto: productoParam, nombre: nombreParam } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const canManage = hasPermission('minmax', 'can_edit');
  const verCostos = hasPermission('minmax_ver_costos');
  const todas = getScope?.('minmax') === 'ALL';
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [texto, setTexto, aplicado] = useBusqueda();
  const [resultados, setResultados] = useState([]);
  const [producto, setProducto] = useState(productoParam ? { id: Number(productoParam), nombre: nombreParam ?? '' } : null);
  // Llegando por un enlace (o un aviso) viene sólo el id: el nombre se pide,
  // si no el encabezado queda vacío.
  useEffect(() => {
    if (!producto?.id || producto.nombre) return;
    let vivo = true;
    fetchNombreDeProducto(producto.id).then((n) => { if (vivo && n) setProducto((p) => (p && p.id === producto.id ? { ...p, nombre: n } : p)); });
    return () => { vivo = false; };
  }, [producto?.id, producto?.nombre]);
  const [filas, setFilas] = useState(null);
  const [extra, setExtra] = useState(null);
  const [ciclo, setCiclo] = useState(45);
  const [recargando, setRecargando] = useState(false);

  useEffect(() => {
    fetchStockConfigFull().then(({ data }) => { if (data?.cycle_days) setCiclo(Number(data.cycle_days)); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (producto || aplicado.trim().length < 2) { setResultados([]); return undefined; }
    let vivo = true;
    buscarProductosMinMax(aplicado.trim(), 20).then((r) => { if (vivo) setResultados(r.filas || []); });
    return () => { vivo = false; };
  }, [aplicado, producto]);

  const cargar = useCallback(async () => {
    if (!producto) return;
    const { data } = await fetchResumenDelProductoPorSala({ p_erp_product_id: producto.id });
    const params = await Promise.all((data ?? []).map((r) => fetchStockParams(producto.id, r.erp_sucursal_id, COLUMNAS).then(({ data: d }) => d).catch(() => null)));
    setFilas((data ?? []).map((r, i) => ({ ...(params[i] ?? {}), ...r, draft_status: r.draft_status ?? params[i]?.draft_status }))
      .sort((a, b) => ERP_ORDEN.indexOf(a.erp_sucursal_id) - ERP_ORDEN.indexOf(b.erp_sucursal_id)));
    // Lo del producto (no de una sala): lotes por vencer, política y, con
    // permiso, las últimas compras y ventas de la red.
    const [lotes, pol, compras, ventas] = await Promise.all([
      fetchLotesPorVencer({ p_erp_product_id: producto.id }),
      fetchPoliticaDeVencimiento({ p_erp_product_id: producto.id }),
      verCostos ? fetchProductCostHistory(producto.id) : Promise.resolve({ data: [] }),
      verCostos ? fetchUltimasVentasDelProducto({ p_erp_product_id: producto.id, p_erp_sucursal_id: null }) : Promise.resolve({ data: [] }),
    ]);
    setExtra({ lotes: lotes.data || [], politica: pol.data?.[0] ?? null, compras: compras.data || [], ventas: ventas.data || [] });
  }, [producto, verCostos]);
  useEffect(() => { setFilas(null); setExtra(null); cargar(); }, [cargar]);

  // El piso de Bodega: la suma de lo vigente en las salas.
  const pisos = useMemo(() => {
    const salas = (filas ?? []).filter((f) => f.erp_sucursal_id !== ERP_BODEGA);
    return { min: salas.reduce((s, f) => s + (Number(f.effective_min) || 0), 0), max: salas.reduce((s, f) => s + (Number(f.effective_max) || 0), 0) };
  }, [filas]);
  const red = useMemo(() => {
    if (!filas) return null;
    const sinBodega = filas.filter((f) => f.erp_sucursal_id !== ERP_BODEGA).reduce((s, f) => s + (Number(f.current_stock) || 0), 0);
    return { sinBodega, total: filas.reduce((s, f) => s + (Number(f.current_stock) || 0), 0) };
  }, [filas]);
  // El traslado sugerido a la sala propia, como el portal: si la mía está bajo
  // el MIN, de dónde sobra (salas con exceso sobre su MAX).
  const sugerido = useMemo(() => {
    const mia = (filas ?? []).find((f) => Number(f.erp_sucursal_id) === Number(miErp));
    if (!mia || !(Number(mia.effective_max) > 0) || !['out_of_stock', 'below_min'].includes(mia.alert_status)) return [];
    return (filas ?? []).filter((f) => f.erp_sucursal_id !== mia.erp_sucursal_id && f.alert_status === 'overstocked')
      .map((f) => ({ id: f.erp_sucursal_id, sobra: Math.max(0, Number(f.current_stock) - Number(f.effective_max)) }))
      .filter((s) => s.sobra > 0).sort((a, b) => b.sobra - a.sobra);
  }, [filas, miErp]);

  const anotar = (accion, detalle) => useStaffStore.getState().appendAuditLog?.(accion, String(producto.id), { ...detalle, product: producto.nombre, desde: 'app' });

  const guardar = async (fila, min, max, confirmado = false) => {
    const { publicado } = await salaTieneMinMaxPublicado(fila.erp_sucursal_id);
    const row = { ...fila, pub_min: pisos.min, pub_max: pisos.max };
    const plan = planDeGuardadoMinMax({ row, productId: producto.id, sucursalId: fila.erp_sucursal_id, min, max, hayPublicado: !!publicado, confirmado });
    if (plan.sinCambio) return true;
    if (plan.error) { fallo('No se puede guardar', plan.error); return false; }
    if (plan.confirmarCero) {
      return new Promise((resolve) => Alert.alert('¿Poner en 0?', `${producto.nombre} es de los que más se venden en ${ERP_NAMES[fila.erp_sucursal_id]}. Con 0·0 deja de reponerse.`, [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Poner en 0', style: 'destructive', onPress: async () => resolve(await guardar(fila, min, max, true)) },
      ]));
    }
    trabajando('Guardando el MIN·MAX…');
    const { error } = await upsertStockParams(plan.payload);
    if (error) { fallo('No se pudo guardar', mensajeAmigable(error)); return false; }
    anotar(plan.accion, plan.detalle);
    listo(plan.tipo === 'borrador' ? 'Quedó en el borrador' : 'MIN·MAX actualizado', `${ERP_NAMES[fila.erp_sucursal_id]} · ${plan.minNum ?? 0} · ${plan.maxNum ?? 0}`);
    await cargar();
    return true;
  };

  const restaurar = async (fila) => {
    const { publicado } = await salaTieneMinMaxPublicado(fila.erp_sucursal_id);
    const plan = planDeRestaurarMinMax({ row: fila, productId: producto.id, sucursalId: fila.erp_sucursal_id, hayPublicado: !!publicado });
    if (plan.sinCambio) { listo('Nada que restaurar', 'Bodega ya sigue la suma de las salas.'); return; }
    trabajando('Restaurando…');
    const { error } = plan.patch
      ? await updateStockParams(producto.id, fila.erp_sucursal_id, plan.patch)
      : await upsertStockParams(plan.payload);
    if (error) { fallo('No se pudo restaurar', mensajeAmigable(error)); return; }
    anotar(plan.accion, plan.detalle);
    listo('Restaurado', plan.tipo === 'bodega' ? 'Bodega vuelve a la suma de las salas.' : plan.tipo === 'limpiar' ? 'Sin calculado: el par queda en —.' : `MIN ${plan.min} · MAX ${plan.max} (calculado)${plan.tipo === 'borrador' ? ', en el borrador' : ''}`);
    await cargar();
  };

  const ocultar = (fila) => Alert.alert('Ocultar en esta sala', `${producto.nombre} deja de tener Mín·Máx en ${ERP_NAMES[fila.erp_sucursal_id]} y no se le vuelve a calcular.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Ocultar', style: 'destructive', onPress: async () => {
      const { error } = await ocultarProductoMinMax(producto.id, fila.erp_sucursal_id, { product: producto.nombre, desde: 'app' });
      if (error) { fallo('No se pudo ocultar', mensajeAmigable(error)); return; }
      listo('Oculto en la sala', ERP_NAMES[fila.erp_sucursal_id]);
      cargar();
    } },
  ]);
  const mostrar = async (fila) => {
    const { error } = await updateStockParams(producto.id, fila.erp_sucursal_id, { is_hidden: false, updated_at: new Date().toISOString() });
    if (error) { fallo('No se pudo mostrar', mensajeAmigable(error)); return; }
    anotar('MINMAX_UNHIDE', { sucursal_id: fila.erp_sucursal_id });
    listo('Vuelve a la sala', ERP_NAMES[fila.erp_sucursal_id]);
    cargar();
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Mín·Máx', headerLargeTitle: !producto }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive"
          refreshControl={producto ? <RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} /> : undefined}>
          {!producto ? (
            <>
              <Seccion titulo="Producto">
                <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Nombre o principio activo" autoCorrect={false} />
                {resultados.map((p) => (
                  <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setProducto({ id: p.id, nombre: p.nombre }); }}
                    style={({ pressed }) => ({ paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                    {p.principio_activo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.principio_activo}</Text> : null}
                  </Pressable>
                ))}
              </Seccion>
              <BotonGrande texto="Agotados que venden" borde color={MARCA.ambar} onPress={() => router.push('/agotados')} />
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: '/producto/[id]', params: { id: String(producto.id), nombre: producto.nombre } })}>
                  <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{producto.nombre}</Text>
                  <Text style={{ color: colorSistema.acento, fontSize: 13 }}>Ver la ficha del producto</Text>
                </Pressable>
                {!productoParam ? (
                  <Pressable onPress={() => { setProducto(null); setFilas(null); setExtra(null); }} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text>
                  </Pressable>
                ) : null}
              </View>
              {red ? (
                <Vidrio radio={20}>
                  <View style={{ padding: 14, flexDirection: 'row', gap: 10 }}>
                    <Cifra rotulo="En la red (salas)" valor={formatQty(red.sinBodega)} />
                    <Cifra rotulo="Con Bodega" valor={formatQty(red.total)} />
                  </View>
                </Vidrio>
              ) : null}
              {sugerido.length ? (
                <Vidrio radio={20} tinte={`${MARCA.ambar}1F`}>
                  <View style={{ padding: 14, gap: 4 }}>
                    <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '800', letterSpacing: 0.4 }}>TRASLADO SUGERIDO</Text>
                    {sugerido.map((s) => <Text key={s.id} style={{ color: colorSistema.texto, fontSize: 15 }}>{`${ERP_NAMES[s.id]} · ${formatQty(s.sobra)} u. de más`}</Text>)}
                  </View>
                </Vidrio>
              ) : null}
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{canManage ? 'Toca una sala para ver su análisis y ajustar su MIN·MAX.' : 'Toca una sala para ver su análisis.'}</Text>
              {filas == null ? null : filas.length ? filas.map((f) => (
                <Sala key={f.erp_sucursal_id} fila={f} productoId={producto.id} ciclo={ciclo}
                  onGuardar={guardar} onRestaurar={restaurar} onOcultar={ocultar} onMostrar={mostrar}
                  puedeEditar={canManage && (todas || Number(f.erp_sucursal_id) === Number(miErp))} />
              )) : <Aviso tono="nota" texto="Este producto no tiene MIN·MAX en ninguna sala." />}
              {extra ? (
                <>
                  <LotesPorVencer lotes={extra.lotes} politica={extra.politica} />
                  <UltimasCompras compras={extra.compras} conCosto={verCostos} />
                  <UltimasVentas ventas={extra.ventas} conCosto={verCostos} />
                </>
              ) : null}
            </>
          )}
          {canManage && todas ? (
            <BotonGrande texto="Revisar la sala completa (portal)" borde
              onPress={() => router.push({ pathname: '/portal', params: { ruta: '/minmax', nombre: 'Min / Max' } })} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
