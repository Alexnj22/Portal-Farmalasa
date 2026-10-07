// Pausar la preparación de una sala, NATIVO — el `PauseModal` del portal: el
// motivo (el almuerzo, una sola vez por pedido), un comentario (obligatorio en
// «Otro…») y el historial de pausas de esta sala. Guarda con el mismo texto
// que el portal (`textoDePausa`, núcleo).
import { volver } from '../../componentes/volver';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPausaHistorial } from '@nucleo/data/pedidos';
import { etapaDePedido, razonesDePausaDisponibles, textoDePausa } from '@nucleo/data/accionesDePedido';
import { PAUSE_REASONS } from '@nucleo/constants/pedidos';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

export default function PausarPedido() {
  const { pedidoId, sucId, numero } = useLocalSearchParams();
  const { user } = useAuth();
  const [historial, setHistorial] = useState(null);
  const [razon, setRazon] = useState('insumos');
  const [comentario, setComentario] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    fetchPausaHistorial(pedidoId, Number(sucId)).then(({ data }) => setHistorial(data ?? [])).catch(() => setHistorial([]));
  }, [pedidoId, sucId]);

  const disponibles = useMemo(() => razonesDePausaDisponibles(historial ?? []), [historial]);
  const pideComentario = !!PAUSE_REASONS.find((r) => r.key === razon)?.requiresComment;
  const valido = disponibles.some((r) => r.key === razon) && (!pideComentario || comentario.trim().length > 0);

  const pausar = async () => {
    setGuardando(true);
    try {
      const texto = textoDePausa(razon, comentario);
      await etapaDePedido({ pedidoId, sucId: Number(sucId), stage: 'pausar', userId: user?.id ?? null, razon: texto });
      useStaffStore.getState().appendAuditLog?.('PEDIDO_LIFECYCLE_PAUSAR', pedidoId, { sucursal_id: Number(sucId), razon: texto, desde: 'app' });
      listo('Preparación en pausa', texto);
      volver('/pedidos');
    } catch (e) {
      fallo('No se pudo pausar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pausar', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{`Pedido #${numero} · ${ERP_NAMES[Number(sucId)] ?? ''}`}</Text>
        <Seccion titulo="Por qué se pausa">
          <Opciones opciones={disponibles.map((r) => ({ id: r.key, label: r.label }))} valor={razon} onCambiar={setRazon} />
        </Seccion>
        <Seccion titulo={pideComentario ? 'Comentario (obligatorio)' : 'Comentario (opcional)'}>
          <Campo value={comentario} onChangeText={setComentario} placeholder="Qué pasó" maxLength={200} />
        </Seccion>
        {historial?.length ? (
          <Seccion titulo="Pausas de esta sala">
            {historial.map((h, i) => (
              <Dato key={i} primero={i === 0} rotulo={`Pausa ${i + 1}`} valor={h.razon ?? '—'} />
            ))}
          </Seccion>
        ) : null}
        {historial && !disponibles.some((r) => r.key === 'almuerzo') ? <Aviso texto="El almuerzo ya se usó en este pedido." /> : null}
        <View>
          <BotonGrande texto={guardando ? 'Pausando…' : 'Pausar'} color={MARCA.ambar} onPress={pausar} deshabilitado={!valido || guardando} />
        </View>
      </ScrollView>
    </>
  );
}
