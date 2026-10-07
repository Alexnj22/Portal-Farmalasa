// La vista previa de un papel (el ticket o la hoja del documento) dentro de la
// pantalla, como los `<iframe>` del documento en el portal: lo que se ve acá
// es exactamente lo que se imprime o se comparte. Sin radio ni tema: es papel.
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';

export default function VistaPapel({ html, alto = 560, ancho = null }) {
  if (!html) return <ActivityIndicator style={{ marginVertical: 24 }} />;
  return (
    <View style={{ height: alto, marginHorizontal: 16, backgroundColor: '#fff', borderWidth: 0.5, borderColor: 'rgba(127,127,127,0.4)', overflow: 'hidden', alignSelf: ancho ? 'center' : 'stretch', width: ancho ?? undefined }}>
      <WebView originWhitelist={['*']} source={{ html }} scalesPageToFit
        setSupportMultipleWindows={false} style={{ backgroundColor: '#fff' }} />
    </View>
  );
}
