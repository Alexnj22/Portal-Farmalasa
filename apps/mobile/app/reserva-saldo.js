// Usar un saldo a favor en caja, NATIVO (2026-10-21) — gemela del diálogo
// `UsarSaldo` de `WidgetReservas`. Funciona como un crédito:
//   1. Se confirma al titular: su tarjeta de Puntos Salud (o el QR de la app),
//      el DUI o el teléfono de la ficha. Lo decide la base
//      (`saldo_favor_buscar` con la prueba).
//   2. Se elige cuánto usar, con lo que queda como tope.
//   3. Ese monto pasa a puntos del cliente y la caja lo descuenta como
//      cualquier canje, en una factura a su nombre.
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { buscarSaldoAFavor, usarSaldoAFavor } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

export default function UsarSaldo() {
  const { id, codigo } = useLocalSearchParams();
  const [prueba, setPrueba] = useState('');
  const [fila, setFila] = useState(null);
  const [monto, setMonto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const disponible = Number(fila?.saldo_favor ?? 0);
  const pedido = Math.round(Number(String(monto).replace(',', '.')) * 100) / 100;
  const montoValido = pedido > 0 && pedido <= disponible + 0.0001;

  const confirmar = async () => {
    setOcupado(true); setError('');
    try {
      const f = ((await buscarSaldoAFavor(codigo, prueba)) || []).find((x) => String(x.id) === String(id));
      if (!f) setError('Ese saldo ya no está disponible.');
      else if (!f.confirmado) setError('No coincide con el cliente de este saldo. Escanea su tarjeta de Puntos Salud o escribe el DUI o el teléfono de su ficha.');
      else { setFila(f); setMonto(Number(f.saldo_favor).toFixed(2)); }
    } catch (e) { setError(mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupado(false); }
  };

  const usar = async () => {
    setOcupado(true); setError('');
    try {
      const r = await usarSaldoAFavor(id, pedido, prueba);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Saldo listo para descontar', `Descuenta ${formatMoney(Number(r?.monto ?? pedido))} con puntos.${Number(r?.queda) > 0 ? ` Le quedan ${formatMoney(Number(r.queda))}.` : ''}`);
      router.back();
    } catch (e) { fallo('No se pudo usar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupado(false); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Saldo ${codigo ?? ''}` }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        {!fila ? (
          <>
            <Seccion titulo="Confirma al cliente" pie="Su tarjeta de Puntos Salud (o el QR de su app), o el DUI o el teléfono de su ficha.">
              <Campo multiline={false} value={prueba} onChangeText={setPrueba} placeholder="Tarjeta, DUI o teléfono" autoCapitalize="characters" autoFocus />
            </Seccion>
            <BotonGrande texto={ocupado ? 'Confirmando…' : 'Confirmar cliente'} color={MARCA.azulClaro} deshabilitado={ocupado || !prueba.trim()} onPress={confirmar} />
          </>
        ) : (
          <>
            <Seccion titulo={fila.cliente ?? 'Cliente'} pie="Lo que uses pasa a sus puntos: en caja, factura a su nombre y descuéntalo con puntos.">
              <Dato rotulo="Tiene a favor" valor={formatMoney(disponible)} primero fuerte />
              <Dato rotulo="Vale hasta" valor={fechaTexto(fila.saldo_favor_vence, { day: 'numeric', month: 'short' })} />
            </Seccion>
            <Seccion titulo="Cuánto usa" pie={`Hasta ${formatMoney(disponible)}.`}>
              <Campo multiline={false} value={monto} onChangeText={setMonto} keyboardType="decimal-pad" placeholder="0.00" />
            </Seccion>
            <BotonGrande texto={ocupado ? 'Aplicando…' : `Usar ${montoValido ? formatMoney(pedido) : ''}`} color={MARCA.verde} deshabilitado={ocupado || !montoValido} onPress={usar} />
          </>
        )}
        {error ? <Aviso tono="cuidado" texto={error} /> : null}
      </ScrollView>
    </>
  );
}
