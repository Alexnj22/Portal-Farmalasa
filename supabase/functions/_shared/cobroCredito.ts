// ═══════════════════════════════════════════════════════════════════════════
// Las decisiones de un cobro de crédito que NO dependen de la red.
//
// Viven aparte de `creditos-erp` para poder probarlas sin tocar el sistema de
// la caja: un abono allá no se deshace, así que la lógica que decide si se
// escribe o no se prueba acá, con datos armados a mano (tests/unit/
// cobroCredito.test.js).
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que el origen dice de un crédito al releerlo. */
export interface CreditoVivo {
  credito: string;
  saldo: number;
  cliente?: string;
  fecha?: string;
  factura_erp?: string | null;
}

/** Un abono tal como lo lista el historial del crédito en el origen. */
export interface AbonoVisto {
  erp_id: string | null;
  fecha: string | null;
  forma: string;
  documento: string | null;
  monto: number;
}

const CENTAVO = 0.004;

/**
 * ¿Cabe cada renglón en el saldo VIVO de su crédito?
 *
 * Es la pregunta que `pagar` ya se hacía y `resolver_otro` no: aprobar un cobro
 * que esperaba firma abonaba el monto GUARDADO, aunque en el medio el crédito
 * se hubiera cobrado en la caja o repartido en otra transferencia. Con el
 * saldo ya en cero, el abono lo dejaba en negativo y el cliente pagaba dos
 * veces — sin forma de deshacerlo allá.
 *
 * No recorta el monto (como hace el pago en línea con `Math.min`): un cobro
 * que se pidió por $35.57 y ya no cabe no es un cobro de menos, es una
 * pregunta para quien firma. Se frena y se dice por qué.
 */
export function revisarContraElSaldoVivo<T extends { credito: string; monto: number }>(
  renglones: T[], vivos: Map<string, CreditoVivo>,
): { aplicables: T[]; frenados: { renglon: T; motivo: string }[] } {
  const aplicables: T[] = [];
  const frenados: { renglon: T; motivo: string }[] = [];
  for (const r of renglones) {
    const vivo = vivos.get(String(r.credito));
    if (!vivo) {
      frenados.push({ renglon: r, motivo: `el crédito ${r.credito} ya no aparece con saldo en la caja` });
      continue;
    }
    if (Number(r.monto) > Number(vivo.saldo) + CENTAVO) {
      frenados.push({
        renglon: r,
        motivo: `el crédito ${r.credito} ahora debe ${Number(vivo.saldo).toFixed(2)} `
          + `y el cobro guardado es de ${Number(r.monto).toFixed(2)}`,
      });
      continue;
    }
    aplicables.push(r);
  }
  return { aplicables, frenados };
}

const normalizarDoc = (s: unknown) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * ¿Ya entró este abono? Sólo se pregunta al RETOMAR un envío que otra
 * ejecución dejó a medias (`creditos_cobro_tomar` → `retomado`): esa ejecución
 * pudo haber abonado antes de morir, y abonar otra vez es cobrar dos veces.
 *
 * Coincide si el monto es el mismo al centavo, la fecha del abono no es
 * anterior al primer intento, la forma es la misma y —si el cobro tiene número
 * de documento— el documento también. Sin documento (efectivo) se acepta por
 * monto, forma y fecha: en el peor caso se da por hecho un abono igual del
 * mismo día, que es quedarse corto (se ve y se corrige) en vez de cobrar dos
 * veces (no se deshace).
 *
 * `usados` evita que dos renglones reclamen el mismo abono.
 */
export function abonoQueYaEntro(
  abonos: AbonoVisto[],
  buscado: { monto: number; forma: string; documento?: string | null; desde: string },
  usados: Set<string> = new Set(),
): AbonoVisto | null {
  const doc = normalizarDoc(buscado.documento);
  for (const a of abonos) {
    if (a.erp_id && usados.has(a.erp_id)) continue;
    if (Math.abs(Number(a.monto) - Number(buscado.monto)) > CENTAVO) continue;
    if (!a.fecha || a.fecha < buscado.desde) continue;
    if (String(a.forma ?? "").toUpperCase() !== String(buscado.forma ?? "").toUpperCase()) continue;
    if (doc && normalizarDoc(a.documento) !== doc) continue;
    return a;
  }
  return null;
}

// ── La firma de la lectura del comprobante (HA5) ─────────────────────────────
//
// `leer-pago-de-credito` decide si el beneficiario del comprobante es la
// empresa (`nombreSinReconocer`), y esa respuesta viaja por el navegador hasta
// `pagar`. Sin firma, editar la petición bastaba para que una transferencia a
// una cuenta personal entrara como cobro aplicado sin pasar por aprobación.
//
// La firma es un HMAC con un secreto que sólo tienen las funciones del
// servidor. Ata el veredicto a QUIÉN leyó y a CUÁNDO: una lectura vieja o de
// otra persona no sirve.

const VERSION_FIRMA = "v1";
/** Una lectura vale seis horas: alcanza para el cliente que espera, no para
 *  guardarla y reusarla otro día. */
export const VIGENCIA_LECTURA_MS = 6 * 3600_000;

export interface FirmaLectura { emitida: number; hmac: string }

function cadenaAFirmar(d: {
  quien: string; forma: string; veredicto: string; nombreSinReconocer: boolean; emitida: number;
}): string {
  return [VERSION_FIRMA, d.quien, d.forma, d.veredicto, d.nombreSinReconocer ? "1" : "0", d.emitida].join("|");
}

async function hmacHex(secreto: string, texto: string): Promise<string> {
  const enc = new TextEncoder();
  const llave = await crypto.subtle.importKey(
    "raw", enc.encode(`firma-lectura-pago|${secreto}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", llave, enc.encode(texto));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function firmarLectura(secreto: string, d: {
  quien: string; forma: string; veredicto: string; nombreSinReconocer: boolean; emitida?: number;
}): Promise<FirmaLectura> {
  const emitida = d.emitida ?? Date.now();
  return { emitida, hmac: await hmacHex(secreto, cadenaAFirmar({ ...d, emitida })) };
}

/**
 * Lo que `pagar` puede CREER de la lectura que le mandó el navegador.
 *   → { valida: true, veredicto, nombreSinReconocer }  la firmó el servidor
 *   → { valida: false, motivo }                         sin firma, vencida,
 *                                                       de otra persona o editada
 */
export async function verificarLectura(
  secreto: string,
  lectura: unknown,
  quien: string,
  formaDelCobro: string,
  ahora = Date.now(),
): Promise<{ valida: true; veredicto: string; nombreSinReconocer: boolean; forma: string }
         | { valida: false; motivo: string }> {
  const l = (lectura ?? null) as Record<string, unknown> | null;
  const f = (l?.firma ?? null) as FirmaLectura | null;
  if (!l || !f || typeof f.hmac !== "string" || !Number.isFinite(Number(f.emitida))) {
    return { valida: false, motivo: "sin_firma" };
  }
  const emitida = Number(f.emitida);
  if (emitida > ahora + 60_000 || ahora - emitida > VIGENCIA_LECTURA_MS) {
    return { valida: false, motivo: "vencida" };
  }
  const datos = {
    quien,
    forma: String(l.forma ?? ""),
    veredicto: String(l.veredicto ?? ""),
    nombreSinReconocer: l.nombreSinReconocer === true,
    emitida,
  };
  const esperada = await hmacHex(secreto, cadenaAFirmar(datos));
  // Comparación de largo fijo: no corta en el primer carácter distinto.
  let dif = esperada.length ^ f.hmac.length;
  for (let i = 0; i < esperada.length; i++) dif |= esperada.charCodeAt(i) ^ (f.hmac.charCodeAt(i) || 0);
  if (dif !== 0) return { valida: false, motivo: "no_coincide" };
  // Una lectura de TARJETA no tiene beneficiario que dudar: reusarla para una
  // transferencia se saltaría la pregunta. La forma tiene que ser la del cobro.
  if (datos.forma.toLowerCase() !== String(formaDelCobro ?? "").toLowerCase()) {
    return { valida: false, motivo: "otra_forma" };
  }
  return { valida: true, veredicto: datos.veredicto, nombreSinReconocer: datos.nombreSinReconocer, forma: datos.forma };
}

/** Las formas que se cobran con un papel leído. «Otro» va siempre a firma y el
 *  efectivo no tiene papel. */
export const FORMAS_CON_PAPEL = ["Transferencia", "Tarjeta", "Cheque"];

/**
 * ¿Este cobro tiene que ir a firma, según el SERVIDOR?
 *
 * La bandera del navegador (`requiereAprobacion`) sólo puede SUMAR: si dice
 * que sí, va. Lo que no puede es restar — la duda sobre el beneficiario sale
 * de la lectura firmada, y una lectura sin firma válida cuenta como duda: el
 * cobro no se pierde, queda esperando a que alguien mire el estado de cuenta.
 */
export function decidirAprobacion(p: {
  forma: string;
  pideElNavegador: boolean;
  lectura: { valida: true; nombreSinReconocer: boolean } | { valida: false; motivo: string };
}): { pide: boolean; porBeneficiario: boolean; porLecturaSinFirma: boolean } {
  if (p.forma === "Efectivo") return { pide: p.pideElNavegador, porBeneficiario: false, porLecturaSinFirma: false };
  const conPapel = FORMAS_CON_PAPEL.includes(p.forma);
  const porLecturaSinFirma = conPapel && !p.lectura.valida;
  const porBeneficiario = conPapel && p.lectura.valida && p.lectura.nombreSinReconocer;
  return {
    pide: p.forma === "Otro" || p.pideElNavegador || porBeneficiario || porLecturaSinFirma,
    porBeneficiario,
    porLecturaSinFirma,
  };
}
