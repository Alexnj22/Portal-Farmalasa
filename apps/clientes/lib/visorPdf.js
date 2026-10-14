// El PDF dentro de la app en Android (2026-10-09).
//
// La vista web de Android NO muestra PDF (la de iPhone sí): con la dirección
// del documento, Android lo mandaba al navegador de afuera. Dos salidas sin
// agregar un módulo nativo:
//   - el visor de Google (`docs.google.com/gview?url=…`): le entrega a Google
//     la dirección firmada, o sea la factura del cliente con su nombre, NIT y
//     montos. Descartado.
//   - pdf.js (Mozilla) dentro de la vista web, con el PDF YA DESCARGADO en el
//     teléfono y pasado como base64: el documento no sale del teléfono. Lo
//     único que viaja es la descarga de la librería desde cdnjs, fijada en una
//     versión y con huella de integridad (SRI) en el script principal.
//
// Se pinta cada página en un <canvas> al ancho de la pantalla (×2 para que el
// texto se lea nítido al ampliar con dos dedos). Avisa a la app con
// `postMessage`: «listo» al pintar la primera página, «error» si algo falla.
//
// 2026-10-14, «el PDF tarda en abrir»: el PDF ya no viaja en base64 DENTRO del
// HTML. Leer el archivo entero a una cadena en JavaScript, armar un HTML de
// varios MB y que la vista web lo vuelva a decodificar eran tres copias del
// documento. Ahora (`htmlVisorPdfArchivo`) el HTML se escribe como archivo al
// lado del PDF descargado y lo lee él mismo con XHR desde `file://` — el PDF
// nunca pasa por el hilo de JavaScript. Si esa vía falla en algún Android
// (vista web vieja, acceso a archivos bloqueado), la página avisa «reintentar»
// ANTES de pintar nada y la app vuelve al camino de siempre, con el base64
// adentro (`htmlVisorPdf`).
const VERSION = '3.11.174';
export const ORIGEN_PDFJS = 'https://cdnjs.cloudflare.com/';
const BASE = `${ORIGEN_PDFJS}ajax/libs/pdf.js/${VERSION}`;
const SRI = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';

// La página con pdf.js; `cargar` es una expresión JS que devuelve una promesa
// con los bytes del PDF (Uint8Array). Si falla ANTES de tener los bytes o la
// librería, avisa `fallo` (la app decide si reintenta por otra vía).
function pagina(cargar, fondo, fallo) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes">
<style>
html,body{margin:0;padding:0;background:${fondo}}
#p{display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px 0 40px}
canvas{width:calc(100vw - 24px);height:auto;background:#fff;border-radius:4px;box-shadow:0 1px 6px rgba(0,0,0,.18)}
</style>
<script src="${BASE}/pdf.min.js" integrity="${SRI}" crossorigin="anonymous"></script>
</head><body><div id="p"></div><script>
(function(){
  var avisar=function(t){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(t); };
  var listo=false, abierto=false;
  (async function(){
    try{
      if(typeof pdfjsLib==='undefined') throw new Error('sin pdf.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc='${BASE}/pdf.worker.min.js';
      var u=await (${cargar});
      var doc=await pdfjsLib.getDocument({data:u}).promise;
      abierto=true;
      var ancho=Math.max(200,document.documentElement.clientWidth-24);
      var dpr=Math.min(window.devicePixelRatio||1,3);
      for(var n=1;n<=doc.numPages;n++){
        var pg=await doc.getPage(n);
        var v1=pg.getViewport({scale:1});
        var vp=pg.getViewport({scale:(ancho/v1.width)*dpr*2});
        var c=document.createElement('canvas'); c.width=Math.floor(vp.width); c.height=Math.floor(vp.height);
        c.setAttribute('aria-label','Página '+n+' de '+doc.numPages);
        document.getElementById('p').appendChild(c);
        await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
        if(!listo){ listo=true; avisar('listo'); }
      }
      if(!listo) avisar('error');
    }catch(e){ avisar(listo?'parcial':abierto?'error':'${fallo}'); }
  })();
})();
</script></body></html>`;
}

/** El HTML del visor con el PDF adentro (base64). `fondo`: color de la hoja. */
export function htmlVisorPdf(base64, fondo) {
  // El base64 sólo trae [A-Za-z0-9+/=]: va seguro dentro de una cadena.
  const datos = String(base64).replace(/[^A-Za-z0-9+/=]/g, '');
  const cargar = `Promise.resolve().then(function(){var bin=atob('${datos}');var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;})`;
  return pagina(cargar, fondo, 'error');
}

/**
 * El HTML del visor que lee el PDF de un ARCHIVO vecino (2026-10-14). Se
 * escribe en la misma carpeta que el PDF y se abre por `file://`; `nombre` es
 * el nombre del PDF (sólo [A-Za-z0-9._-], lo arma la app). Si no puede leerlo
 * o no carga pdf.js, avisa «reintentar».
 */
export function htmlVisorPdfArchivo(nombre, fondo) {
  const archivo = encodeURIComponent(String(nombre).replace(/[^A-Za-z0-9._-]/g, ''));
  const cargar = `new Promise(function(ok,mal){var x=new XMLHttpRequest();x.open('GET','${archivo}');x.responseType='arraybuffer';`
    + `x.onload=function(){if((x.status===0||x.status===200)&&x.response&&x.response.byteLength)ok(new Uint8Array(x.response));else mal(new Error('xhr '+x.status));};`
    + `x.onerror=function(){mal(new Error('xhr'));};x.send();})`;
  return pagina(cargar, fondo, 'reintentar');
}
