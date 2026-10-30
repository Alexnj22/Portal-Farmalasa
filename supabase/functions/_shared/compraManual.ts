// Factura en PAPEL vestida de DTE (2026-10-30).
//
// La Constancia y otros proveedores no mandan documento electrónico: la
// persona escribe el papel en `compra_documento_manual`. Para no tener un
// segundo camino de carga —con su segunda revisión, su segundo armado del sobre
// y su segunda verificación, que se desincronizarían— el papel se traduce a la
// MISMA forma que un DTE de Hacienda, y de ahí en adelante todo es igual.
//
// La traducción respeta la regla del DTE que el armado del sobre ya conoce: en
// factura (01) el precio lleva el IVA adentro; en crédito fiscal (03) no. Es la
// misma regla del papel, así que la persona copia lo que ve.
//
// De cada renglón se copia el IMPORTE (la columna de la línea), no el precio
// unitario: el importe siempre trae centavos y el unitario a veces cuatro
// decimales, que el campo de dinero no admite. El unitario se despeja.

export const TIPO_DTE: Record<string, string> = { COF: "01", CCF: "03", FSE: "14" };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** `{ d, dte }` con la forma de `purchase_dte_documents` y del JSON del DTE. */
export function dteDeManual(m: any) {
  const items = (Array.isArray(m?.renglones) ? m.renglones : []).map((r: any) => {
    const cantidad = Number(r?.cantidad) || 0;
    const monto = r2(Number(r?.importe) || 0);
    const exento = r?.exento === true;
    return {
      codigo: String(r?.codigo ?? "").trim() || null,
      descripcion: String(r?.descripcion ?? "").trim(),
      cantidad, precioUni: cantidad > 0 ? Math.round((monto / cantidad) * 1e6) / 1e6 : 0, montoDescu: 0,
      ventaGravada: exento ? 0 : monto, ventaExenta: exento ? monto : 0, ventaNoSuj: 0,
    };
  });
  const tipoDte = TIPO_DTE[m?.tipo_doc] ?? null;
  const d = {
    id: null, manual_id: m?.id ?? null,
    codigo_generacion: String(m?.numero ?? "").trim(), numero_control: null,
    tipo_dte: tipoDte, emisor_nit: m?.proveedor_nit ?? null, emisor_nombre: m?.proveedor_nombre ?? null,
    fecha_emision: m?.fecha_emision ?? null, json_path: null, pdf_path: null,
    sello_recibido: null, invalidado: false,
  };
  const dte = {
    identificacion: { tipoDte, numeroControl: null },
    cuerpoDocumento: items,
    resumen: {
      totalPagar: Number(m?.total) || null,
      totalGravada: r2(items.reduce((a: number, i: any) => a + i.ventaGravada, 0)),
      totalExenta: r2(items.reduce((a: number, i: any) => a + i.ventaExenta, 0)),
      ivaPerci1: Number(m?.percepcion) || 0,
    },
  };
  return { d, dte };
}

/** Lo que llega del navegador, limpio. Devuelve el error en palabras de sala. */
export function validarManual(x: any): { ok: true; fila: any } | { ok: false; error: string } {
  const tipo = String(x?.tipo_doc ?? "");
  if (!TIPO_DTE[tipo]) return { ok: false, error: "Elige el tipo de documento." };
  const numero = String(x?.numero ?? "").replace(/\s+/g, "").toUpperCase();
  if (!numero) return { ok: false, error: "Falta el número de la factura." };
  if (!/^[A-Z0-9\-\/]+$/.test(numero)) return { ok: false, error: "El número sólo lleva letras, números y guiones." };
  const fecha = String(x?.fecha ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: "Falta la fecha de la factura." };
  const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  if (fecha > hoy) return { ok: false, error: "La fecha de la factura no puede ser de un día que no ha llegado." };
  const total = Number(x?.total);
  if (!(total > 0)) return { ok: false, error: "Falta el total de la factura." };
  const percepcion = Number(x?.percepcion ?? 0);
  if (!(percepcion >= 0)) return { ok: false, error: "La percepción no puede ser negativa." };
  const renglones = (Array.isArray(x?.renglones) ? x.renglones : [])
    .map((r: any) => ({
      codigo: String(r?.codigo ?? "").trim() || null,
      descripcion: String(r?.descripcion ?? "").replace(/\s+/g, " ").trim().toUpperCase(),
      cantidad: Number(r?.cantidad), importe: r2(Number(r?.importe)), exento: r?.exento === true,
    }))
    .filter((r: any) => r.descripcion || r.cantidad || r.importe);
  if (!renglones.length) return { ok: false, error: "La factura no tiene productos." };
  for (const [i, r] of renglones.entries()) {
    if (!r.descripcion) return { ok: false, error: `Al producto ${i + 1} le falta la descripción.` };
    if (!(r.cantidad > 0)) return { ok: false, error: `«${r.descripcion}»: falta la cantidad.` };
    if (!(r.importe >= 0)) return { ok: false, error: `«${r.descripcion}»: falta el importe.` };
  }
  return {
    ok: true,
    fila: {
      tipo_doc: tipo, numero, serie: String(x?.serie ?? "").trim().toUpperCase() || null,
      fecha_emision: fecha, total: r2(total), percepcion: r2(percepcion), renglones,
    },
  };
}
