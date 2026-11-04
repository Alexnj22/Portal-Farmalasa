// Registrar un aviso al cliente (llamada o en persona), NATIVO — gemela de `RegistrarLlamada`
// (`src/views/dashboard/AvisosDeReserva.jsx`). Reglamento de reservas v2,
// cláusula 9: el aviso por llamada queda anotado con quién llamó, cuándo, si el
// cliente contestó y qué respondió. Sirve para reservas (`reserva`) y encargos
// (`encargo`); la base exige la respuesta cuando contestó y siempre en persona
// (2026-11-04: el cliente que sigue en la sala se entera ahí mismo).
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { registrarAvisoDeReserva } from '@nucleo/data/reservas';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

export default function RegistrarLlamada() {
  const { reserva, encargo, codigo, cliente, telefono } = useLocalSearchParams();
  const [medio, setMedio] = useState('llamada');
  const [contesto, setContesto] = useState('si');
  const [respuesta, setRespuesta] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enPersona = medio === 'en_persona';
  const exigeRespuesta = enPersona || contesto === 'si';
  const falta = exigeRespuesta && respuesta.trim().length < 3;

  const guardar = async () => {
    setOcupado(true);
    try {
      await registrarAvisoDeReserva({
        reserva: reserva ? Number(reserva) : null, encargo: encargo ? Number(encargo) : null,
        ...(enPersona ? { canal: 'en_persona' } : { canal: 'llamada', contesto: contesto === 'si' }),
        respuesta: respuesta.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(enPersona ? 'Aviso anotado' : 'Llamada anotada', exigeRespuesta ? 'Quedó lo que respondió el cliente.' : 'Quedó anotado que no contestó.');
      router.back();
    } catch (e) {
      fallo('No se pudo anotar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupado(false); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Registrar aviso' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion titulo={String(codigo ?? '')}>
            {cliente ? <Dato rotulo="Cliente" valor={String(cliente)} primero /> : null}
            {telefono ? <Dato rotulo="Teléfono" valor={String(telefono)} primero={!cliente} /> : null}
          </Seccion>
          <Seccion titulo="Cómo se le avisó">
            <Opciones opciones={[{ id: 'llamada', label: 'Llamada' }, { id: 'en_persona', label: 'En persona' }]} valor={medio} onCambiar={setMedio} />
          </Seccion>
          {telefono && !enPersona ? <BotonGrande texto="Llamar" borde color={MARCA.azulClaro}
            onPress={() => Linking.openURL(`tel:${String(telefono).replace(/\D/g, '')}`).catch(() => {})} /> : null}
          {!enPersona ? (
            <Seccion titulo="¿Contestó?">
              <Opciones opciones={[{ id: 'si', label: 'Contestó' }, { id: 'no', label: 'No contestó' }]} valor={contesto} onCambiar={setContesto} />
            </Seccion>
          ) : null}
          <Seccion titulo={exigeRespuesta ? 'Qué respondió' : 'Nota (opcional)'}>
            <Campo value={respuesta} onChangeText={setRespuesta} maxLength={300}
              placeholder={enPersona ? 'Ej. Estaba en la sala; paga el viernes' : contesto === 'si' ? 'Ej. Pasa a retirarla el sábado' : 'Ej. Sonó y no contestó'} />
          </Seccion>
          <BotonGrande texto={ocupado ? 'Un momento…' : 'Anotar aviso'} color={MARCA.verde} deshabilitado={ocupado || falta} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
