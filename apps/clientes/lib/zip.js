// Un .zip mínimo (sin comprimir, método «store»), escrito en JavaScript.
// Existe porque la hoja de compartir de iOS sólo recibe UN archivo y la app no
// trae ningún módulo nativo para mandar varios: para entregar el PDF y el JSON
// de una factura de una sola vez, se empaquetan en un .zip y se comparte ése.
// Los dos documentos ya son chicos (decenas de kB), así que no hace falta
// comprimir — y sin compresión no hay nada que pueda salir mal al abrirlo.

// 2026-11-04 (auditoría de rendimiento): con «Seleccionar» se juntan hasta 30
// facturas, o sea 60 archivos. Pasarlos de base64 a bytes, sacarles el CRC32 y
// volver a base64 en una sola pasada ocupaba el hilo de JavaScript entero y la
// app se congelaba —ni el botón ni el progreso se repintaban—. Las versiones
// `…Cediendo` hacen el mismo trabajo pero devuelven el hilo entre archivo y
// archivo (un tick de `setTimeout`), así la interfaz se repinta y el progreso
// avanza. No es más rápido: es lo mismo, sin congelar. Para algo más rápido
// haría falta un módulo nativo, y la app no agrega dependencias nativas.
export const cederHilo = () => new Promise((r) => setTimeout(r, 0));

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function base64ABytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesABase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Lo mismo, por tramos, cediendo el hilo entre uno y otro. El tramo es
// múltiplo de 3 bytes: así cada pedazo en base64 sale sin relleno `=` y
// pegarlos da exactamente el base64 del total.
const TRAMO_B64 = 3 * 0x10000; // ~192 kB por vuelta
export async function bytesABase64Cediendo(bytes) {
  const pedazos = [];
  for (let i = 0; i < bytes.length; i += TRAMO_B64) {
    pedazos.push(bytesABase64(bytes.subarray(i, i + TRAMO_B64)));
    if (i + TRAMO_B64 < bytes.length) await cederHilo();
  }
  return pedazos.join('');
}

// Nombres sólo ASCII: así cualquier descompresor los lee igual, sin depender
// de la marca de UTF-8.
const nombreAscii = (s) => Array.from(String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''))
  .map((ch) => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 95));

/** archivos: [{ nombre, bytes: Uint8Array }] → Uint8Array del .zip. */
export function armarZip(archivos) {
  return armarZipCon(archivos, null);
}

/**
 * Igual que `armarZip`, pero cede el hilo después de cada archivo y avisa
 * `alAvance(hechos, total)` (2026-11-04). Devuelve una promesa.
 */
export async function armarZipCediendo(archivos, alAvance) {
  return armarZipCon(archivos, async (i) => { alAvance?.(i, archivos.length); await cederHilo(); });
}

// El armado, una sola vez para las dos: con `pausa`, es asíncrono y espera
// después de cada archivo; sin ella, es síncrono como siempre.
function armarZipCon(archivos, pausa) {
  if (!pausa) return armarZipPasos(archivos, false).next().value;
  return (async () => {
    const pasos = armarZipPasos(archivos, true);
    for (let r = pasos.next(); ; r = pasos.next()) {
      if (r.done) return r.value;
      await pausa(r.value);
    }
  })();
}

// Generador: con `ceder`, entrega cuántos archivos van después de cada uno y,
// al final, el .zip. Sin `ceder` no se detiene nunca, así que el primer
// `.next()` ya trae el .zip terminado.
function* armarZipPasos(archivos, ceder) {
  const partes = [];
  const central = [];
  let desplazamiento = 0;
  const ahora = new Date();
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const dia = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();

  for (const a of archivos) {
    const nombre = nombreAscii(a.nombre);
    const crc = crc32(a.bytes);
    const tam = a.bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, tam, true);
    local.setUint32(22, tam, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), Uint8Array.from(nombre), a.bytes);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, dia, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, tam, true);
    c.setUint32(24, tam, true);
    c.setUint16(28, nombre.length, true);
    c.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(c.buffer), Uint8Array.from(nombre));

    desplazamiento += 30 + nombre.length + tam;
    if (ceder) yield partes.length / 3;
  }

  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, desplazamiento, true);

  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const out = new Uint8Array(todo.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of todo) { out.set(p, i); i += p.length; }
  return out;
}
