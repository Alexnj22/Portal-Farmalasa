// La imprenta del pedido en el teléfono: el MISMO pdfmake y la MISMA
// definición del papel que el portal (`src/utils/pedidoPdfDoc.js`), corriendo
// dentro de un WebView oculto (`componentes/pedidos/motorPedido.js`).
//
// No lo importa la app: lo empaqueta `scripts/motor-pedido.mjs` en
// `motor/motor-pedido.html`, que la app carga SÓLO al imprimir o finalizar.
// pdfmake con sus fuentes son ~3 MB: en el bundle de la app viajarían en el
// arranque, y Metro no parte el código.
//
// Por qué no un maquetador propio: las hojas de un pedido salen de en qué
// página cae cada renglón del PDF, y otro maquetador corta en otros renglones —
// las cajas se llevarían productos de otra hoja. Mismo código, mismas hojas.
//
// Mensajes: la app llama `window.motorPedido.pedir({ id, tipo, ... })` y la
// respuesta vuelve por `ReactNativeWebView.postMessage({ id, ok, data })`.
//   tipo 'hojas' { sucId, items, addrMap }            → grupos exactos (o null)
//   tipo 'pdf'   { sections, title, meta, addrMap }   → el PDF en base64
import pdfMakeModulo from 'pdfmake/build/pdfmake';
import vfsModulo from 'pdfmake/build/vfs_fonts';
import { buildDocDefinition, prepararHojasExactas } from '../../../src/utils/pedidoPdfDoc.js';

const pdfMake = pdfMakeModulo.default || pdfMakeModulo;
pdfMake.addVirtualFileSystem(vfsModulo.default || vfsModulo);

// El logo del portal (`public/Logo512.png`), incrustado al empaquetar.
// eslint-disable-next-line no-undef
const LOGO = __LOGO_DEL_PORTAL__;

async function hojas({ sucId, items, addrMap }) {
    const captura = prepararHojasExactas(sucId, items ?? [], LOGO, addrMap ?? {});
    if (!captura) return [];
    await pdfMake.createPdf(captura.docDef).getBuffer();
    return captura.grupos();
}

function pdf({ sections, title, meta, addrMap }) {
    const def = buildDocDefinition(sections ?? [], title ?? '', meta ?? {}, LOGO, addrMap ?? {});
    return pdfMake.createPdf(def).getBase64();
}

const TAREAS = { hojas, pdf };

function responder(id, ok, data) {
    window.ReactNativeWebView?.postMessage(JSON.stringify({ id, ok, data }));
}

window.motorPedido = {
    async pedir(msg) {
        try {
            const tarea = TAREAS[msg?.tipo];
            if (!tarea) throw new Error(`Tarea desconocida: ${msg?.tipo}`);
            responder(msg.id, true, await tarea(msg));
        } catch (e) {
            responder(msg?.id, false, String(e?.message ?? e));
        }
    },
    // Para la prueba que compara con el portal (no la usa la app).
    hojas, pdf,
};

responder(0, true, 'listo');
