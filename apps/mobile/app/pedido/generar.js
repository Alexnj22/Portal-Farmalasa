// Generar un pedido de Bodega a las salas, NATIVO — `TabGenerar` del portal:
// las salas con su urgencia (productos bajo mínimo, `urgenciaDeSala`), cuántos productos tienen con
// y sin existencia en Bodega, la distribución global, y «Generar».
//
// Calcula, confirma y pone el código de cada sala con `generarPedidoDirecto`
// (núcleo), lo mismo que el portal. Después, igual que la computadora:
// guarda en qué hoja va cada producto (`capturarHojasDelPedido` con la imprenta
// del teléfono, que da las MISMAS hojas) y arma el PDF de cada sala, y pregunta
// UNA vez si imprimirlo, compartirlo o guardarlo. Así el pedido entero —generar,
// imprimir y finalizar— se puede hacer desde el teléfono.
// Una sala sin MIN·MAX publicado no se puede elegir.
//
// Como el portal: cada sala dice cuántos productos tiene bajo mínimo y en
// cero y cuándo fue su último pedido; «Generar» primero calcula la vista
// previa (`vistaPreviaDePedido`) y muestra el resumen por sala
// (`resumenPorSala`) — «Revisa antes de confirmar» —, y «Confirmar» guarda ESA
// misma vista previa (`confirmarPedidoDirecto`). Abajo, «Productos sin stock en
// Bodega»: lo que piden las salas y Bodega no tiene para despachar.
import { volver } from '../../componentes/volver';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Interruptor from '../../componentes/Interruptor';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchTableroParaGenerarPedido } from '@nucleo/data/pedidos';
import { capturarHojasDelPedido, confirmarPedidoDirecto, vistaPreviaDePedido } from '@nucleo/data/accionesDePedido';
import { resumenPorSala } from '@nucleo/utils/logicaDeRutas';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { hojasExactas } from '../../componentes/pedidos/motorPedido';
import { ofrecerPapelesDelPedido, papelesAlGenerar } from '../../componentes/pedidos/papelDelPedido';
import { nivelDeUrgenciaDeSala, ordenarSinBodega, salaSinMinMaxPublicado, ultimoPedidoDeSala, urgenciaDeSala } from '@nucleo/utils/tableroDePedidos';
import { ERP_NAMES, SUCURSALES } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MenuDeFiltros } from '../../componentes/Filtros';
import ConAurora from '../../componentes/ConAurora';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const COLOR_URGENCIA = { high: MARCA.rojo, mid: MARCA.ambar, low: MARCA.verde, none: colorSistema.texto2 };
const COLOR_ULTIMO = { bien: MARCA.verde, cuidado: MARCA.ambar, tarde: MARCA.rojo };
const ORDENES_SIN_BODEGA = [
  { id: 'total_necesidad:desc', label: 'Lo que más se necesita' },
  { id: 'total_ventas_6m:desc', label: 'Lo que más se vende' },
  { id: 'product_name:asc', label: 'Producto, A → Z' },
  { id: 'laboratorio:asc', label: 'Laboratorio, A → Z' },
];

/* «Revisa antes de confirmar»: el resumen por sala de la vista previa. */
function Resumen({ flujo, confirmando, onVolver, onConfirmar }) {
  if (!flujo) return null;
  const resumen = resumenPorSala(flujo.rows);
  const tot = resumen.reduce((a, s) => ({ renglones: a.renglones + s.renglones, unidades: a.unidades + s.unidades }), { renglones: 0, unidades: 0 });
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={confirmando ? () => {} : onVolver}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 48 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>Revisa antes de confirmar</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              {`${resumen.length} sala${resumen.length !== 1 ? 's' : ''} · ${tot.renglones.toLocaleString('es-SV')} renglones · ${tot.unidades.toLocaleString('es-SV')} unidades${flujo.global ? ' · distribución global' : ''}`}
            </Text>
          </View>
          {resumen.map((s) => (
            <Vidrio key={s.erp_sucursal_id} radio={18}>
              <View style={{ padding: 12, gap: 6 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{ERP_NAMES[s.erp_sucursal_id] ?? `Sucursal ${s.erp_sucursal_id}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${s.renglones.toLocaleString('es-SV')} ${s.renglones === 1 ? 'renglón' : 'renglones'} · ${s.unidades.toLocaleString('es-SV')} unidad${s.unidades !== 1 ? 'es' : ''}`}
                </Text>
                {s.revision > 0 || s.agotamiento > 0 || s.sinStock > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {s.revision > 0 ? <Pildora texto={`${s.revision} en revisión`} color={MARCA.ambar} /> : null}
                    {s.agotamiento > 0 ? <Pildora texto={`${s.agotamiento} por agotamiento`} color={MARCA.violeta} /> : null}
                    {s.sinStock > 0 ? <Pildora texto={`${s.sinStock} sin stock en Bodega`} color={MARCA.rojo} /> : null}
                  </View>
                ) : null}
              </View>
            </Vidrio>
          ))}
          <Aviso texto="Lo que ves es lo que se confirma. No se deshace desde aquí: para quitarlo hay que anularlo." />
          <BotonGrande texto={confirmando ? 'Confirmando…' : 'Confirmar'} color={MARCA.verde} deshabilitado={confirmando} onPress={onConfirmar} />
          <BotonGrande texto="Volver" borde deshabilitado={confirmando} onPress={onVolver} />
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

/* «Productos sin stock en Bodega»: lo que piden las salas y Bodega no tiene. */
function SinStockEnBodega({ filas }) {
  const [buscar, setBuscar] = useState('');
  const [orden, setOrden] = useState(ORDENES_SIN_BODEGA[0].id);
  const [mostrar, setMostrar] = useState(15);
  const lista = useMemo(() => {
    const base = buscar.trim() ? smartFilter(buscar.trim(), filas, (r) => [r.product_name, r.laboratorio]).results : filas;
    const [campo, dir] = orden.split(':');
    return ordenarSinBodega(base, campo, dir);
  }, [filas, buscar, orden]);
  return (
    <Seccion titulo={`Productos sin stock en Bodega · ${filas.length.toLocaleString('es-SV')}`} pie="Lo que piden las sucursales y Bodega no tiene para despachar. Entre paréntesis, lo vendido en 6 meses.">
      <MenuDeFiltros grupos={[{ id: 'orden', titulo: 'Ordenar', activa: orden, porDefecto: ORDENES_SIN_BODEGA[0].id, onCambiar: setOrden,
        opciones: ORDENES_SIN_BODEGA }]} />
      {filas.length > 8 ? <Campo multiline={false} value={buscar} onChangeText={(t) => { setBuscar(t); setMostrar(15); }} placeholder="Buscar producto o laboratorio" autoCorrect={false} /> : null}
      {!lista.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{buscar.trim() ? `Sin resultados para «${buscar.trim()}».` : 'No hay productos sin stock en Bodega.'}</Text> : null}
      {lista.slice(0, mostrar).map((r, i) => (
        <View key={r.erp_product_id} style={{ gap: 4, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{r.product_name}</Text>
              {r.laboratorio ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{r.laboratorio}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{r.total_necesidad}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{r.total_ventas_6m > 0 ? `${Math.round(r.total_ventas_6m)} en 6 m` : 'necesita'}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(r.sucursales || []).map((x) => (
              <Pildora key={x.erp_sucursal_id} color={MARCA.rojo}
                texto={`${ERP_NAMES[x.erp_sucursal_id] ?? x.erp_sucursal_id} · ${x.reponer}${x.ventas_6m > 0 ? ` (${Math.round(x.ventas_6m)})` : ''}`} />
            ))}
          </View>
        </View>
      ))}
      {lista.length > mostrar ? <BotonGrande texto={`Ver más · quedan ${lista.length - mostrar}`} borde onPress={() => setMostrar((m) => m + 30)} /> : null}
    </Seccion>
  );
}

export default function GenerarPedido() {
  const { user, hasPermission, getScope } = useAuth();
  const puede = hasPermission('pedidos', 'can_edit') && getScope?.('pedidos') === 'ALL';
  const empleados = useStaffStore((s) => s.employees);
  const [stats, setStats] = useState(null);
  const [sinBodega, setSinBodega] = useState([]);
  const [errorTablero, setErrorTablero] = useState(null);
  const [flujo, setFlujo] = useState(null);       // { rows, salas, global } — el resumen abierto
  const [preparando, setPreparando] = useState(false);
  const [elegidas, setElegidas] = useState(() => new Set());
  const [global, setGlobal] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await Promise.resolve(fetchTableroParaGenerarPedido({ p_sucursal_ids: SUCURSALES })).catch((e) => ({ error: e }));
    // Un error al leer el tablero NO es «no hay nada»: se dice.
    setErrorTablero(error ? mensajeAmigable(error) : null);
    setStats(error ? [] : (Array.isArray(data?.stats) ? data.stats : []));
    setSinBodega(error ? [] : (Array.isArray(data?.sin_bodega) ? data.sin_bodega : []));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porSala = useMemo(() => new Map((stats ?? []).map((s) => [s.erp_sucursal_id, s])), [stats]);
  const elegibles = SUCURSALES.filter((id) => !salaSinMinMaxPublicado(porSala.get(id)));
  const todas = elegibles.length > 0 && elegibles.every((id) => elegidas.has(id));
  const esEmpleado = useMemo(() => (empleados || []).some((e) => String(e.id) === String(user?.id)), [empleados, user?.id]);

  const alternar = (id) => {
    Haptics.selectionAsync().catch(() => {});
    setElegidas((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  // Paso 1: la vista previa y el resumen por sala.
  const preparar = async () => {
    setPreparando(true);
    trabajando('Calculando el pedido…');
    try {
      const rows = await vistaPreviaDePedido({ salas: [...elegidas], globalMode: global });
      if (!rows.length) { listo('Sin necesidades', 'Las salas elegidas están abastecidas: no hay nada que pedir.'); return; }
      listo('Listo para revisar');
      setFlujo({ rows, salas: [...elegidas], global });
    } catch (e) {
      const msg = /statement timeout|canceling statement/i.test(e?.message ?? '') ? 'El cálculo tardó demasiado. Intenta con menos salas a la vez.' : mensajeAmigable(e);
      fallo('No se pudo calcular el pedido', msg);
    } finally {
      setPreparando(false);
    }
  };

  // Paso 2: confirmar ESA vista previa.
  const generar = async () => {
    if (!flujo) return;
    setGenerando(true);
    trabajando('Confirmando el pedido…');
    try {
      const gen = await confirmarPedidoDirecto({ rows: flujo.rows, salas: flujo.salas, globalMode: flujo.global, userId: user?.id ?? null, responsableId: esEmpleado ? user.id : null });
      setFlujo(null);
      useStaffStore.getState().appendAuditLog?.('PEDIDO_GENERADO', gen.pedidoId, { numero: gen.numero, salas: gen.sucIds, productos: gen.items.length, desde: 'app' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Sin número (la lectura falló dos veces) se dice «El pedido», nunca «#null».
      const rotulo = gen.numero != null ? `Pedido #${gen.numero}` : 'El pedido';
      const avisoCodigos = gen.codigosError ? ' Los códigos de las salas no se guardaron: avisa al equipo de sistemas.' : '';
      // Las hojas (qué producto va en qué hoja) se guardan ANTES de soltar la
      // pantalla: son las que después reparte «Finalizar».
      trabajando('Guardando las hojas…');
      const hojas = await capturarHojasDelPedido(gen.pedidoId, gen.sucIds, hojasExactas);
      trabajando('Armando el papel…');
      const nombrePersona = user?.name ?? null;
      const meta = { responsable: nombrePersona, revisor: null, generadoPor: nombrePersona, pedidoNumero: gen.numero ?? undefined };
      let archivos = [];
      let fallaPapel = null;
      try { archivos = await papelesAlGenerar(gen, meta); } catch (e) { fallaPapel = e; }
      const avisoHojas = hojas.capturadas < hojas.total ? ' Las hojas quedaron a medias: se recalculan al finalizar.' : '';
      listo(`${rotulo} confirmado`, `${gen.items.length} productos en ${gen.sucIds.length} sala${gen.sucIds.length === 1 ? '' : 's'}.${avisoHojas}${avisoCodigos}`);
      setElegidas(new Set());
      volver('/pedidos');
      if (fallaPapel) {
        fallo('El pedido quedó, pero el papel no se armó', `${mensajeAmigable(fallaPapel)} Se puede imprimir desde el pedido.`);
      } else if (archivos.length) {
        ofrecerPapelesDelPedido({
          archivos,
          titulo: `${rotulo} · el papel`,
          mensaje: archivos.length > 1 ? `Un PDF por sala (${archivos.length}).` : undefined,
          nombreZip: gen.numero != null ? `Pedido ${gen.numero}` : 'Pedido',
          pedidoId: gen.pedidoId,
          alFallar: (e) => fallo('No se pudo', mensajeAmigable(e)),
        });
      }
    } catch (e) {
      const msg = /statement timeout|canceling statement/i.test(e?.message ?? '') ? 'El cálculo tardó demasiado. Intenta con menos salas a la vez.' : mensajeAmigable(e);
      setFlujo(null);
      fallo('No se pudo generar el pedido', msg);
    } finally {
      setGenerando(false);
    }
  };

  if (!puede) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Generar pedido' }} /><View style={{ padding: 16 }}><Aviso tono="cuidado" texto="Generar pedidos es de Bodega (permiso de pedidos para todas las salas)." /></View></>;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Generar pedido', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {stats == null ? <ActivityIndicator style={{ marginTop: 30 }} /> : (
          <>
            {errorTablero ? <Aviso tono="freno" texto={`No se pudo leer cómo están las sucursales: ${errorTablero}`} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Elige las salas a reponer.</Text>
              <Pressable onPress={() => setElegidas(todas ? new Set() : new Set(elegibles))} hitSlop={8}>
                <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>{todas ? 'Quitar la selección' : 'Todas'}</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {SUCURSALES.map((id) => {
                const st = porSala.get(id);
                const sin = salaSinMinMaxPublicado(st);
                const on = elegidas.has(id);
                const nivel = nivelDeUrgenciaDeSala(st);
                const urg = urgenciaDeSala(st);
                return (
                  <Pressable key={id} disabled={sin} onPress={() => alternar(id)} style={({ pressed }) => ({ width: '48%', opacity: sin ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                    <Vidrio radio={18} interactivo={!sin} tinte={on ? 'rgba(0,82,204,0.35)' : undefined}>
                      <View style={{ padding: 12, gap: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{ERP_NAMES[id]}</Text>
                          {on ? <Text style={{ color: MARCA.azulClaro, fontSize: 18, fontWeight: '800' }}>✓</Text> : null}
                        </View>
                        {sin ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Sin MIN·MAX publicado</Text> : (
                          <>
                            <Text style={{ color: COLOR_URGENCIA[nivel], fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                              {urg != null ? `${Math.round(urg)}%` : '—'}
                            </Text>
                            {st?.bajo_min_productos != null ? (
                              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                                {`${st.bajo_min_productos} bajo mínimo${st.en_cero_productos > 0 ? ` · ${st.en_cero_productos} en cero` : ''}`}
                              </Text>
                            ) : null}
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${st?.con_bodega_productos ?? 0} con Bodega · ${st?.sin_bodega_productos ?? 0} sin`}</Text>
                            {(() => {
                              const up = ultimoPedidoDeSala(st?.last_pedido_at);
                              return <Text style={{ color: COLOR_ULTIMO[up.nivel] ?? colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{up.texto ? `Último pedido ${up.texto}` : 'Sin pedidos aún'}</Text>;
                            })()}
                          </>
                        )}
                      </View>
                    </Vidrio>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 4 }}>El porcentaje es cuánto se ha vaciado la sala en promedio (depleción): rojo desde 65%, ámbar desde 40%.</Text>
            <Seccion pie="La Bodega se reparte considerando lo que necesitan TODAS las salas, pero el pedido incluye sólo las elegidas.">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Distribución global de Bodega</Text>
                <Interruptor value={global} onValueChange={setGlobal} />
              </View>
            </Seccion>
            <Aviso texto="Al generar, el papel de cada sala sale aquí mismo: se imprime, se comparte o se guarda. Es el mismo PDF de la computadora." />
            <BotonGrande texto={preparando ? 'Calculando…' : elegidas.size ? `Generar pedido · ${elegidas.size} sala${elegidas.size === 1 ? '' : 's'}` : 'Elige al menos una sala'}
              color={MARCA.azul} onPress={preparar} deshabilitado={!elegidas.size || preparando || generando} />
            {!errorTablero ? <SinStockEnBodega filas={sinBodega} /> : null}
          </>
        )}
      </ScrollView>
      <Resumen flujo={flujo} confirmando={generando} onVolver={() => setFlujo(null)} onConfirmar={generar} />
    </>
  );
}
