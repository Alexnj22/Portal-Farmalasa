// Reservas terminadas, NATIVO — la pestaña «Terminadas» de `ReservasView` del
// portal (2026-11-21, «¿cómo puedo ver reservas finalizadas?»). Lo retirado y
// cancelado de los últimos 30 días (`reservas_de_sucursal` con
// `p_abiertas = false`), la más reciente primero, con la factura con la que
// cerró. Sólo para mirar; se busca por el código R-… o P-…. Qué cuenta como
// terminada y cómo se dice lo decide el núcleo (`reservasTerminadas`,
// `estadoDeTerminada`), lo mismo que el portal.
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Refrescar from '../componentes/Refrescar';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { codigoDeReserva, fetchReservasDeSucursal } from '@nucleo/data/reservas';
import { cuentasDeReserva, estadoDeTerminada, reservasTerminadas } from '@nucleo/utils/reservasDeSala';
import { fechaHora12 } from '@nucleo/utils/hora';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Seccion, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';

const COLOR_ESTADO = { success: () => MARCA.verde, warning: () => MARCA.ambar, neutral: () => colorSistema.texto2 };

export default function ReservasTerminadas() {
  const { sala: salaParam, todas: todasParam } = useLocalSearchParams();
  const { user } = useAuth();
  const branches = useStaffStore((s) => s.branches);
  const verTodas = todasParam === '1';
  const sala = verTodas ? null : (salaParam ? Number(salaParam) : (user?.branchId ?? user?.branch_id ?? null));
  const nombreSala = (branches || []).find((b) => String(b.id) === String(sala))?.name || '';
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [codigo, setCodigo] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sala && !verTodas) { setFilas([]); return; }
    try {
      setFilas(await fetchReservasDeSucursal(sala, false)); setError('');
    } catch (e) { setError(mensajeAmigable(e, 'Intenta de nuevo.')); setFilas((f) => f ?? []); }
  }, [sala, verTodas]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const visibles = reservasTerminadas(filas, codigo);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Terminadas',
        headerSearchBarOptions: { placeholder: 'Código R-… o P-…', autoCapitalize: 'characters', hideWhenScrolling: false, onChangeText: (e) => setCodigo(e.nativeEvent.text), onCancelButtonPress: () => setCodigo('') } }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }} keyboardDismissMode="on-drag"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>
          {`${verTodas ? 'Todas' : nombreSala} · retiradas y canceladas de los últimos 30 días`}
        </Text>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso texto={`No se pudieron leer las reservas. ${error}`} /></View> : null}
        {filas && !visibles.length ? (
          <Vacio titulo={codigo ? 'Ninguna con ese código' : 'Sin reservas terminadas'} detalle="Aquí salen las retiradas y canceladas de los últimos 30 días." />
        ) : null}
        {visibles.length ? (
          <Seccion titulo={`Terminadas · ${visibles.length}`}>
            {visibles.map((r, i) => {
              const est = estadoDeTerminada(r);
              const { total, pagado, pagadoTodo } = cuentasDeReserva(r);
              return (
                <View key={r.id} style={{ gap: 3, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{r.pedido ?? codigoDeReserva(r.id)}</Text>
                    <Pildora texto={est.label} color={COLOR_ESTADO[est.variant]()} />
                    <View style={{ flex: 1 }} />
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(total)}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{r.cliente ?? 'Sin cliente'}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{`${r.cantidad} × ${r.producto}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={2}>
                    {[
                      r.cerrada_at ? `Terminó ${fechaHora12(r.cerrada_at)}` : '',
                      pagadoTodo ? 'Pagada' : pagado > 0.004 ? `Anticipo ${formatMoney(pagado)}` : '',
                      r.factura ? `Factura ${r.factura}` : '',
                      verTodas && r.sala ? r.sala : '',
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              );
            })}
          </Seccion>
        ) : null}
      </ScrollView>
    </>
  );
}
