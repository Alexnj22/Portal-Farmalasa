// «Así la ve el cliente», NATIVO — la vista previa de `EncuestaDetalle`: el
// mismo cuestionario que se aplica en sala (`componentes/encuestas/Formulario`,
// con su recorrido y sus condiciones), para probarlo sin guardar nada. Al
// terminar no se envía: se avisa que era una prueba.
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { fetchEncuesta } from '@nucleo/data/encuestasClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { Aviso } from '../../componentes/formulario/Piezas';
import Formulario from '../../componentes/encuestas/Formulario';

export default function VistaPrevia() {
  const { id } = useLocalSearchParams();
  const [encuesta, setEncuesta] = useState(null);
  const [error, setError] = useState(null);
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    fetchEncuesta(id).then(setEncuesta).catch((e) => setError(mensajeAmigable(e, 'No se pudo cargar la encuesta.')));
  }, [id]);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Vista previa' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <Aviso texto="Así la ve el cliente. Es una prueba: al terminar no se guarda nada." />
        {error ? <Aviso tono="freno" texto={error} /> : !encuesta ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <View>
            <Formulario key={vuelta} encuesta={encuesta} onEntregarMuestra={async () => {}}
              onEnviar={async () => { setTimeout(() => setVuelta((v) => v + 1), 2500); return null; }} />
          </View>
        )}
      </ScrollView>
    </>
  );
}
