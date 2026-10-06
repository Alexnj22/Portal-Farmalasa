// La tarjeta de socio para Apple Wallet (.pkpass), firmada en el servidor
// (2026-10-06).
//
// Un .pkpass es un ZIP con `pass.json`, las imágenes, un `manifest.json` (el
// SHA-1 de cada archivo) y `signature`: la firma PKCS#7 separada del manifiesto,
// hecha con el certificado «Pass Type ID» del equipo y la cadena de Apple
// (WWDR G4). Sin firma válida, el iPhone no la acepta.
//
// Los tres PEM viven en secretos de la función (WALLET_CERT_B64,
// WALLET_KEY_B64, WALLET_WWDR_B64, en base64); la llave privada nunca está en
// el repositorio. El certificado vence el 2027-11-05: renovarlo es crear otro
// en developer.apple.com con el mismo CSR (`~/.claves-farmalasa`).
//
// Qué lleva: el QR con la MISMA dirección que el ticket y la tarjeta de la app
// (`/mis-puntos?codigo=`), el saldo en dólares al frente, los puntos y el
// nombre. Es una FOTO del momento: para ver el saldo nuevo se vuelve a agregar
// desde la app (la actualización automática pide un servicio aparte).
import forge from "npm:node-forge@1.3.1";
import { zipSync } from "npm:fflate@0.8.2";
import { IMAGENES_PASE } from "./imagenesPase.ts";

const PASS_TYPE = "pass.lat.farmasalud.puntos";
const EQUIPO = "ZZWA3Q7Q35";

export interface DatosPase {
  customerId: number;
  nombre: string;
  saldo: number;
  equivale: number;
  codigo: string | null;
  socioDesde: string | null;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const desde = (f: string | null) => {
  const m = String(f ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : "—";
};
// Primer nombre + primer apellido, la regla del portal.
const corto = (n: string) => {
  const p = String(n ?? "").trim().split(/\s+/).filter(Boolean);
  const x = p.length >= 4 ? [p[0], p[2]] : p.length === 3 ? [p[0], p[1]] : p;
  return x.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
};
// Bytes → «cadena binaria» de forge, por tramos: `forge.util.binary.raw.encode`
// usa `String.fromCharCode.apply` de un golpe y con la franja @3x (~180 KB)
// revienta la pila («Maximum call stack size exceeded», medido 2026-10-06).
const aBinario = (b: Uint8Array) => {
  let t = "";
  for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return t;
};
const pem = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

export function armarPase(d: DatosPase): Uint8Array {
  const certB64 = Deno.env.get("WALLET_CERT_B64"), keyB64 = Deno.env.get("WALLET_KEY_B64"), wwdrB64 = Deno.env.get("WALLET_WWDR_B64");
  if (!certB64 || !keyB64 || !wwdrB64) throw new Error("faltan los certificados de Wallet");

  const qr = d.codigo ? `https://portal.farmasalud.lat/mis-puntos?codigo=${d.codigo}` : "https://portal.farmasalud.lat/mis-puntos";
  const pase = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE,
    teamIdentifier: EQUIPO,
    serialNumber: `socio-${d.customerId}`,
    organizationName: "Farmacia Salud",
    description: "Tarjeta de socio Puntos Salud",
    logoText: "Puntos Salud",
    // El fondo continúa el tono oscuro de la franja (scripts/wallet/imagenes.py),
    // y los rótulos van en el verde del logo: así la franja y el cuerpo se leen
    // como UNA tarjeta y no como un rectángulo pegado sobre otro.
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(180, 228, 80)",
    backgroundColor: "rgb(52, 14, 66)",
    storeCard: {
      headerFields: [{ key: "puntos", label: "PUNTOS", value: Math.round(d.saldo), textAlignment: "PKTextAlignmentRight" }],
      primaryFields: [{ key: "saldo", label: "SALDO PARA DESCONTAR", value: d.equivale, currencyCode: "USD" }],
      secondaryFields: [
        { key: "nombre", label: "SOCIO", value: corto(d.nombre) },
        { key: "desde", label: "DESDE", value: desde(d.socioDesde), textAlignment: "PKTextAlignmentRight" },
      ],
      backFields: [
        { key: "como", label: "Cómo se usa", value: "Muestra el código en caja: acumulas en cada compra y canjeas desde 100 puntos ($1)." },
        { key: "foto", label: "Saldo", value: "El saldo de esta tarjeta es el del día en que la agregaste. El actualizado siempre está en la app Puntos Salud." },
        { key: "codigo", label: "Tu código", value: d.codigo ?? "—" },
        { key: "reglamento", label: "Reglamento", value: "https://portal.farmasalud.lat/reglamento-puntos" },
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: qr, messageEncoding: "iso-8859-1", altText: d.codigo ?? "" }],
    sharingProhibited: true,
  };

  const archivos: Record<string, Uint8Array> = { "pass.json": new TextEncoder().encode(JSON.stringify(pase)) };
  for (const [n, b64] of Object.entries(IMAGENES_PASE)) archivos[n] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  // manifest.json: SHA-1 de cada archivo.
  const manifiesto: Record<string, string> = {};
  for (const [n, bytes] of Object.entries(archivos)) {
    const md = forge.md.sha1.create();
    md.update(aBinario(bytes));
    manifiesto[n] = md.digest().toHex();
  }
  const manifiestoBytes = new TextEncoder().encode(JSON.stringify(manifiesto));
  archivos["manifest.json"] = manifiestoBytes;

  // signature: PKCS#7 separado, con la cadena de Apple.
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(aBinario(manifiestoBytes));
  const cert = forge.pki.certificateFromPem(pem(certB64));
  p7.addCertificate(cert);
  p7.addCertificate(forge.pki.certificateFromPem(pem(wwdrB64)));
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(pem(keyB64)),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  archivos["signature"] = forge.util.binary.raw.decode(der);

  return zipSync(archivos, { level: 6 });
}

// Enlace de descarga: Safari lo abre y ofrece «Agregar a Wallet». Firmado con
// HMAC y válido 10 minutos — no hay tabla, y un enlace viejo o tocado no sirve.
async function hmac(texto: string): Promise<string> {
  const secreto = Deno.env.get("WALLET_TOKEN_SECRET");
  if (!secreto) throw new Error("falta WALLET_TOKEN_SECRET");
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto));
  return btoa(String.fromCharCode(...new Uint8Array(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function enlaceDePase(customerId: number): Promise<string> {
  const vence = Math.floor(Date.now() / 1000) + 600;
  const cuerpo = `${customerId}.${vence}`;
  return `${cuerpo}.${await hmac(cuerpo)}`;
}

export async function clienteDelEnlace(token: string): Promise<number | null> {
  const [id, vence, firma] = String(token ?? "").split(".");
  if (!id || !vence || !firma) return null;
  if (Number(vence) < Date.now() / 1000) return null;
  if ((await hmac(`${id}.${vence}`)) !== firma) return null;
  return Number(id) || null;
}
