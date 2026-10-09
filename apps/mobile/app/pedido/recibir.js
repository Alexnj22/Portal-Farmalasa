// Contar lo que llegó, NATIVO — el `RecepcionModal` del portal en lo que la
// sala hace todos los días: el pedido viene en HOJAS (la página del papel que
// acompaña a cada caja) y cajas ESPECIALES; se abre una, se cuenta renglón por
// renglón en la presentación de despacho y se confirma — o «Todo OK» si vino
// exacto.
//
//   · el conteo de cada renglón es `renglonContado` del núcleo (faltante,
//     sobrante, dañado, vencido), el mismo del portal;
//   · al confirmar: `recibirPedidoDeSucursal` (con su bitácora), el ingreso al
//     inventario en segundo plano (`recibirTrasladoPedido`) y la hoja queda
//     marcada (`marcarHojasRecibidas`);
//   · con todo contado, el pedido pasa a «recibido» (`recibir_erp`) y, si hubo
//     diferencias, se reportan (`reportar_diferencias`) — como el portal.
//
// Lo que se cuenta mal no se pierde: queda como diferencia y se resuelve con
// Bodega. Y como en el portal:
//   · «Recibir sólo este» cuenta e ingresa UN producto sin contar el resto de
//     la caja (`recibirProductoSuelto`): para venderlo ya;
//   · lo ya contado se puede CORREGIR (`corregirRecepcionDeItem`): no mueve
//     existencias, deja la diferencia para hablarla con Bodega;
//   · lo que llegó y no venía se anota en `pedido/extras`.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { avanzarEtapaDePedidoEnSala, fetchApoyoForPedido, fetchEmployeeByKioskPin, fetchPedidoItemsAll, fetchPedidoSucursalStatus, fetchPedidosEnCurso, recibirTrasladoPedido, upsertPedidoApoyo } from '@nucleo/data/pedidos';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Escaner from '../../componentes/Escaner';
import { corregirRecepcionDeItem, marcarHojasRecibidas, recibirPedidoDeSucursal, recibirProductoSuelto } from '@nucleo/data/recepcion';
import { construirCajasEspeciales } from '@nucleo/utils/cajasEspeciales';
import { estadoDeHojas } from '@nucleo/utils/hojasRecepcion';
import { conteoInicial, enPresentacion, renglonContado, renglonTodoOk } from '@nucleo/utils/recepcionDePedido';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const PRES = { CAJA: 'Caja', BLISTER: 'Blíster', MULTIPLO: 'Unid', UNIDAD: 'Unidad', caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja', unidad: 'Unidad' };
// El conteo va en la presentación de despacho SI lo enviado cabe exacto, y en
// la unidad del sistema si no (`conteoInicial`, el mismo del portal): redondear
// 25 unidades a «3 blísteres de 10» inventaba una diferencia que no existe.
const presentacion = (r) => {
  const { fPres } = conteoInicial(r);
  const f = Number(r.dispatch_factor) || 1;
  if (fPres !== f) return fPres > 1 ? `Unidad ×${fPres}` : 'Unidad';
  const l = PRES[r.dispatch_tipo] ?? r.dispatch_tipo ?? 'Unidad';
  return f > 1 ? `${l} ×${f}` : l;
};
const SIN_VALOR = {};
const PROBLEMAS = [['danado', 'Dañado'], ['vencido', 'Vencido'], ['otro', 'Otro']];

// Memoizado y con callbacks estables: «todo el pedido» son cientos de
// renglones, y tocar «+» en uno no tiene por qué repintar los demás.
const Renglon = memo(function Renglon({ r, valor, onCambiar: cambiarDe, primero, onSolo: soloDe, ocupado }) {
  const onCambiar = (p) => cambiarDe(r.id, p);
  const onSolo = soloDe ? () => soloDe(r) : null;
  const ini = conteoInicial(r);
  const esperado = ini.fQty;
  const qty = valor.fQty ?? esperado;
  const distinto = qty !== esperado || !!valor.problema;
  const paso = (d) => { Haptics.selectionAsync().catch(() => {}); onCambiar({ fQty: Math.max(0, qty + d), fPres: ini.fPres }); };
  return (
    <View style={{ gap: 8, paddingVertical: 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{r.products?.nombre ?? `Producto ${r.erp_product_id}`}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`Vienen ${esperado} · ${presentacion(r)}`}</Text>
        <Boton texto="−" onPress={() => paso(-1)} />
        <Text style={{ width: 44, textAlign: 'center', color: distinto ? MARCA.ambar : colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{qty}</Text>
        <Boton texto="+" onPress={() => paso(1)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {PROBLEMAS.map(([id, rotulo]) => {
          const activo = valor.problema === id;
          return (
            <Pressable key={id} onPress={() => onCambiar({ problema: activo ? null : id })}
              style={{ minHeight: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: activo ? MARCA.ambar : 'rgba(127,127,127,0.16)' }}>
              <Text style={{ color: activo ? '#fff' : colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{rotulo}</Text>
            </Pressable>
          );
        })}
      </View>
      {valor.problema === 'danado' || valor.problema === 'vencido' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{`¿Cuántas ${valor.problema === 'danado' ? 'dañadas' : 'vencidas'}?`}</Text>
          <View style={{ width: 80 }}><Campo multiline={false} value={String(valor.cantProblema ?? 1)} keyboardType="number-pad" style={{ textAlign: 'center' }}
            onChangeText={(t) => onCambiar({ cantProblema: Math.max(1, Number(t.replace(/\D/g, '')) || 1) })} /></View>
        </View>
      ) : null}
      {distinto ? <Campo value={valor.nota ?? ''} onChangeText={(t) => onCambiar({ nota: t })} placeholder="Nota (opcional)" /> : null}
      {onSolo ? (
        <Pressable disabled={ocupado} onPress={onSolo} style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start', opacity: ocupado ? 0.4 : pressed ? 0.6 : 1 })}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Recibir sólo este, para venderlo ya</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

// Un renglón ya contado, con «Corregir»: la cantidad y una nota.
function Contado({ r, primero, onCorregir, ocupado }) {
  const [abierto, setAbierto] = useState(false);
  const [cant, setCant] = useState(String(Number(r.cantidad_recibida) || 0));
  const [nota, setNota] = useState('');
  return (
    <View style={{ gap: 6, paddingVertical: 8, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{r.products?.nombre ?? `Producto ${r.erp_product_id}`}</Text>
          <Text style={{ color: r.status === 'con_diferencia' ? MARCA.ambar : colorSistema.texto2, fontSize: 12 }}>{`Contado ${enPresentacion(Number(r.cantidad_recibida) || 0, r).fQty} de ${conteoInicial(r).fQty} · ${presentacion(r)}`}</Text>
        </View>
        <Pressable onPress={() => setAbierto((v) => !v)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{abierto ? 'Cerrar' : 'Corregir'}</Text>
        </Pressable>
      </View>
      {abierto ? (
        <View style={{ gap: 8 }}>
          <Campo multiline={false} keyboardType="number-pad" value={cant} onChangeText={(t) => setCant(t.replace(/\D/g, ''))} placeholder="Cantidad que de verdad llegó" />
          <Campo multiline={false} value={nota} onChangeText={setNota} placeholder="Qué pasó (obligatorio)" />
          <BotonGrande texto="Guardar la corrección" color={MARCA.ambar} deshabilitado={ocupado || cant === '' || !nota.trim()}
            onPress={() => onCorregir(r, Number(cant), nota.trim(), () => setAbierto(false))} />
        </View>
      ) : null}
    </View>
  );
}

function Boton({ texto, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.18)', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Recibir() {
  const { pedidoId, sucId: sucParam, numero } = useLocalSearchParams();
  const sucId = Number(sucParam);
  const { user } = useAuth();
  const [datos, setDatos] = useState(undefined);
  const [abierto, setAbierto] = useState(null);    // { tipo: 'hoja'|'especial'|'pedido', hoja?, especial? }
  const [valores, setValores] = useState({});
  const [huboDiferencia, setHuboDiferencia] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [apoyo, setApoyo] = useState([]);
  const [escaneando, setEscaneando] = useState(false);
  const [avisoApoyo, setAvisoApoyo] = useState(null);

  const cargar = useCallback(async () => {
    const [items, { data: pss }, { data: activos }] = await Promise.all([
      fetchPedidoItemsAll(pedidoId, sucId),
      fetchPedidoSucursalStatus(pedidoId, sucId, 'pagina_items, paginas, hojas_recibidas'),
      fetchPedidosEnCurso(),
    ]);
    const fila = (activos ?? []).find((r) => r.pedido_id === pedidoId && Number(r.erp_sucursal_id) === sucId) ?? {};
    setDatos({ items: items ?? [], paginaItems: pss?.pagina_items ?? {}, paginas: pss?.paginas ?? [], recibidas: pss?.hojas_recibidas ?? [], fila });
    const { data: ap } = await fetchApoyoForPedido(pedidoId, sucId);
    setApoyo((ap ?? []).filter((a) => a.tipo === 'recepcion'));
  }, [pedidoId, sucId]);

  // Quién ayudó a recibir: se escanean los carnés uno tras otro, como en el
  // portal (`ApoioScanModal`). El servidor sólo reconoce gente de la sala.
  const leerCarne = async (codigo) => {
    const { data: emp, error } = await fetchEmployeeByKioskPin(String(codigo).toUpperCase());
    if (error || !emp) { setAvisoApoyo(error ? mensajeAmigable(error, 'No se pudo confirmar el carné.') : 'Ese carné no es de nadie de esta sucursal.'); return false; }
    if (apoyo.some((a) => a.employee_id === emp.id)) { setAvisoApoyo(`${shortEmployeeName(emp)} ya está anotado.`); return false; }
    const { error: e } = await upsertPedidoApoyo({ pedido_id: pedidoId, erp_sucursal_id: sucId, employee_id: emp.id, registered_by: user?.id ?? null, tipo: 'recepcion' });
    if (e) { setAvisoApoyo(mensajeAmigable(e, 'No se pudo registrar el apoyo.')); return false; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setApoyo((xs) => [...xs, { employee_id: emp.id, tipo: 'recepcion', employees: emp }]);
    setAvisoApoyo(`${shortEmployeeName(emp)} anotado. Escanea el siguiente o cierra.`);
    return false;
  };
  useEffect(() => { cargar(); }, [cargar]);

  const derivado = useMemo(() => {
    if (!datos) return null;
    const { items, paginaItems, recibidas, fila } = datos;
    const porContar = items.filter((r) => r.status === 'pendiente' && (r.cantidad_asignada ?? 0) > 0 && !r.falta_caja);
    const pendientes = new Set(porContar.map((r) => r.id));
    const hojaNums = Object.keys(paginaItems).map(Number).sort((a, b) => a - b);
    const idsPorHoja = Object.fromEntries(hojaNums.map((n) => [n, (paginaItems[String(n)] ?? []).filter((id) => pendientes.has(id))]));
    const estado = estadoDeHojas({
      hojaNums, paginaItems, pendientesPorHoja: Object.fromEntries(hojaNums.map((n) => [n, idsPorHoja[n].length])),
      hojasRecibidas: recibidas,
      itemsEnReenvio: items.filter((r) => r.falta_caja && r.status === 'pendiente').map((r) => r.id),
      itemsYaContados: items.filter((r) => r.status !== 'pendiente').map((r) => r.id),
    });
    const guardadas = Array.isArray(fila.cajas_especiales) && fila.cajas_especiales.length ? fila.cajas_especiales : construirCajasEspeciales(items);
    const especiales = [];
    for (const c of guardadas) {
      const it = items.find((r) => r.id === c.pedido_item_id);
      if (!it) continue;
      const ya = especiales.find((e) => e.item.id === it.id);
      if (ya) ya.labels.push(c.label); else especiales.push({ labels: [c.label], item: it });
    }
    return { porContar, hojaNums, idsPorHoja, estado, especiales: especiales.filter((e) => !e.item.falta_caja), hayHojas: hojaNums.length > 0 };
  }, [datos]);

  const filasAbiertas = useMemo(() => {
    if (!abierto || !derivado) return [];
    if (abierto.tipo === 'especial') return derivado.porContar.filter((r) => r.id === abierto.especial.item.id);
    if (abierto.tipo === 'hoja') return derivado.porContar.filter((r) => derivado.idsPorHoja[abierto.hoja].includes(r.id));
    return derivado.porContar;
  }, [abierto, derivado]);

  const terminar = async (diferencia) => {
    const { error } = await avanzarEtapaDePedidoEnSala({ p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'recibir_erp', p_user_id: user?.id ?? null });
    if (error) throw error;
    useStaffStore.getState().appendAuditLog?.('PEDIDO_LIFECYCLE_RECIBIR_ERP', pedidoId, { sucursal_id: sucId, desde: 'app' });
    const items = await fetchPedidoItemsAll(pedidoId, sucId);
    if (diferencia || (items ?? []).some((r) => r.status === 'con_diferencia')) {
      const { error: e2 } = await avanzarEtapaDePedidoEnSala({ p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'reportar_diferencias', p_user_id: user?.id ?? null });
      if (!e2) useStaffStore.getState().appendAuditLog?.('PEDIDO_DIFERENCIAS_REPORTADAS', pedidoId, { sucursal_id: sucId, desde: 'app' });
    }
  };

  const confirmar = async (todoOk) => {
    const filas = filasAbiertas;
    if (!filas.length) return;
    setGuardando(true); trabajando(todoOk ? 'Confirmando que vino completo…' : 'Guardando el conteo…');
    try {
      const p_items = filas.map((r) => (todoOk ? renglonTodoOk(r) : renglonContado(r, valores[r.id] ?? {})));
      const contexto = abierto.tipo === 'especial' ? { accion: 'CONFIRMAR_RECEPCION_ESPECIAL', especial: abierto.especial.labels.join('–'), desde: 'app', ...(todoOk ? { todo_ok: true } : {}) }
        : abierto.tipo === 'hoja' ? {} : { accion: 'CONFIRMAR_RECEPCION_PEDIDO', desde: 'app', ...(todoOk ? { todo_ok: true } : {}) };
      const { error } = await recibirPedidoDeSucursal({ p_pedido_id: pedidoId, p_sucursal_id: sucId, p_items, p_received_by: user?.id ?? null }, contexto);
      if (error) throw error;
      // El ingreso al inventario va en segundo plano: el conteo ya quedó.
      recibirTrasladoPedido(pedidoId, sucId, { itemIds: p_items.map((x) => x.pedido_item_id), enSegundoPlano: true }).catch(() => {});
      const diferencia = huboDiferencia || p_items.some((x) => x.error_tipo !== null);
      setHuboDiferencia(diferencia);

      // ¿Queda algo? Las hojas que faltan y las especiales sin contar.
      const quedaHoja = derivado.hojaNums.filter((n) => derivado.estado[n] === 'pendiente' && !(abierto.tipo === 'hoja' && n === abierto.hoja)).length > 0;
      const quedaEsp = derivado.especiales.some((e) => e.item.status === 'pendiente' && !(abierto.tipo === 'especial' && e.item.id === abierto.especial.item.id));
      const todo = abierto.tipo === 'pedido' || (!quedaHoja && !quedaEsp);

      if (abierto.tipo === 'hoja') {
        const nuevas = [...new Set([...(datos.recibidas ?? []), abierto.hoja])].sort((a, b) => a - b);
        const { error: eh } = await marcarHojasRecibidas(pedidoId, sucId, nuevas, {
          hojas: [{ hoja: abierto.hoja, items_count: p_items.length }], pedido: todo ? { extras_count: 0 } : null, desde: 'app', ...(todoOk ? { todo_ok: true } : {}),
        });
        if (eh) throw eh;
      }
      if (todo) {
        await terminar(diferencia);
        listo('Pedido recibido', diferencia ? 'Las diferencias quedaron reportadas a Bodega' : 'Todo quedó contado');
        router.back();
        return;
      }
      listo(abierto.tipo === 'hoja' ? `Hoja ${abierto.hoja} contada` : 'Caja contada', diferencia ? 'Con diferencias' : 'Sin diferencias');
      setAbierto(null); setValores({});
      await cargar();
    } catch (e) {
      fallo('No se pudo guardar el conteo', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  // Recibir UN producto sin contar el resto de la caja: cuenta e ingresa ese
  // traslado entero (cada producto viaja en el suyo).
  const soloEste = (r) => Alert.alert('Recibir sólo este', `${r.products?.nombre ?? ''}\n\nSe cuenta como lo anotaste y entra al inventario ya, sin contar el resto.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Recibir', onPress: async () => {
      setGuardando(true); trabajando('Recibiendo…');
      try {
        const { error, erp } = await recibirProductoSuelto({
          pedidoId, sucursalId: sucId, items: [renglonContado(r, valores[r.id] ?? {})], receivedBy: user?.id ?? null, itemId: r.id,
        }, { producto: r.products?.nombre ?? null, desde: 'app' });
        if (error) throw error;
        if (!erp?.ok && erp?.codigo !== 'NADA_QUE_RECIBIR') fallo('Quedó contado, pero no entró al inventario', `${erp?.error ?? 'Sin detalle'}. Todavía no se puede facturar.`);
        else listo('Recibido', 'Ya está en el inventario.');
        setValores((v) => { const n = { ...v }; delete n[r.id]; return n; });
        await cargar();
      } catch (e) {
        fallo('No se pudo recibir', mensajeAmigable(e));
      } finally {
        setGuardando(false);
      }
    } },
  ]);

  // Corregir lo YA contado: no mueve existencias, deja la diferencia.
  const corregir = (r, cantidad, nota, cerrar) => Alert.alert('Corregir el conteo', `${r.products?.nombre ?? ''}: ${Number(r.cantidad_recibida) || 0} → ${cantidad}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Corregir', onPress: async () => {
      setGuardando(true);
      try {
        const { data, error } = await corregirRecepcionDeItem({ itemId: r.id, cantidad, nota, pedidoId }, {
          sucursal_id: sucId, producto: r.products?.nombre ?? null, antes: Number(r.cantidad_recibida) || 0, desde: 'app',
        });
        if (error) throw error;
        listo('Corregido', (data?.error_tipo ? 'Quedó anotado como diferencia. Bodega tiene que contestar antes de que el producto se mueva.' : 'El conteo ahora coincide con lo enviado.')
          + (data?.reabrio_el_cierre ? ' El pedido ya estaba cerrado: vuelve a quedar abierto.' : ''));
        cerrar?.();
        await cargar();
      } catch (e) {
        fallo('No se pudo corregir', mensajeAmigable(e));
      } finally {
        setGuardando(false);
      }
    } },
  ]);

  // Estables para que el renglón memoizado no se repinte entero en cada toque.
  const cambiar = useCallback((id, p) => setValores((v) => ({ ...v, [id]: { ...(v[id] ?? {}), ...p } })), []);
  const soloRef = useRef(soloEste);
  soloRef.current = soloEste;
  const solo = useCallback((r) => soloRef.current(r), []);

  const titulo = `Contar #${numero ?? ''}`;
  if (!derivado) return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} /><ActivityIndicator style={{ marginTop: 120 }} /></>);

  if (abierto) {
    const nombre = abierto.tipo === 'hoja' ? `Hoja ${abierto.hoja}` : abierto.tipo === 'especial' ? `Caja ${abierto.especial.labels.join('–')}` : 'Todo el pedido';
    const editado = filasAbiertas.some((r) => valores[r.id]);
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: nombre }} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
            contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
            <Pressable onPress={() => { setAbierto(null); setValores({}); }} style={{ minHeight: 36, justifyContent: 'center' }}>
              <Text style={{ color: colorSistema.acento, fontSize: 15 }}>‹ Volver a las hojas</Text>
            </Pressable>
            <Seccion titulo={`${filasAbiertas.length} producto${filasAbiertas.length === 1 ? '' : 's'}`}>
              {filasAbiertas.map((r, i) => (
                <Renglon key={r.id} r={r} primero={!i} valor={valores[r.id] ?? SIN_VALOR} ocupado={guardando}
                  onSolo={filasAbiertas.length > 1 ? solo : null} onCambiar={cambiar} />
              ))}
            </Seccion>
            {!editado ? <BotonGrande texto={guardando ? 'Guardando…' : 'Todo llegó bien'} color={MARCA.verde} deshabilitado={guardando} onPress={() => confirmar(true)} /> : null}
            <BotonGrande texto={guardando ? 'Guardando…' : `Confirmar ${abierto.tipo === 'hoja' ? 'la hoja' : 'el conteo'}`} color={MARCA.azul} borde={!editado} deshabilitado={guardando} onPress={() => confirmar(false)} />
          </ScrollView>
        </KeyboardAvoidingView>
      </>
    );
  }

  const { hojaNums, estado, especiales, hayHojas, porContar } = derivado;
  const contadas = hojaNums.filter((n) => estado[n] === 'contada').length;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {!porContar.length ? <Aviso tono="nota" texto="No queda nada por contar en este pedido." /> : null}
        {hayHojas ? (
          <Seccion titulo={`Hojas · ${contadas} de ${hojaNums.filter((n) => estado[n] !== 'reenvio').length} contadas`}>
            {hojaNums.map((n, i) => {
              const e = estado[n];
              const [rotulo, color] = e === 'contada' ? ['Contada', MARCA.verde] : e === 'reenvio' ? ['En reenvío', MARCA.ambar] : ['Por contar', MARCA.azulClaro];
              const etiqueta = datos.paginas?.[n - 1]?.firstLab || datos.paginas?.[n - 1]?.firstItem || '';
              return (
                <Pressable key={n} disabled={e !== 'pendiente'} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto({ tipo: 'hoja', hoja: n }); }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{`Hoja ${n}`}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{[etiqueta, `${derivado.idsPorHoja[n].length} por contar`].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Pildora texto={rotulo} color={color} />
                </Pressable>
              );
            })}
          </Seccion>
        ) : porContar.length ? (
          <BotonGrande texto={`Contar todo el pedido · ${porContar.length}`} color={MARCA.azul} onPress={() => setAbierto({ tipo: 'pedido' })} />
        ) : null}
        {especiales.length ? (
          <Seccion titulo="Cajas especiales">
            {especiales.map((e, i) => {
              const hecha = e.item.status !== 'pendiente';
              return (
                <Pressable key={e.item.id} disabled={hecha} onPress={() => setAbierto({ tipo: 'especial', especial: e })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{e.labels.join('–')}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{e.item.products?.nombre ?? ''}</Text>
                  </View>
                  <Pildora texto={hecha ? 'Contada' : 'Por contar'} color={hecha ? MARCA.verde : MARCA.azulClaro} />
                </Pressable>
              );
            })}
          </Seccion>
        ) : null}
        {(() => {
          const contados = (datos.items ?? []).filter((r) => !r.es_extra && ['recibido', 'con_diferencia'].includes(r.status));
          return contados.length ? (
            <Seccion titulo={`Ya contados · ${contados.length}`} pie="Si contaste mal, corrígelo: queda como diferencia y se habla con Bodega.">
              {contados.map((r, i) => <Contado key={r.id} r={r} primero={!i} ocupado={guardando} onCorregir={corregir} />)}
            </Seccion>
          ) : null;
        })()}
        <BotonGrande texto="Llegó algo que no venía en el pedido" borde
          onPress={() => router.push({ pathname: '/pedido/extras', params: { pedidoId: String(pedidoId), sucId: String(sucId), numero: String(numero ?? '') } })} />
        <Seccion titulo={`Quién ayudó a recibir · ${apoyo.length}`}>
          {apoyo.map((a, i) => (
            <Text key={a.employee_id} style={{ color: colorSistema.texto, fontSize: 15, paddingVertical: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              {shortEmployeeName(a.employees ?? {})}
            </Text>
          ))}
          <BotonGrande texto="Escanear el carné de quien ayudó" borde onPress={() => { setAvisoApoyo(null); setEscaneando(true); }} />
        </Seccion>
        <Vidrio radio={18}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, padding: 12 }}>
            Cuenta cada hoja con su papel. Si algo no cuadra, quedará como diferencia y se resuelve con Bodega.
          </Text>
        </Vidrio>
      </ScrollView>
      <Escaner visible={escaneando} titulo="Quién ayudó a recibir" ayuda="Apunta al código del carné; puedes escanear varios seguidos"
        onCodigo={leerCarne} onCerrar={() => setEscaneando(false)}
        pie={avisoApoyo ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{avisoApoyo}</Text> : null} />
    </>
  );
}
