// Registrar el pago de un servicio de la sala (arrendamiento, luz, agua,
// internet, teléfono, impuestos), NATIVO — `FormRegisterPayment` del portal.
// `?id=` la sala, `?servicio=` la clave y `?pendiente=1` para subir el
// comprobante de un mes ya registrado sin él.
//
// Qué mes toca, si ya estaba pagado y el registro que se guarda salen del
// núcleo (`pagoDeSucursal`), el mismo del portal; guardarlo es
// `registerBranchExpense` del store (sube y versiona el comprobante, marca el
// mes pagado en la ficha y deja la bitácora), igual que en la oficina.
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  SERVICIOS_DE_PAGO, datosDelServicio, mesInicialDelPago, problemaDelPago, registroDelPago, yaEstabaPagado,
} from '@nucleo/utils/pagoDeSucursal';
import { correrMes } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { nombreDelMes } from '../../componentes/PasoDeMes';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';
import { elegirOrigen, leerComoArchivo } from '../../componentes/sucursal/elegirArchivo';

function Flecha({ texto, onPress }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} hitSlop={10} accessibilityRole="button"
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.9 : 1 }] })}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 24, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function PagoDeSucursal() {
  const { id, servicio = 'light', pendiente } = useLocalSearchParams();
  const sucursal = useStaffStore((s) => s.branches?.find((b) => String(b.id) === String(id)));
  const registerBranchExpense = useStaffStore((s) => s.registerBranchExpense);
  const subiendoComprobante = pendiente === '1';
  const datos = datosDelServicio(sucursal?.settings, servicio);

  const [monto, setMonto] = useState(datos.amount != null ? String(datos.amount) : '');
  const [mes, setMes] = useState(() => mesInicialDelPago(sucursal?.settings, servicio, subiendoComprobante));
  const [notas, setNotas] = useState('');
  const [origen, setOrigen] = useState(null);
  const [guardando, setGuardando] = useState(false);

  if (!sucursal) return <Aviso texto="No se encontró la sucursal." />;
  const nombre = SERVICIOS_DE_PAGO[servicio] || 'Servicio';
  const conflicto = !subiendoComprobante && yaEstabaPagado(datos.paidThrough, mes);

  const guardar = async () => {
    setGuardando(true);
    trabajando(origen ? 'Subiendo el comprobante…' : 'Registrando el pago…');
    try {
      const receiptFile = origen ? await leerComoArchivo(origen, `${servicio}_${mes}`) : null;
      if (origen && !receiptFile) { setGuardando(false); return; }
      await registerBranchExpense(sucursal.id, registroDelPago(sucursal.settings, servicio, { amount: monto, billing_month: mes, notes: notas.trim(), receiptFile }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Pago registrado', `${nombre} de ${nombreDelMes(mes)}${receiptFile ? '' : ' · comprobante pendiente'}.`);
      volver(`/sucursal/${sucursal.id}`);
    } catch (e) {
      fallo('No se pudo registrar el pago', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };

  const confirmar = () => {
    const problema = problemaDelPago({ amount: monto, billing_month: mes });
    if (problema) { Alert.alert('Falta un dato', problema); return; }
    Alert.alert('Registrar el pago', `${nombre} de ${nombreDelMes(mes)} en ${sucursal.name}: ${formatMoney(Number(monto) || 0)}${origen ? ', con comprobante' : ', sin comprobante (queda pendiente)'}.${conflicto ? '\n\nEse mes ya figuraba pagado: se actualiza.' : ''}`, [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Registrar', onPress: guardar },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: subiendoComprobante ? 'Subir comprobante' : `Pago de ${nombre}` }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 60, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Seccion titulo={sucursal.name}>
            <Dato rotulo="Servicio" valor={nombre} primero />
            <Dato rotulo="Último mes pagado" valor={datos.paidThrough ? nombreDelMes(datos.paidThrough) : 'Sin pagos previos'} />
            {datos.provider ? <Dato rotulo="Proveedor" valor={datos.provider} /> : null}
          </Seccion>

          <Seccion titulo="Mes que cubre">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Flecha texto="‹" onPress={() => setMes((m) => correrMes(m, -1))} />
              <Text style={{ flex: 1, textAlign: 'center', color: conflicto ? MARCA.rojo : colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{nombreDelMes(mes)}</Text>
              <Flecha texto="›" onPress={() => setMes((m) => correrMes(m, 1))} />
            </View>
            {conflicto ? <Aviso tono="cuidado" texto="Ese mes ya figura pagado. Si lo registras, se actualiza el pago de ese mes." /> : null}
          </Seccion>

          <Seccion titulo="Monto pagado exacto">
            <Campo multiline={false} keyboardType="decimal-pad" value={monto} onChangeText={(v) => setMonto(v.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
            <Campo value={notas} onChangeText={setNotas} placeholder="Notas (opcional)" />
          </Seccion>

          <Seccion titulo="Comprobante" pie="Sin comprobante el pago queda registrado y el mes marcado con «comprobante pendiente», para subirlo después.">
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{origen ? `Elegido: ${origen.nombre}` : 'Sin comprobante.'}</Text>
            <BotonGrande texto={origen ? 'Elegir otro' : 'Adjuntar comprobante'} borde onPress={async () => { const f = await elegirOrigen(); if (f) setOrigen(f); }} />
          </Seccion>

          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto={guardando ? 'Guardando…' : subiendoComprobante ? 'Guardar comprobante' : 'Registrar pago'} color={MARCA.verde} onPress={confirmar} deshabilitado={guardando || (subiendoComprobante && !origen)} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
