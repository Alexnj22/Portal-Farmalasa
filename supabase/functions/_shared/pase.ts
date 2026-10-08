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
// nombre. Se ACTUALIZA SOLA: `wallet-pases` es el servicio web de PassKit.
import forge from "npm:node-forge@1.3.1";
import { zipSync } from "npm:fflate@0.8.2";
import { FRANJAS_NIVEL, IMAGENES_PASE } from "./imagenesPase.ts";
import { nivelDeCliente } from "./nivel.ts";

const PASS_TYPE = "pass.lat.farmasalud.puntos";
const EQUIPO = "ZZWA3Q7Q35";

export interface DatosPase {
  customerId: number;
  nombre: string;
  saldo: number;
  equivale: number;
  codigo: string | null;
  socioDesde: string | null;
  /** «Cliente VIP», «Plata», «Oro» o «Platino». */
  nivel?: string;
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

export const TIPO_PASE = PASS_TYPE;
export const serialDe = (customerId: number) => `socio-${customerId}`;
export const clienteDelSerial = (serial: string) => Number(String(serial).replace(/^socio-/, "")) || null;

/** El rótulo sobre el nombre: «CLIENTE VIP», «CLIENTE ORO»… */
// Colores de la tarjeta por nivel (2026-10-08): el fondo continúa la franja de
// ese nivel (scripts/wallet/imagenes.py, TEMAS) y los rótulos van en su acento.
const NIVELES: Record<string, { fondo: string; rotulo: string }> = {
  vip: { fondo: "rgb(52, 14, 66)", rotulo: "rgb(180, 228, 80)" },
  plata: { fondo: "rgb(58, 64, 74)", rotulo: "rgb(220, 226, 234)" },
  oro: { fondo: "rgb(74, 46, 6)", rotulo: "rgb(255, 217, 120)" },
  platino: { fondo: "rgb(10, 11, 14)", rotulo: "rgb(232, 236, 242)" },
};
const claveDeNivel = (n?: string) => /platino/i.test(n ?? "") ? "platino" : /oro/i.test(n ?? "") ? "oro" : /plata/i.test(n ?? "") ? "plata" : "vip";

const nivelRotulo = (n?: string) => (!n || /vip/i.test(n) ? "CLIENTE VIP" : `CLIENTE ${n.toUpperCase()}`);

export async function armarPase(d: DatosPase): Promise<Uint8Array> {
  const certB64 = Deno.env.get("WALLET_CERT_B64"), keyB64 = Deno.env.get("WALLET_KEY_B64"), wwdrB64 = Deno.env.get("WALLET_WWDR_B64");
  if (!certB64 || !keyB64 || !wwdrB64) throw new Error("faltan los certificados de Wallet");

  const qr = d.codigo ? `https://portal.farmasalud.lat/mis-puntos?codigo=${d.codigo}` : "https://portal.farmasalud.lat/mis-puntos";
  const pase = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE,
    teamIdentifier: EQUIPO,
    serialNumber: serialDe(d.customerId),
    // Servicio web de PassKit (`wallet-pases`): el iPhone se registra al
    // agregarla y baja la versión nueva cuando cambian los puntos.
    webServiceURL: `${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet-pases`,
    authenticationToken: await tokenDePase(serialDe(d.customerId)),
    organizationName: "Farmacia Salud",
    description: "Tarjeta Cliente VIP · Puntos Salud",
    logoText: "Puntos Salud",
    // El fondo continúa el tono oscuro de la franja (scripts/wallet/imagenes.py),
    // y los rótulos van en el verde del logo: así la franja y el cuerpo se leen
    // como UNA tarjeta y no como un rectángulo pegado sobre otro.
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: NIVELES[claveDeNivel(d.nivel)].rotulo,
    backgroundColor: NIVELES[claveDeNivel(d.nivel)].fondo,
    storeCard: {
      headerFields: [{ key: "puntos", label: "PUNTOS", value: Math.round(d.saldo), textAlignment: "PKTextAlignmentRight" }],
      primaryFields: [{ key: "saldo", label: "SALDO DE PUNTOS", value: d.equivale, currencyCode: "USD",
        // Lo que dice la pantalla bloqueada cuando la tarjeta se actualiza.
        changeMessage: "Tu saldo de Puntos Salud ahora es %@" }],
      secondaryFields: [
        // El nivel al frente (Plata, Oro, Platino); el de entrada se llama «Cliente VIP».
        { key: "nombre", label: nivelRotulo(d.nivel), value: corto(d.nombre) },
        { key: "desde", label: "CLIENTE DESDE", value: desde(d.socioDesde), textAlignment: "PKTextAlignmentRight" },
      ],
      backFields: [
        { key: "como", label: "Cómo se usa", value: "Muestra el código en caja: acumulas en cada compra y canjeas desde 100 puntos ($1)." },
        { key: "foto", label: "Saldo", value: "Se actualiza solo cada vez que ganas o usas puntos." },
        { key: "codigo", label: "Tu código", value: d.codigo ?? "—" },
        { key: "reglamento", label: "Reglamento", value: "https://portal.farmasalud.lat/reglamento-puntos" },
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: qr, messageEncoding: "iso-8859-1", altText: d.codigo ?? "" }],
    sharingProhibited: true,
  };

  const archivos: Record<string, Uint8Array> = { "pass.json": new TextEncoder().encode(JSON.stringify(pase)) };
  for (const [n, b64] of Object.entries(IMAGENES_PASE)) archivos[n] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // La franja del nivel reemplaza a la morada (sin @1x: Wallet usa @2x/@3x).
  const clave = claveDeNivel(d.nivel);
  if (clave !== "vip") {
    delete archivos["strip.png"];
    for (const n of ["strip@2x.png", "strip@3x.png"]) {
      const b64 = FRANJAS_NIVEL[`${clave}|${n}`];
      if (b64) archivos[n] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    }
  }

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

/** El token con que el iPhone se presenta ante `wallet-pases` («ApplePass …»). Sin tabla: se deriva del serial. */
export async function tokenDePase(serial: string): Promise<string> {
  return await hmac(`pase:${serial}`);
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

/** La tarjeta de una ficha, leyendo sus datos (la usan `app-clientes` y `wallet-pases`). */
// deno-lint-ignore no-explicit-any
// `nivelDePrueba`: sólo para la cuenta de prueba (modo de prueba de la app), que
// pide ver la tarjeta con otro nivel. Nunca para un cliente real.
export async function paseDeCliente(admin: any, id: number, nivelDePrueba?: string): Promise<{ pase: Uint8Array; cambio: string | null }> {
  const [{ data: c, error: eC }, { data: est, error: eE }, { data: cod, error: eK }, { data: pri, error: eP }, { data: cta, error: eT }] = await Promise.all([
    admin.from("customers").select("name").eq("id", id).maybeSingle(),
    admin.rpc("puntos_estado_cuenta", { p_customer_id: id }),
    admin.from("puntos_codigo_acceso").select("codigo").eq("customer_id", id).maybeSingle(),
    admin.from("puntos_lote").select("ganado_el").eq("customer_id", id).order("ganado_el", { ascending: true }).limit(1).maybeSingle(),
    admin.from("puntos_cuenta").select("updated_at").eq("customer_id", id).maybeSingle(),
  ]);
  const nivel = await nivelDeCliente(admin, id);
  if (eC) throw eC; if (eE) throw eE; if (eK) throw eK; if (eP) throw eP; if (eT) throw eT;
  const saldo = Number(est?.saldo ?? 0);
  const pase = await armarPase({
    customerId: id, nombre: c?.name ?? "", saldo, equivale: Math.round(saldo) / 100,
    codigo: cod?.codigo ?? null, socioDesde: pri?.ganado_el ?? null, nivel: nivelDePrueba ?? nivel.nombre,
  });
  return { pase, cambio: cta?.updated_at ?? null };
}
