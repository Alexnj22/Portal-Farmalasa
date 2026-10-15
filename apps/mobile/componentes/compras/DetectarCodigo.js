// «Detectar código», NATIVO — el `DetectCodeAction` del portal: busca el
// Código de Generación (UUID 8-4-4-4-12, obligatorio en toda representación
// gráfica del DTE) dentro del PDF y, si ya hay un documento con ese código,
// ofrece unirlo (Documentos) o emparejarlo (Revisión) — `onEncontrado(match)`
// decide qué.
//
// El portal lee el PDF con el lector del navegador (`pdfjs-dist`), que acá no
// existe. Acá se lee el archivo crudo: se descomprimen sus flujos (`fflate`,
// el mismo de los ZIP de la app) y se busca el UUID en el texto que queda —
// las cadenas que dibuja la página y el enlace de consulta a Hacienda, que
// casi todos los generadores ponen con el código adentro. Lo que el portal
// tampoco puede leer (un PDF escaneado, sin capa de texto) acá da «Sin código»
// igual que allá. Si el correo ya trajo el código detectado por el servidor
// (`ai_suggested.detected_codigo_generacion`), no se baja el PDF: sólo se busca.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { unzlibSync, inflateSync } from 'fflate';
import { findPurchaseDteDocumentByCodigo } from '@nucleo/data/facturasCompra';
import { getSignedFileUrl } from '@nucleo/utils/storageFiles';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

const UUID = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;

const latin1 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return s;
};

// Las cadenas `( … )` de un flujo de contenido, pegadas: un `TJ` con
// espaciados parte el código en pedazos (`[(4F3A)-20(9B…)]TJ`).
function cadenasDelFlujo(t) {
  const out = [];
  const re = /\(((?:\\.|[^\\)])*)\)/g;
  let m;
  while ((m = re.exec(t))) out.push(m[1].replace(/\\(.)/g, '$1'));
  return out.join('');
}

// Los UUID de un texto, sin los `uuid:…` de los metadatos XMP (el id del
// archivo que pone el programa que lo generó, no el código del documento).
function uuidsDe(texto, junto) {
  UUID.lastIndex = 0;
  let m;
  while ((m = UUID.exec(texto))) {
    if (texto.slice(Math.max(0, m.index - 5), m.index).toLowerCase() === 'uuid:') continue;
    junto.add(m[0].toUpperCase());
  }
}

/** Los UUID del PDF, en orden de aparición y en mayúsculas (como `codigo_generacion`). */
export function codigosEnBytesDePdf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const crudo = latin1(u8);
  const junto = new Set();
  uuidsDe(crudo, junto);
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(crudo))) {
    if (crudo.slice(m.index - 3, m.index) === 'end') continue;   // el «endstream» del flujo anterior
    const ini = m.index + m[0].length;
    const fin = crudo.indexOf('endstream', ini);
    if (fin < 0) break;
    const dic = crudo.slice(Math.max(0, m.index - 400), m.index);
    if (!/FlateDecode/.test(dic.slice(dic.lastIndexOf('<<')))) continue;
    let plano = null;
    const trozo = u8.subarray(ini, fin);
    try { plano = unzlibSync(trozo); } catch { try { plano = inflateSync(trozo.subarray(2)); } catch { plano = null; } }
    re.lastIndex = fin;
    if (!plano) continue;
    const texto = latin1(plano);
    uuidsDe(texto, junto);
    uuidsDe(cadenasDelFlujo(texto), junto);
  }
  return [...junto];
}

async function codigosDelPdf(ruta) {
  const url = await getSignedFileUrl(ruta);
  if (!url) throw new Error('No se pudo obtener el PDF');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar el PDF (HTTP ${r.status})`);
  return codigosEnBytesDePdf(await r.arrayBuffer());
}

/**
 * `pdfPath`: el PDF a leer. `detectado`: el código que ya encontró el servidor.
 * `revisado`: el servidor ya lo miró y no encontró nada. `accion`: «Unir» o
 * «Emparejar». `onEncontrado(match)` hace la escritura (y lanza si falla).
 */
export default function DetectarCodigo({ pdfPath, detectado = null, revisado = false, accion = 'Unir', onEncontrado }) {
  const [estado, setEstado] = useState(detectado ? 'buscando' : revisado ? 'sin_codigo' : 'quieto');
  const [res, setRes] = useState(null);
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    if (!detectado) return undefined;
    let vivo = true;
    findPurchaseDteDocumentByCodigo(detectado)
      .then((match) => { if (vivo) { setRes({ codigo: detectado, match }); setEstado(match ? 'hallado' : 'no_registrado'); } })
      .catch((e) => { if (vivo) { setRes({ error: mensajeAmigable(e) }); setEstado('error'); } });
    return () => { vivo = false; };
  }, [detectado]);

  const detectar = async () => {
    setEstado('buscando');
    try {
      // Un PDF puede traer más de un código (el del documento y, en una nota,
      // el del que corrige): manda el primero que ya está registrado.
      const codigos = await codigosDelPdf(pdfPath);
      if (!codigos.length) { setEstado('sin_codigo'); return; }
      let codigo = codigos[0];
      let match = null;
      for (const c of codigos.slice(0, 5)) {
        match = await findPurchaseDteDocumentByCodigo(c);
        if (match) { codigo = c; break; }
      }
      setRes({ codigo, match });
      setEstado(match ? 'hallado' : 'no_registrado');
    } catch (e) { setRes({ error: mensajeAmigable(e) }); setEstado('error'); }
  };

  const aplicar = () => {
    const m = res.match;
    Alert.alert(`${accion} con el documento`, `${m.proveedor_nombre || 'Documento'} · ${fechaNumerica(m.fecha_emision, { anio: 'corto' })} · ${formatMoney(m.monto_total)}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: accion, onPress: async () => {
        setAplicando(true);
        try { await onEncontrado(m); } catch (e) { Alert.alert('No se pudo aplicar', mensajeAmigable(e, 'El documento no quedó enlazado. Intenta de nuevo.')); }
        finally { setAplicando(false); }
      } },
    ]);
  };

  const enlace = (texto, onPress, color = MARCA.azulClaro) => (
    <Pressable onPress={onPress} disabled={aplicando} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: pressed || aplicando ? 0.6 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );

  if (estado === 'quieto') return enlace('Detectar código', detectar);
  if (estado === 'buscando') return <View style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 }}><ActivityIndicator /><Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Analizando el PDF…</Text></View>;
  if (estado === 'sin_codigo') return enlace('Sin código en el PDF · reintentar', detectar, colorSistema.texto2);
  if (estado === 'error') return enlace(`Error al detectar · reintentar`, detectar, MARCA.rojo);
  if (estado === 'no_registrado') return <Text selectable style={{ color: colorSistema.texto2, fontSize: 13, paddingVertical: 8 }}>{`Código sin registrar: ${res.codigo}`}</Text>;
  return enlace(aplicando ? 'Aplicando…' : `Encontrado: ${res.match.proveedor_nombre || 'el documento'} · ${accion.toLowerCase()} ›`, aplicar, MARCA.verde);
}
