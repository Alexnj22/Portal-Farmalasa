// Devolución en efectivo de un saldo a favor, NATIVO (2026-10-22) — gemela de
// los diálogos de `WidgetReservas`. Por defecto lo pagado queda a favor; el
// efectivo es la excepción:
//   · `pedir`: la sala lo pide con un motivo y administración recibe el aviso;
//   · `autorizar` / `negar`: administración (`dash_reservas_devolver_saldo`);
//   · `entregar`: ya autorizada, sale de la caja de la sala como vale
//     «Devolución a un cliente» y queda amarrado a la reserva.
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { devolverSaldoAFavor, marcarDevolucionEntregada, negarDevolucionEnEfectivo, pedirDevolucionEnEfectivo } from '@nucleo/data/reservas';
import { anotarSalida } from '@nucleo/data/bolsas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const MODOS = {
  pedir: {
    titulo: 'Pedir en efectivo', rotulo: 'Por qué lo quiere en efectivo', boton: 'Pedir a administración', color: MARCA.azulClaro,
    pie: 'Administración lo autoriza. Cuando lo autorice, aparece en Reservas para entregarlo con un vale de caja.',
  },
  autorizar: {
    titulo: 'Autorizar devolución', rotulo: 'Motivo de la devolución', boton: 'Autorizar', color: MARCA.verde,
    pie: 'La sala lo entrega con un vale de su caja. El saldo deja de poder usarse en caja.',
  },
  negar: {
    titulo: 'No autorizar', rotulo: 'Motivo (se le dice a la sala)', boton: 'No autorizar', color: MARCA.rojo,
    pie: 'El saldo sigue a favor del cliente para usarlo en caja.',
  },
  entregar: {
    titulo: 'Entregar en efectivo', rotulo: null, boton: 'Sacar de caja y entregar', color: MARCA.rojo,
    pie: 'Sale de la caja de esta sala como vale «Devolución a un cliente»: el corte ya lo descuenta. Entrega el dinero al confirmar.',
  },
};

export default function DevolucionDeSaldo() {
  const { id, modo = 'pedir', codigo, monto: montoParam, cliente, sala, motivo: motivoPedido } = useLocalSearchParams();
  const m = MODOS[modo] ?? MODOS.pedir;
  const monto = Number(montoParam ?? 0);
  const [motivo, setMotivo] = useState(modo === 'autorizar' ? String(motivoPedido ?? '') : '');
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef(null);

  const hacer = async () => {
    setOcupado(true);
    try {
      if (modo === 'pedir') {
        await pedirDevolucionEnEfectivo(id, motivo.trim());
        listo('Devolución pedida', 'Administración recibe el aviso para autorizarla.');
      } else if (modo === 'autorizar') {
        await devolverSaldoAFavor(id, motivo.trim());
        listo('Devolución autorizada', 'La sala la entrega con un vale de su caja.');
      } else if (modo === 'negar') {
        await negarDevolucionEnEfectivo(id, motivo.trim());
        listo('Devolución no autorizada', 'La sala recibe el aviso.');
      } else {
        trabajando('Sacando de caja…');
        if (!clave.current) clave.current = globalThis.crypto?.randomUUID?.() ?? `dev-${id}-${monto}`;
        const s = await anotarSalida({ sala, monto, tipo: 'DEVOLUCION', concepto: `Devolucion saldo ${codigo}`, recibe: String(cliente ?? ''),
          detalle: `Devolución en efectivo del saldo a favor de ${codigo}`, clave: clave.current });
        if (s?.error || !s?.ok) throw s?.error || new Error('La caja no aceptó la salida.');
        try {
          await marcarDevolucionEntregada(id, s.movimiento_del_portal);
        } catch (e) {
          fallo('El vale salió, pero no quedó amarrado', `${mensajeAmigable(e, '')} Avísale a administración: ${codigo}.`);
          router.back();
          return;
        }
        listo('Devolución entregada', `${formatMoney(monto)} · vale de caja de ${codigo}`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      fallo('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupado(false); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: m.titulo }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion titulo={String(codigo ?? '')} pie={m.pie}>
            <Dato rotulo="Monto" valor={formatMoney(monto)} primero fuerte />
            {cliente ? <Dato rotulo="Cliente" valor={String(cliente)} /> : null}
            {motivoPedido && modo !== 'pedir' ? <Dato rotulo="La sala pidió" valor={String(motivoPedido)} /> : null}
          </Seccion>
          {m.rotulo ? (
            <Seccion titulo={m.rotulo}>
              <Campo value={motivo} onChangeText={setMotivo} maxLength={300} autoFocus />
            </Seccion>
          ) : <Aviso tono="cuidado" texto="El dinero sale del cajón al confirmar." />}
          <BotonGrande texto={ocupado ? 'Un momento…' : m.boton} color={m.color}
            deshabilitado={ocupado || (m.rotulo && motivo.trim().length < 3)} onPress={hacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
