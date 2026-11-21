// Usar un saldo a favor en caja, NATIVO (2026-10-21) — gemela de
// `src/components/caja/UsarSaldoAFavor.jsx`. Funciona como un crédito:
//   1. Se confirma al titular: su tarjeta de Puntos Salud (o el QR de la app),
//      el DUI o el teléfono de la ficha. Lo decide la base
//      (`saldo_favor_buscar` con la prueba).
//   2. Se elige cuánto usar, con lo que queda como tope.
//   3. Desde el 2026-11-21 es un PAGO: se aparta, la compra se factura
//      completa y el saldo se aplica como el anticipo de un retiro
//      (`reserva-retirar` con `tipo=saldo`).
// Desde Preventa (2026-11-21) llega con `tope` (lo que la venta deja
// descontar) y `preventa=1`: lo usado vuelve a la venta (`saldoUsado`).
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { apartarSaldoAFavor, buscarSaldoAFavor } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { Aviso, BotonGrande, Campo, Dato, Seccion, exigeParametro } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { dejarSaldoUsado } from '../componentes/reservas/saldoUsado';

function UsarSaldo() {
  const { id, codigo, tope: topeTexto, preventa, sala } = useLocalSearchParams();
  const enPreventa = preventa === '1';
  const tope = topeTexto == null ? null : Number(topeTexto);
  const [prueba, setPrueba] = useState('');
  const [fila, setFila] = useState(null);
  const [monto, setMonto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const tieneAFavor = Number(fila?.saldo_favor ?? 0);
  const disponible = tope == null ? tieneAFavor : Math.max(0, Math.min(tieneAFavor, tope || 0));
  const pedido = Math.round(Number(String(monto).replace(',', '.')) * 100) / 100;
  const montoValido = pedido > 0 && pedido <= disponible + 0.0001;

  const confirmar = async () => {
    setOcupado(true); setError('');
    try {
      const f = ((await buscarSaldoAFavor(codigo, prueba)) || []).find((x) => String(x.id) === String(id));
      if (!f) setError('Ese saldo ya no está disponible.');
      else if (!f.confirmado) setError('No coincide con el cliente de este saldo. Escanea su tarjeta de Puntos Salud o escribe su DUI o su teléfono registrado.');
      else { setFila(f); setMonto(Math.max(0, tope == null ? Number(f.saldo_favor) : Math.min(Number(f.saldo_favor), tope || 0)).toFixed(2)); }
    } catch (e) { setError(mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupado(false); }
  };

  const usar = async () => {
    setOcupado(true); setError('');
    try {
      const r = await apartarSaldoAFavor(id, pedido, prueba);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const queda = Number(r?.queda) > 0 ? ` Le quedan ${formatMoney(Number(r.queda))}.` : '';
      if (enPreventa) {
        dejarSaldoUsado({ uso_id: r.uso_id, reserva_id: Number(id), monto: Number(r.monto), codigo: r.codigo, efectivo: Boolean(r.efectivo) });
        listo('Saldo apartado', `${formatMoney(Number(r?.monto ?? pedido))} pagan parte de esta venta.${queda}`);
        router.back();
      } else {
        listo('Saldo apartado', `Factura el total a su nombre y aplica los ${formatMoney(Number(r?.monto ?? pedido))}.${queda}`);
        if (sala) router.replace({ pathname: '/reserva-retirar', params: { id: String(r.uso_id), tipo: 'saldo', sala: String(sala) } });
        else router.back();
      }
    } catch (e) { fallo('No se pudo usar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupado(false); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Saldo ${codigo ?? ''}` }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        {!fila ? (
          <>
            <Seccion titulo="Confirma al cliente" pie="Su tarjeta de Puntos Salud (o el QR de su app), o su DUI o su teléfono registrado.">
              <Campo multiline={false} value={prueba} onChangeText={setPrueba} placeholder="Tarjeta, DUI o teléfono" autoCapitalize="characters" autoFocus />
            </Seccion>
            <BotonGrande texto={ocupado ? 'Confirmando…' : 'Confirmar cliente'} color={MARCA.azulClaro} deshabilitado={ocupado || !prueba.trim()} onPress={confirmar} />
          </>
        ) : (
          <>
            <Seccion titulo={fila.cliente ?? 'Cliente'} pie={enPreventa ? 'Lo que uses paga parte de esta venta. La factura sale por el total.' : 'Lo que uses paga parte de su compra. Factura el total a su nombre y después aplica el saldo.'}>
              <Dato rotulo="Tiene a favor" valor={formatMoney(tieneAFavor)} primero fuerte />
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

export default exigeParametro(UsarSaldo, 'id', { titulo: 'Reserva', texto: 'No se encontró la reserva.' });
