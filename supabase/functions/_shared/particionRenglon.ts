// Partir un renglón de la factura en varios productos (2026-11-09).
//
// Diszasa factura «PACK OFF FAMILY 60 OZ + OFF SPRAY 177ML» en UN renglón y
// son DOS productos del inventario; «2 PACK OFF CREMA» es uno que se separa.
// La regla se aprende por (proveedor, su código) en `compra_renglon_particion`.
//
// El renglón se convierte en varios ANTES de armar nada, y esto lo corren las
// dos funciones que leen la factura: `leer-dte-json` (lo que se ve) y
// `cargar-compra-erp` (lo que se manda). Las decisiones de la pantalla viajan
// POR POSICIÓN, así que las dos tienen que ver exactamente la misma lista: de
// ahí la `firma`, que `cargar-compra-erp` compara antes de armar.

import { nombreLimpio } from "./loteVencimiento.ts";

export type ParteRegla = { product_id: number; unidades: number; porcentaje: number };
export type ReglaParticion = { llave: string; document_id: number | null; partes: ParteRegla[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** La de ESTA factura le gana a la que se recuerda; sin partes = se deja entero. */
export function reglaQueManda(reglas: ReglaParticion[], llave: string, documentId: number | null): ReglaParticion | null {
  const deLlave = reglas.filter((r) => r.llave === llave);
  return (documentId != null ? deLlave.find((r) => r.document_id === documentId) : null)
    ?? deLlave.find((r) => r.document_id == null) ?? null;
}

/** Reparte un monto en centavos; el último se queda con el redondeo, para que
 *  la suma sea exactamente lo que cobró el proveedor. */
function repartirCentavos(monto: number, partes: ParteRegla[]): number[] {
  let queda = r2(monto);
  return partes.map((p, k) => {
    if (k === partes.length - 1) return r2(queda);
    const v = r2(monto * p.porcentaje / 100);
    queda = r2(queda - v);
    return v;
  });
}

export function partirRenglon(it: any, partes: ParteRegla[], llave: string): any[] {
  const cant = Number(it?.cantidad);
  const reparto = (campo: string) => repartirCentavos(Number(it?.[campo] ?? 0), partes);
  const gravada = reparto("ventaGravada"), exenta = reparto("ventaExenta"), noSuj = reparto("ventaNoSuj");
  const descu = reparto("montoDescu"), iva = reparto("ivaItem");
  return partes.map((p, k) => ({
    ...it,
    cantidad: r6(cant * p.unidades),
    precioUni: r6(Number(it?.precioUni ?? 0) * (p.porcentaje / 100) / p.unidades),
    ventaGravada: gravada[k], ventaExenta: exenta[k], ventaNoSuj: noSuj[k],
    montoDescu: descu[k], ivaItem: iva[k],
    _parte: { product_id: p.product_id, unidades: p.unidades, porcentaje: p.porcentaje, indice: k + 1, total: partes.length, llave, cantidad_factura: cant },
  }));
}

/** Pura: `llaves[i]` es la llave del diccionario del renglón i. */
export function expandirRenglones(
  items: any[], llaves: (string | null)[], reglas: ReglaParticion[], documentId: number | null,
): { items: any[]; firma: string } {
  const salida: any[] = [];
  const aplicadas: string[] = [];
  items.forEach((it, i) => {
    const llave = llaves[i];
    const regla = llave ? reglaQueManda(reglas, llave, documentId) : null;
    if (!regla?.partes?.length || !(Number(it?.cantidad) > 0)) { salida.push(it); return; }
    salida.push(...partirRenglon(it, regla.partes, llave!));
    aplicadas.push(`${i}:${llave}:${regla.partes.map((p) => `${p.product_id}x${p.unidades}@${p.porcentaje}`).join(",")}`);
  });
  return { items: salida, firma: aplicadas.join(";") };
}

/** Lee las reglas del proveedor y expande. Sin reglas, devuelve lo mismo. */
export async function aplicarParticiones(
  admin: any, items: any[], emisorNit: string, documentId: number | null,
): Promise<{ items: any[]; firma: string }> {
  const { data, error } = await admin.from("compra_renglon_particion")
    .select("llave, document_id, partes").eq("emisor_nit", emisorNit);
  if (error) throw error;
  const reglas = (data ?? []) as ReglaParticion[];
  if (!reglas.length) return { items, firma: "" };
  const hayPorNombre = reglas.some((r) => r.llave.startsWith("#"));
  const llaves = await Promise.all(items.map(async (it) => {
    const codigo = String(it?.codigo ?? "").trim();
    if (codigo) return codigo;
    if (!hayPorNombre) return null;
    const { data: k, error: e } = await admin.rpc("compra_llave_de_renglon", {
      p_codigo: null, p_texto: nombreLimpio(String(it?.descripcion ?? "")),
    });
    if (e) throw e;
    return (k ?? null) as string | null;
  }));
  return expandirRenglones(items, llaves, reglas, documentId);
}
