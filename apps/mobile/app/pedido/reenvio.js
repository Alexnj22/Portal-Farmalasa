// Llegó el reenvío, NATIVO — `ReenvioLlegadaModal` del portal: por cada caja
// del ciclo pendiente, si llegó bien, dañada o sigue faltando; si llegó el
// Electrolit; qué cajas especiales llegaron; y una nota.
//
// La escritura es la del núcleo (`confirmarLlegadaDeReenvio`), la misma del
// portal: cierra el ciclo en el historial y deja `falta_caja` sólo en lo que
// sigue sin llegar. El aviso a Bodega si todavía falta algo lo escribe la base.
// Si llegaron renglones por contar, se sigue directo al conteo.
import { volver } from '../../componentes/volver';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPedidoItemsAll, fetchPedidosEnCurso } from '@nucleo/data/pedidos';
import { cicloDeReenvioPendiente, confirmarLlegadaDeReenvio, reenvioTodaviaEnBodega } from '@nucleo/data/accionesDePedido';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

const ESTADOS = [['ok', 'Llegó', MARCA.verde], ['danada', 'Dañada', MARCA.ambar], ['faltante', 'No llegó', MARCA.rojo]];

function Elegir({ valor, onCambiar, opciones = ESTADOS }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {opciones.map(([id, rotulo, color]) => {
        const on = valor === id;
        return (
          <Pressable key={id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(id); }}
            style={{ minHeight: 34, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 999, backgroundColor: on ? color : 'rgba(127,127,127,0.18)' }}>
            <Text style={{ color: on ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function LlegoElReenvio() {
  const { pedidoId, sucId, numero } = useLocalSearchParams();
  const suc = Number(sucId);
  const { user } = useAuth();
  const [row, setRow] = useState(undefined);
  const [cajas, setCajas] = useState({});
  const [especiales, setEspeciales] = useState({});
  const [electrolit, setElectrolit] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await fetchPedidosEnCurso();
    setRow((data ?? []).find((r) => String(r.pedido_id) === String(pedidoId) && Number(r.erp_sucursal_id) === suc) ?? null);
  }, [pedidoId, suc]);
  useEffect(() => { cargar(); }, [cargar]);

  const ciclo = row ? cicloDeReenvioPendiente(row.reenvios_historial, row.falta_cajas ?? []) : null;
  const estadoDe = (n) => cajas[n] ?? 'ok';
  const listaCajas = ciclo?.cajas ?? [];
  const listaEsp = ciclo?.especiales ?? [];
  const falta = electrolit === null && (ciclo?.electrolits ?? 0) > 0;

  const confirmar = async () => {
    setGuardando(true);
    try {
      const cajasOk = listaCajas.filter((n) => estadoDe(n) === 'ok');
      const cajasDanadas = listaCajas.filter((n) => estadoDe(n) === 'danada');
      const cajasFaltantes = listaCajas.filter((n) => estadoDe(n) === 'faltante');
      const especialesAun = listaEsp.filter((l) => especiales[l] === 'faltante');
      const r = await confirmarLlegadaDeReenvio({
        pedidoId, sucId: suc, ciclo: ciclo.ciclo, historial: ciclo.historial, electrolitCount: ciclo.electrolits, especialesList: listaEsp,
        userId: user?.id ?? null, cajasOk, cajasDanadas, cajasFaltantes, nota: nota.trim(),
        electrolitOk: ciclo.electrolits > 0 ? electrolit === 'ok' : true, especialesAun,
      });
      // `yaEstaba`: un segundo toque sobre una llegada ya confirmada — no se anota dos veces.
      if (!r.yaEstaba) useStaffStore.getState().appendAuditLog?.('PEDIDO_REENVIO_LLEGADA', pedidoId, { ciclo: ciclo.ciclo, arrived_tipo: r.arrivedTipo, cajasOk, cajasDanadas, cajasFaltantes, desde: 'app' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Lo que llegó se cuenta: si quedaron renglones pendientes sin falta, al conteo.
      const renglones = await fetchPedidoItemsAll(pedidoId, suc).catch(() => []);
      const porContar = (renglones ?? []).some((x) => x.status === 'pendiente' && x.cantidad_asignada > 0 && !x.falta_caja);
      listo('Llegada del reenvío confirmada', cajasFaltantes.length || especialesAun.length ? 'Lo que sigue faltando se le avisa a Bodega.' : '');
      if (porContar) router.replace({ pathname: '/pedido/recibir', params: { pedidoId: String(pedidoId), sucId: String(suc), numero: String(numero ?? '') } });
      else volver('/pedidos');
    } catch (e) {
      fallo('No se pudo confirmar la llegada del reenvío', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Llegó el reenvío', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{`Pedido #${numero} · ${ERP_NAMES[suc] ?? ''}${ciclo ? ` · reenvío ${ciclo.ciclo}` : ''}`}</Text>
        {row === undefined ? <ActivityIndicator /> : !ciclo ? (
          <Aviso tono="cuidado" texto={reenvioTodaviaEnBodega(row?.reenvios_historial)
            ? 'El reenvío todavía no sale: las cajas siguen en Bodega y se confirman cuando salga su ruta.'
            : 'No hay un reenvío pendiente de confirmar en esta sala.'} />
        ) : (
          <>
            {listaCajas.length ? (
              <Seccion titulo="Cajas del reenvío">
                {listaCajas.map((n, i) => (
                  <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{`Caja ${n}`}</Text>
                    <Elegir valor={estadoDe(n)} onCambiar={(v) => setCajas((x) => ({ ...x, [n]: v }))} />
                  </View>
                ))}
              </Seccion>
            ) : null}
            {ciclo.electrolits > 0 ? (
              <Seccion titulo={`Electrolit · ${ciclo.electrolits}`}>
                <Elegir valor={electrolit} onCambiar={setElectrolit} opciones={[['ok', 'Llegó todo', MARCA.verde], ['faltan', 'Aún faltan', MARCA.rojo]]} />
              </Seccion>
            ) : null}
            {listaEsp.length ? (
              <Seccion titulo="Cajas especiales">
                {listaEsp.map((l, i) => (
                  <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{l}</Text>
                    <Elegir valor={especiales[l] ?? 'ok'} onCambiar={(v) => setEspeciales((x) => ({ ...x, [l]: v }))}
                      opciones={[['ok', 'Llegó', MARCA.verde], ['faltante', 'No llegó', MARCA.rojo]]} />
                  </View>
                ))}
              </Seccion>
            ) : null}
            <Seccion titulo="Nota (opcional)">
              <Campo value={nota} onChangeText={setNota} placeholder="Algo que Bodega deba saber" maxLength={300} />
            </Seccion>
            {falta ? <Aviso tono="cuidado" texto="Indica si llegó el Electrolit." /> : null}
            <BotonGrande texto={guardando ? 'Confirmando…' : 'Confirmar llegada'} color={MARCA.azul} onPress={confirmar} deshabilitado={guardando || falta} />
          </>
        )}
      </ScrollView>
    </>
  );
}
