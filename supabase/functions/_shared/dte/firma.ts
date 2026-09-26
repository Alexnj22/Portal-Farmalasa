// Firma de un DTE — la misma que hace el firmador oficial de Hacienda, sin Java.
//
// ── Qué hace el firmador oficial (leído de su código fuente) ───────────────
// `svfe-api-firmador` (factura.gob.sv, descarga 5) hace exactamente esto en
// `FirmarDocumentoBusiness.firmarJSON`:
//
//     jws.setPayload(contenido);              // el JSON del DTE, como texto
//     jws.setAlgorithmHeaderValue("RS512");   // RSASSA-PKCS1-v1_5 + SHA-512
//     jws.setKey(llavePrivadaPKCS8);
//     return jws.getCompactSerialization();   // base64url(h).base64url(p).base64url(firma)
//
// La llave privada sale del certificado que entrega Hacienda: un XML
// `<CertificadoMH>` con `<privateKey><encodied>` en base64 (PKCS#8, SIN cifrar)
// y `<clave>` = SHA-512 en hexadecimal de la «contraseña privada». La
// contraseña NO descifra nada: sólo se compara contra ese hash. O sea que
// **quien tiene el archivo `.crt` puede firmar a nombre de la empresa**, y por
// eso vive en el Vault, nunca en el navegador ni en el repositorio.
//
// Todo esto está en WebCrypto, que existe igual en Deno (Edge Functions) y en
// Node (las pruebas). No hace falta contenedor.

const enc = new TextEncoder();

/** Bytes respaldados por un `ArrayBuffer` común — lo que acepta WebCrypto. */
type Bytes = Uint8Array<ArrayBuffer>;

function b64aBytes(b64: string): Bytes {
  const limpio = b64.replace(/\s+/g, "");
  const bin = atob(limpio);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlABytes(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return b64aBytes(b64);
}

async function sha512Hex(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-512", enc.encode(texto)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CertificadoMH {
  nit: string | null;
  llavePrivadaPkcs8: Bytes;
  llavePublicaSpki: Bytes | null;
  hashClavePrivada: string | null;
}

/** El contenido de una etiqueta, buscada dentro de un bloque. */
function etiqueta(xml: string, nombre: string): string | null {
  const m = new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`).exec(xml);
  return m ? m[1].trim() : null;
}

/** Lee el `.crt` de Hacienda (XML `<CertificadoMH>`). */
export function leerCertificadoMH(xml: string): CertificadoMH {
  const priv = etiqueta(xml, "privateKey");
  const privB64 = priv ? etiqueta(priv, "encodied") : null;
  if (!privB64) throw new Error("el certificado no trae la llave privada (<privateKey><encodied>)");
  const pub = etiqueta(xml, "publicKey");
  const pubB64 = pub ? etiqueta(pub, "encodied") : null;
  return {
    nit: etiqueta(xml, "nit"),
    llavePrivadaPkcs8: b64aBytes(privB64),
    llavePublicaSpki: pubB64 ? b64aBytes(pubB64) : null,
    hashClavePrivada: priv ? etiqueta(priv, "clave") : null,
  };
}

/**
 * ¿Es ésta la contraseña privada del certificado? Es la misma comprobación que
 * hace el firmador oficial antes de firmar. Sirve para rechazar una
 * configuración equivocada al guardarla, no como protección.
 */
export async function claveCoincide(cert: CertificadoMH, clave: string): Promise<boolean> {
  if (!cert.hashClavePrivada) return false;
  return (await sha512Hex(clave)).toLowerCase() === cert.hashClavePrivada.toLowerCase();
}

const ALGORITMO = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" } as const;

export function importarLlavePrivada(pkcs8: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pkcs8, ALGORITMO, false, ["sign"]);
}

/** Firma el DTE → JWS compacto, igual que `getCompactSerialization()`. */
export async function firmarDte(dte: unknown, llave: CryptoKey): Promise<string> {
  const cabecera = base64url(enc.encode(JSON.stringify({ alg: "RS512" })));
  const carga = base64url(enc.encode(typeof dte === "string" ? dte : JSON.stringify(dte)));
  const firma = new Uint8Array(await crypto.subtle.sign(ALGORITMO, llave, enc.encode(`${cabecera}.${carga}`)));
  return `${cabecera}.${carga}.${base64url(firma)}`;
}

/** Verifica un JWS con la llave pública del certificado y devuelve su carga. */
export async function verificarFirma(jws: string, spki: Bytes): Promise<unknown> {
  const [h, p, f] = jws.split(".");
  if (!h || !p || !f) throw new Error("no es un JWS compacto");
  const llave = await crypto.subtle.importKey("spki", spki, ALGORITMO, false, ["verify"]);
  const ok = await crypto.subtle.verify(ALGORITMO, llave, base64urlABytes(f), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error("la firma no corresponde a esta llave");
  return JSON.parse(new TextDecoder().decode(base64urlABytes(p)));
}
