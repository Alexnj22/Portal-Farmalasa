// El visor de archivos DENTRO de la app (2026-11-12, usuario: «le di en abrir
// a un archivo, pero abre un navegador, no se abre dentro de la app»). Todo lo
// que el núcleo abre con `abrirEnPestanaNueva` (expediente, documentos,
// comprobantes, folios…) llega acá por `plataforma/descargas.js`.
//
// iPhone: el WebView del sistema muestra PDF, imágenes y documentos de Office
// tal cual. Android: su WebView NO pinta PDF, así que el PDF se dibuja con
// pdf.js página por página; una imagen va directo; lo demás (un .docx) no
// tiene cómo verse dentro y se abre en el navegador, como antes.
//
// «Navegador» (arriba a la derecha) queda como salida: para guardar o
// compartir con los botones del sistema.
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Indicador from '../componentes/Indicador';
import { Stack, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';

const extensionDe = (url) => (String(url || '').split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const IMAGENES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']);

// pdf.js (cdnjs, versión fija) dibuja cada página en un canvas al ancho de la
// pantalla. El PDF lo baja la APP (sin CORS) y se le pasa en base64: pedido
// desde la página, un servidor sin CORS lo negaba y se quedaba en «Cargando…».
const paginaPdf = (datos) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<style>html,body{margin:0;background:#525659}canvas{display:block;margin:8px auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
#m{color:#fff;font:15px -apple-system,Roboto,sans-serif;text-align:center;padding:40px 16px}</style></head><body><div id="m">Cargando…</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const msg=document.getElementById('m');
pdfjsLib.getDocument({data:Uint8Array.from(atob(${JSON.stringify(datos)}),c=>c.charCodeAt(0))}).promise.then(async(pdf)=>{
  msg.remove();
  const ancho=document.body.clientWidth-16, dpr=window.devicePixelRatio||1;
  for(let i=1;i<=pdf.numPages;i++){
    const p=await pdf.getPage(i); const v1=p.getViewport({scale:1}); const esc=ancho/v1.width;
    const v=p.getViewport({scale:esc*dpr}); const c=document.createElement('canvas');
    c.width=v.width; c.height=v.height; c.style.width=(v.width/dpr)+'px'; c.style.height=(v.height/dpr)+'px';
    document.body.appendChild(c); await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
  }
}).catch(()=>{msg.textContent='No se pudo mostrar el documento. Prueba con «Navegador», arriba.';});
</script></body></html>`;

export default function Visor() {
  const { url, titulo } = useLocalSearchParams();
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(false);
  const ext = extensionDe(url);
  const pdfEnAndroid = Platform.OS === 'android' && ext === 'pdf';
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    if (!pdfEnAndroid || !url) return undefined;
    let vivo = true;
    fetch(String(url))
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((b) => new Promise((ok, mal) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = mal; fr.readAsDataURL(b); }))
      .then((b64) => { if (vivo) setDatos(b64); })
      .catch(() => { if (vivo) { setFallo(true); setCargando(false); } });
    return () => { vivo = false; };
  }, [pdfEnAndroid, url]);
  const fuente = useMemo(() => {
    if (!url) return null;
    if (pdfEnAndroid) return datos ? { html: paginaPdf(datos), baseUrl: 'https://cdnjs.cloudflare.com' } : null;
    if (Platform.OS === 'android' && IMAGENES.has(ext)) {
      return { html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5"><style>html,body{margin:0;background:#000;height:100%;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%}</style></head><body><img src=${JSON.stringify(String(url))}></body></html>` };
    }
    return { uri: String(url) };
  }, [url, ext, pdfEnAndroid, datos]);
  const afuera = () => { if (url) WebBrowser.openBrowserAsync(String(url)).catch(() => {}); };

  return (
    <>
      <Stack.Screen options={{
        title: titulo ? String(titulo) : 'Documento', headerLargeTitle: false, headerTransparent: false,
        headerRight: () => (
          <Pressable onPress={afuera} hitSlop={10} accessibilityRole="button" accessibilityLabel="Abrir en el navegador para guardar o compartir">
            <Text style={{ color: colorSistema.acento, fontSize: 16, fontWeight: '600' }}>Navegador</Text>
          </Pressable>
        ),
      }} />
      {!url ? <Aviso tono="freno" texto="No hay documento que abrir." /> : !fuente ? (
        <View style={{ flex: 1, backgroundColor: '#525659', justifyContent: 'center' }}>
          {fallo ? <Aviso tono="freno" texto="No se pudo bajar el documento. Prueba con «Navegador», arriba." /> : <Indicador color="#fff" />}
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: '#525659' }}>
          <WebView source={fuente} originWhitelist={['*']} style={{ flex: 1, backgroundColor: 'transparent' }}
            onLoadEnd={() => setCargando(false)} onError={() => { setCargando(false); setFallo(true); }}
            allowsInlineMediaPlayback mixedContentMode="always" setSupportMultipleWindows={false} />
          {cargando ? <Indicador style={{ position: 'absolute', top: '45%', alignSelf: 'center' }} color="#fff" /> : null}
          {fallo ? (
            <View style={{ position: 'absolute', top: 24, left: 16, right: 16 }}>
              <Aviso tono="freno" texto="No se pudo mostrar el documento. Prueba con «Navegador», arriba." />
            </View>
          ) : null}
        </View>
      )}
    </>
  );
}

