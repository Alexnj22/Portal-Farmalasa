// La imprenta del pedido en el teléfono: un WebView OCULTO que corre el mismo
// pdfmake y la misma definición del papel que el portal
// (`motor/motor-pedido.html`, armado por `scripts/motor-pedido.mjs` desde
// `src/utils/pedidoPdfDoc.js`). Da las MISMAS hojas que la computadora —de eso
// depende qué producto va en qué caja— y el MISMO PDF.
//
// Se carga sólo cuando alguien imprime o finaliza (pdfmake con sus fuentes son
// ~2 MB) y se apaga solo a los 90 s sin pedidos. `<MotorPedido />` va UNA vez
// en el `_layout`; las pantallas sólo llaman `hojasExactas` / `pdfDelPedido`.
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { leerDireccionesDeSalas } from '@nucleo/data/pedidos';
// Un ARCHIVO (asset), no código: Metro lo copia aparte y no pesa en el arranque.
import ARCHIVO_DEL_MOTOR from '../../motor/motor-pedido.html';

const APAGAR_MS = 90_000;
const ESPERA_MS = 120_000;

let host = null;          // el componente montado: { encender, enviar }
let listo = false;        // el WebView ya avisó que cargó el motor
let siguienteId = 1;
const cola = [];          // pedidos que llegaron antes de que cargara
const esperando = new Map();

function resolverTodos(error) {
  for (const [id, p] of esperando) { clearTimeout(p.reloj); p.reject(error); esperando.delete(id); }
  cola.length = 0;
}

function pedir(tipo, datos) {
  return new Promise((resolve, reject) => {
    if (!host) { reject(new Error('La imprenta del pedido no está disponible en esta pantalla.')); return; }
    const id = siguienteId++;
    const reloj = setTimeout(() => {
      esperando.delete(id);
      reject(new Error('La imprenta del pedido tardó demasiado. Intenta de nuevo.'));
    }, ESPERA_MS);
    esperando.set(id, { resolve, reject, reloj });
    const msg = { id, tipo, ...datos };
    if (listo) host.enviar(msg); else cola.push(msg);
    host.encender();
  });
}

// Sólo lo que lee la definición del papel: un pedido de 460 productos trae
// precios, presentaciones y más por renglón, y todo eso cruzaría el puente.
const renglonParaElPapel = (r) => ({
  id: r.id,
  sin_stock: r.sin_stock,
  caja_especial: r.caja_especial,
  factor: r.factor,
  dispatch_factor: r.dispatch_factor,
  dispatch_tipo: r.dispatch_tipo,
  tiene_dispatch_label: r.tiene_dispatch_label,
  cantidad_asignada: r.cantidad_asignada,
  lotes_asignados: r.lotes_asignados,
  presentaciones: r.presentaciones ? { tipo: r.presentaciones.tipo } : null,
  products: r.products ? {
    nombre: r.products.nombre,
    es_antibiotico: r.products.es_antibiotico,
    laboratorios: r.products.laboratorios ? { nombre: r.products.laboratorios.nombre } : null,
  } : null,
});

// El PDF llega del WebView en base64; se escribe como bytes (igual que el ZIP
// de facturas), sin depender de que el motor JS tenga `atob`.
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALOR = Object.fromEntries([...ALFABETO].map((c, i) => [c, i]));
function base64ABytes(b64) {
  const limpio = String(b64).replace(/[^A-Za-z0-9+/]/g, '');
  const n = Math.floor((limpio.length * 3) / 4);
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < limpio.length; i += 4) {
    const a = VALOR[limpio[i]], b = VALOR[limpio[i + 1]], c = VALOR[limpio[i + 2]] ?? 0, d = VALOR[limpio[i + 3]] ?? 0;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < n) out[o++] = (v >> 16) & 255;
    if (o < n) out[o++] = (v >> 8) & 255;
    if (o < n) out[o++] = v & 255;
  }
  return out;
}

let direcciones = null;
async function addrMap() {
  if (!direcciones) direcciones = await leerDireccionesDeSalas();
  return direcciones;
}

/** Las hojas EXACTAS de una sala (las mismas del portal). `null` = sin anotar. */
export async function hojasExactas(sucId, items) {
  return pedir('hojas', { sucId: Number(sucId), items: (items ?? []).map(renglonParaElPapel), addrMap: await addrMap() });
}

/**
 * El PDF del pedido (las secciones de `pedidoPdfDoc`), escrito en el teléfono.
 * Devuelve la `uri` del archivo, con el nombre que tendría en la computadora.
 */
export async function pdfDelPedido({ sections, title, meta, nombre }) {
  const b64 = await pedir('pdf', { sections, title, meta, addrMap: await addrMap() });
  const limpio = String(nombre || title || 'Pedido').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\.pdf$/i, '').trim().slice(0, 80);
  const archivo = new File(Paths.cache, `${limpio}.pdf`);
  if (archivo.exists) archivo.delete();
  archivo.create();
  archivo.write(base64ABytes(b64));
  return archivo.uri;
}

export function MotorPedido() {
  const [vivo, setVivo] = useState(false);
  const [uri, setUri] = useState(null);
  const web = useRef(null);
  const apagar = useRef(null);

  useEffect(() => {
    host = {
      encender: () => { clearTimeout(apagar.current); setVivo(true); },
      enviar: (msg) => web.current?.injectJavaScript(`window.motorPedido.pedir(${JSON.stringify(msg)});true;`),
    };
    return () => { host = null; listo = false; clearTimeout(apagar.current); resolverTodos(new Error('La imprenta se cerró.')); };
  }, []);

  // El archivo del motor se resuelve la primera vez que hace falta.
  useEffect(() => {
    if (!vivo || uri) return;
    const asset = Asset.fromModule(ARCHIVO_DEL_MOTOR);
    Promise.resolve(asset.downloadAsync())
      .then(() => setUri(asset.localUri ?? asset.uri))
      .catch(() => { setVivo(false); resolverTodos(new Error('No se pudo cargar la imprenta del pedido.')); });
  }, [vivo, uri]);

  const programarApagado = () => {
    clearTimeout(apagar.current);
    apagar.current = setTimeout(() => {
      if (esperando.size || cola.length) return;
      listo = false;
      setVivo(false);
    }, APAGAR_MS);
  };

  const alRecibir = (e) => {
    let m;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.id === 0) {
      listo = true;
      while (cola.length) host?.enviar(cola.shift());
      return;
    }
    const p = esperando.get(m.id);
    if (!p) return;
    esperando.delete(m.id);
    clearTimeout(p.reloj);
    if (m.ok) p.resolve(m.data); else p.reject(new Error(m.data || 'La imprenta del pedido falló.'));
    if (!esperando.size) programarApagado();
  };

  if (!vivo || !uri) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}>
      <WebView
        ref={web}
        source={{ uri }}
        originWhitelist={['*']}
        allowFileAccess
        allowingReadAccessToURL={uri}
        javaScriptEnabled
        onMessage={alRecibir}
        onError={() => { listo = false; setVivo(false); resolverTodos(new Error('No se pudo abrir la imprenta del pedido.')); }}
        onContentProcessDidTerminate={() => { listo = false; setVivo(false); resolverTodos(new Error('La imprenta del pedido se cerró. Intenta de nuevo.')); }}
      />
    </View>
  );
}
