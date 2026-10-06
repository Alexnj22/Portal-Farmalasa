// El reglamento del programa y el aviso de privacidad, DENTRO de la app
// (2026-10-06: el usuario no quería que abrieran el navegador). Es la misma
// página publicada en el portal —una sola fuente de verdad, la que se archiva
// como prueba del consentimiento—, en una vista web sin barra ni direcciones.
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Vacio } from '../componentes/ui';
import { useTema } from '../tema/tema';

const DOCUMENTOS = {
  reglamento: { titulo: 'Reglamento', url: 'https://portal.farmasalud.lat/reglamento-puntos' },
  privacidad: { titulo: 'Aviso de privacidad', url: 'https://portal.farmasalud.lat/privacidad.html' },
};

export default function Legal() {
  const t = useTema();
  const { doc } = useLocalSearchParams();
  const d = DOCUMENTOS[doc] ?? DOCUMENTOS.reglamento;
  const [error, setError] = useState(false);
  const fondo = t.oscuro ? '#121016' : '#FFFFFF';
  return (
    <View style={{ flex: 1, backgroundColor: fondo }}>
      <Stack.Screen options={{ title: d.titulo }} />
      {error ? (
        <Vacio titulo="No se pudo abrir">Revisa tu conexión y vuelve a intentar.</Vacio>
      ) : (
        <WebView source={{ uri: d.url }} style={{ flex: 1, backgroundColor: fondo }}
          startInLoadingState renderLoading={() => <ActivityIndicator style={{ marginTop: 40 }} />}
          onError={() => setError(true)} contentInsetAdjustmentBehavior="automatic"
          // Sólo el documento: un enlace a otra página se queda afuera.
          onShouldStartLoadWithRequest={(r) => r.url.startsWith('https://portal.farmasalud.lat/') || r.url === 'about:blank'}
          allowsBackForwardNavigationGestures={false} dataDetectorTypes="none" />
      )}
    </View>
  );
}
