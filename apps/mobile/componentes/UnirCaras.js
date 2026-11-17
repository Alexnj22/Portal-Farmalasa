// Frente y reverso en UNA imagen: frente arriba, reverso abajo, sobre blanco.
//
// Es lo que hace `unirCaras` en la página `/foto` del portal, y por la misma
// razón: viajan por el canal de una foto —un archivo, un código— y del otro
// lado `partirCarasDelDui` las vuelve a separar. La computadora espera una
// IMAGEN; un PDF de dos páginas no lo sabría partir.
//
// Se une con el lienzo de una WebView oculta y no con una librería nativa
// (`react-native-view-shot`): la WebView ya viene en la app, el lienzo da los
// píxeles exactos —el mismo dibujo que la web— y una captura de una vista
// fuera de pantalla sale en blanco en algunos teléfonos. Un módulo nativo
// nuevo, además, no se puede corregir por aire.
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

const pagina = (frente, reverso) => `<!doctype html><html><body><script>
const abrir = (src) => new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('img')); i.src = src; });
(async () => {
  try {
    const [a, b] = await Promise.all([abrir(${JSON.stringify(frente)}), abrir(${JSON.stringify(reverso)})]);
    const ancho = Math.max(a.naturalWidth, b.naturalWidth);
    const hueco = Math.round(ancho * 0.04);
    const c = document.createElement('canvas');
    c.width = ancho; c.height = a.naturalHeight + hueco + b.naturalHeight;
    const x = c.getContext('2d');
    x.fillStyle = 'white'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(a, Math.round((ancho - a.naturalWidth) / 2), 0);
    x.drawImage(b, Math.round((ancho - b.naturalWidth) / 2), a.naturalHeight + hueco);
    window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, base64: c.toDataURL('image/jpeg', 0.9).split(',')[1] }));
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false }));
  }
})();
</script></body></html>`;

/**
 * Se monta mientras se unen y se desmonta al terminar.
 *
 * @param {{frente: string, reverso: string}} caras  base64 JPEG de cada cara (sin prefijo)
 * @param {(base64: string) => void} onListo
 * @param {(motivo: string) => void} onError
 */
export default function UnirCaras({ caras, onListo, onError }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}>
      <WebView
        originWhitelist={['*']}
        source={{ html: pagina(`data:image/jpeg;base64,${caras.frente}`, `data:image/jpeg;base64,${caras.reverso}`) }}
        onMessage={(e) => {
          let r = null;
          try { r = JSON.parse(e.nativeEvent.data); } catch { /* abajo */ }
          if (r?.ok && r.base64) onListo(r.base64);
          else onError('No se pudieron unir las dos caras. Intenta de nuevo.');
        }}
        onError={() => onError('No se pudieron unir las dos caras. Intenta de nuevo.')}
      />
    </View>
  );
}
