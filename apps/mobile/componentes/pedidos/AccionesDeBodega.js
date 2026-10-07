// Lo que Bodega hace sobre la sala de un pedido, NATIVO — los botones de la
// tarjeta del portal (`TabPedidos`) con las MISMAS reglas: iniciar
// (`puedePrepararse`), pausar con motivo, reanudar, programar la entrega
// cuando ya está listo, y anular el pedido entero (`anulacionDelPedido`:
// nunca si alguna sala ya salió; con motivo si alguna se está preparando).
//
// Las escrituras son las del núcleo (`accionesDePedido`), las mismas del
// portal. FINALIZAR (contar las cajas y repartir las hojas) y el papel siguen
// en la computadora de Bodega: arman el PDF con la impresora a la vista.
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anularPedidoConMotivo, etapaDePedido } from '@nucleo/data/accionesDePedido';
import { anulacionDelPedido, puedePrepararse } from '@nucleo/utils/tableroDePedidos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BotonGrande, Aviso } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

export default function AccionesDeBodega({ row, etapa, etapas, onCambio }) {
  const { user } = useAuth();
  const [ocupado, setOcupado] = useState(false);
  const anular = anulacionDelPedido(row, etapas);
  const params = { pedidoId: String(row.pedido_id), sucId: String(row.erp_sucursal_id), numero: String(row.numero ?? '') };

  const avanzar = async (stage, titulo) => {
    setOcupado(true);
    try {
      await etapaDePedido({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, stage, userId: user?.id ?? null });
      useStaffStore.getState().appendAuditLog?.(`PEDIDO_LIFECYCLE_${stage.toUpperCase()}`, row.pedido_id, { sucursal_id: row.erp_sucursal_id, desde: 'app' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, '');
      onCambio?.();
    } catch (e) {
      fallo('No se pudo', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };

  const hacerAnular = async (motivo) => {
    setOcupado(true);
    try {
      await anularPedidoConMotivo({ pedidoId: row.pedido_id, userId: user?.id ?? null, motivo });
      useStaffStore.getState().appendAuditLog?.('PEDIDO_ANULADO', row.pedido_id, { numero: row.numero, motivo, desde: 'app' });
      listo(`Pedido #${row.numero} anulado`, motivo ? `Motivo: ${motivo}` : '');
      onCambio?.();
    } catch (e) {
      fallo('No se pudo anular', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };
  const pedirAnular = () => {
    const texto = `Se anula el pedido #${row.numero} completo, en todas sus salas. No se deshace.`;
    if (anular.pideMotivo && Platform.OS === 'ios') {
      Alert.prompt('Anular pedido', `${texto}\n\nUna sala ya lo está preparando: escribe el motivo.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Anular', style: 'destructive', onPress: (m) => { if (String(m ?? '').trim()) hacerAnular(String(m).trim()); else fallo('Falta el motivo', 'Escríbelo para poder anular.'); } },
      ], 'plain-text');
      return;
    }
    Alert.alert('Anular pedido', texto, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Anular', style: 'destructive', onPress: () => hacerAnular(null) },
    ]);
  };

  const botones = [];
  if (puedePrepararse(row)) botones.push(<BotonGrande key="ini" texto="Iniciar preparación" color={MARCA.azul} deshabilitado={ocupado} onPress={() => avanzar('iniciar', 'Preparación iniciada')} />);
  if (etapa === 'preparando') botones.push(<BotonGrande key="pau" texto="Pausar" color={MARCA.ambar} borde deshabilitado={ocupado} onPress={() => router.push({ pathname: '/pedido/pausa', params })} />);
  if (etapa === 'pausado') botones.push(<BotonGrande key="rea" texto="Reanudar" color={MARCA.verde} deshabilitado={ocupado} onPress={() => avanzar('reanudar', 'Preparación reanudada')} />);
  if (etapa === 'preparado') {
    botones.push(<BotonGrande key="pro" texto={row.entrega_programada_at ? `Entrega: ${fechaTexto(row.entrega_programada_at, { weekday: 'short', day: 'numeric', month: 'short' })} ${hora12(row.entrega_programada_at)}` : 'Programar entrega'}
      color={MARCA.violetaClaro} borde deshabilitado={ocupado} onPress={() => router.push({ pathname: '/pedido/programar', params })} />);
  }
  if (anular.puede) botones.push(<BotonGrande key="anu" texto="Anular pedido" color={MARCA.rojo} borde deshabilitado={ocupado} onPress={pedirAnular} />);
  if (!botones.length && etapa !== 'preparando') return null;

  return (
    <View style={{ gap: 8 }}>
      {botones}
      {etapa === 'preparando' ? <Aviso texto="Finalizar (contar las cajas) y el papel se hacen en la computadora de Bodega." /> : null}
    </View>
  );
}
