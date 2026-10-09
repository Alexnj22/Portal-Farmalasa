// Generar un pedido de Bodega a las salas, NATIVO — `TabGenerar` del portal:
// las salas con su urgencia (productos bajo mínimo, `urgenciaDeSala`), cuántos productos tienen con
// y sin existencia en Bodega, la distribución global, y «Generar».
//
// Calcula, confirma y pone el código de cada sala con `generarPedidoDirecto`
// (núcleo), lo mismo que el portal. Lo único que NO hace es imprimir: el papel
// sale de la computadora de Bodega (Pedidos → PDF), que es donde está la
// impresora. Una sala sin MIN·MAX publicado no se puede elegir.
import { volver } from '../../componentes/volver';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchTableroParaGenerarPedido } from '@nucleo/data/pedidos';
import { generarPedidoDirecto } from '@nucleo/data/accionesDePedido';
import { nivelDeUrgenciaDeSala, salaSinMinMaxPublicado, urgenciaDeSala } from '@nucleo/utils/tableroDePedidos';
import { ERP_NAMES, SUCURSALES } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const COLOR_URGENCIA = { high: MARCA.rojo, mid: MARCA.ambar, low: MARCA.verde, none: colorSistema.texto2 };

export default function GenerarPedido() {
  const { user, hasPermission, getScope } = useAuth();
  const puede = hasPermission('pedidos', 'can_edit') && getScope?.('pedidos') === 'ALL';
  const empleados = useStaffStore((s) => s.employees);
  const [stats, setStats] = useState(null);
  const [elegidas, setElegidas] = useState(() => new Set());
  const [global, setGlobal] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await Promise.resolve(fetchTableroParaGenerarPedido({ p_sucursal_ids: SUCURSALES })).catch((e) => ({ error: e }));
    setStats(error ? [] : (Array.isArray(data?.stats) ? data.stats : []));
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

  const generar = async () => {
    setGenerando(true);
    trabajando('Calculando el pedido…');
    try {
      const gen = await generarPedidoDirecto({ salas: [...elegidas], globalMode: global, userId: user?.id ?? null, responsableId: esEmpleado ? user.id : null });
      if (!gen) { listo('Sin necesidades', 'Las salas elegidas están abastecidas: no hay nada que pedir.'); return; }
      useStaffStore.getState().appendAuditLog?.('PEDIDO_GENERADO', gen.pedidoId, { numero: gen.numero, salas: gen.sucIds, productos: gen.items.length, desde: 'app' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Sin número (la lectura falló dos veces) se dice «El pedido», nunca «#null».
      const rotulo = gen.numero != null ? `Pedido #${gen.numero}` : 'El pedido';
      const avisoCodigos = gen.codigosError ? ' Los códigos de las salas no se guardaron: avisa al equipo de sistemas.' : '';
      listo(`${rotulo} confirmado`, `${gen.items.length} productos en ${gen.sucIds.length} sala${gen.sucIds.length === 1 ? '' : 's'}. Imprímelo en la computadora de Bodega (Pedidos → PDF).${avisoCodigos}`);
      setElegidas(new Set());
      volver('/pedidos');
    } catch (e) {
      const msg = /statement timeout|canceling statement/i.test(e?.message ?? '') ? 'El cálculo tardó demasiado. Intenta con menos salas a la vez.' : mensajeAmigable(e);
      fallo('No se pudo generar el pedido', msg);
    } finally {
      setGenerando(false);
    }
  };
  const confirmar = () => Alert.alert('Generar pedido', `Se confirma el pedido para ${elegidas.size} sala${elegidas.size === 1 ? '' : 's'}${global ? ', repartiendo la Bodega entre todas' : ''}. No se deshace desde aquí: para quitarlo hay que anularlo.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Generar', onPress: generar },
  ]);

  if (!puede) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Generar pedido' }} /><View style={{ padding: 16 }}><Aviso tono="cuidado" texto="Generar pedidos es de Bodega (permiso de pedidos para todas las salas)." /></View></>;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Generar pedido', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {stats == null ? <ActivityIndicator style={{ marginTop: 30 }} /> : (
          <>
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
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${st?.con_bodega_productos ?? 0} con Bodega · ${st?.sin_bodega_productos ?? 0} sin`}</Text>
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
                <Switch value={global} onValueChange={setGlobal} />
              </View>
            </Seccion>
            <Aviso texto="El papel se imprime en la computadora de Bodega (Pedidos → PDF)." />
            <BotonGrande texto={generando ? 'Generando…' : elegidas.size ? `Generar pedido · ${elegidas.size} sala${elegidas.size === 1 ? '' : 's'}` : 'Elige al menos una sala'}
              color={MARCA.azul} onPress={confirmar} deshabilitado={!elegidas.size || generando} />
          </>
        )}
      </ScrollView>
    </>
  );
}
