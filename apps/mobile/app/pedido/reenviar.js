// Reenviar lo que no llegó a una sala, NATIVO — el diálogo «Lo que no llegó
// del pedido» del portal: las cajas numeradas y el Electrolit se reenvían
// enteros; cada caja especial se puede reenviar o NO reenviar (el producto
// regresa a bodega y la sala deja de verlo pendiente — no se deshace).
//
// «No reenviar» va PRIMERO y, si falla, no se reenvía nada: es la misma
// decisión y quien la tomó tiene que ver el error antes de que la mitad ya
// esté hecha. Igual que el portal (`handleResolverFaltantes`).
import { volver } from '../../componentes/volver';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPedidosEnCurso, noReenviarEspeciales } from '@nucleo/data/pedidos';
import { registrarReenvio } from '@nucleo/data/accionesDeBodega';
import { faltantesDeLaSala } from '@nucleo/utils/tableroDePedidos';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

export default function ReenviarFaltantes() {
  const { pedidoId, sucId, numero } = useLocalSearchParams();
  const suc = Number(sucId);
  const [faltan, setFaltan] = useState(null);
  const [noVa, setNoVa] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await fetchPedidosEnCurso();
    const row = (data ?? []).find((r) => String(r.pedido_id) === String(pedidoId) && Number(r.erp_sucursal_id) === suc);
    setFaltan(row ? faltantesDeLaSala(row) : { hay: false, cajas: [], electrolits: 0, productosEspeciales: [] });
  }, [pedidoId, suc]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!faltan) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reenviar' }} /><ActivityIndicator style={{ marginTop: 40 }} /></>;

  const productos = faltan.productosEspeciales ?? [];
  const aCancelar = productos.filter((p) => noVa.includes(p.itemId));
  const aReenviar = productos.filter((p) => !noVa.includes(p.itemId));
  const hayReenvio = faltan.cajas.length > 0 || faltan.electrolits > 0 || aReenviar.length > 0;
  const cancelables = productos.filter((p) => !p.parcial);

  const hacer = async () => {
    let claveReenvio = null;
    setGuardando(true);
    trabajando('Guardando…');
    try {
      if (aCancelar.length) {
        const labels = aCancelar.flatMap((p) => p.labels);
        const r = await noReenviarEspeciales(pedidoId, suc, labels);
        if (!r?.ok) throw new Error(r?.error ?? 'No se pudo cancelar el reenvío.');
        useStaffStore.getState().appendAuditLog?.('PEDIDO_NO_REENVIO', pedidoId, {
          sucursal_id: suc, labels, items: r.items ?? [], traslados_anulados: r.anulados ?? [], ya_anulados: r.ya_anulados ?? [], desde: 'app',
        });
      }
      if (hayReenvio) {
        const especiales = aReenviar.flatMap((p) => p.labels.map((label) => ({ label, producto: p.producto })));
        const { ciclo, clave, especialesLabels } = await registrarReenvio({ pedidoId, sucId: suc, cajas: faltan.cajas, electrolits: faltan.electrolits, especiales });
        claveReenvio = clave ?? `${pedidoId}__${suc}__r${ciclo}`;
        useStaffStore.getState().appendAuditLog?.('PEDIDO_REENVIO_CAJA', pedidoId, {
          sucursal_id: suc, ciclo, cajas: faltan.cajas, electrolits: faltan.electrolits, especiales: especialesLabels, desde: 'app',
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(hayReenvio ? 'Reenvío registrado' : 'Reenvío cancelado', hayReenvio ? 'Ahora arma la ruta para que salga.' : 'El producto regresa a bodega.');
      // Como el portal: registrado el reenvío, se abre armar la ruta con esta sala.
      if (hayReenvio) router.replace({ pathname: '/pedido/ruta/nueva', params: { con: claveReenvio } });
      else volver('/pedidos');
    } catch (e) {
      fallo('No se pudo', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };
  const confirmar = () => Alert.alert(`Pedido #${numero}`,
    [hayReenvio ? 'Se registra el reenvío y la sala recibe el aviso.' : null,
      aCancelar.length ? `${aCancelar.map((p) => p.labels.join('–')).join(', ')} no se reenvía: regresa a bodega. No se puede deshacer.` : null].filter(Boolean).join('\n\n'),
    [{ text: 'Cancelar', style: 'cancel' }, { text: !hayReenvio ? 'No reenviar' : aCancelar.length ? 'Confirmar' : 'Reenviar', style: aCancelar.length ? 'destructive' : 'default', onPress: hacer }]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Lo que no llegó', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{`Pedido #${numero} · ${ERP_NAMES[suc] ?? ''}`}</Text>
        {!faltan.hay ? <Aviso texto="No falta nada por reenviar en esta sala." /> : (
          <>
            {faltan.cajas.length || faltan.electrolits ? (
              <Seccion titulo="Se reenvía">
                {faltan.cajas.length ? <Dato primero rotulo={`Caja${faltan.cajas.length > 1 ? 's' : ''}`} valor={faltan.cajas.map((n) => `#${n}`).join(', ')} /> : null}
                {faltan.electrolits ? <Dato primero={!faltan.cajas.length} rotulo="Electrolit" valor={`${faltan.electrolits} faltante${faltan.electrolits > 1 ? 's' : ''}`} /> : null}
              </Seccion>
            ) : null}
            {productos.length ? (
              <Seccion titulo="Cajas especiales" pie={cancelables.length > 1 ? 'Cada una se decide por separado.' : null}>
                {productos.map((p) => (
                  <View key={p.itemId} style={{ gap: 8, paddingVertical: 4 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${p.labels.join('–')}${p.producto ? ` · ${p.producto}` : ''}`}</Text>
                    {p.parcial ? (
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Una de sus cajas sí llegó. Va en un solo traslado: se reenvía.</Text>
                    ) : (
                      <Segmentos margen={0} activa={noVa.includes(p.itemId) ? 'no' : 'si'}
                        onCambiar={(v) => setNoVa((xs) => (v === 'no' ? [...new Set([...xs, p.itemId])] : xs.filter((id) => id !== p.itemId)))}
                        opciones={[{ id: 'si', label: 'Reenviar' }, { id: 'no', label: 'No reenviar' }]} />
                    )}
                  </View>
                ))}
              </Seccion>
            ) : null}
            {aCancelar.length ? <Aviso tono="cuidado" texto={`${aCancelar.map((p) => p.labels.join('–')).join(', ')} no se reenvía: el producto regresa a bodega y la sala deja de verlo pendiente. No se puede deshacer.`} /> : null}
            <BotonGrande texto={guardando ? 'Guardando…' : !hayReenvio ? 'No reenviar' : aCancelar.length ? 'Confirmar' : 'Reenviar'}
              color={aCancelar.length && !hayReenvio ? MARCA.rojo : MARCA.azul} deshabilitado={guardando} onPress={confirmar} />
          </>
        )}
      </ScrollView>
    </>
  );
}
