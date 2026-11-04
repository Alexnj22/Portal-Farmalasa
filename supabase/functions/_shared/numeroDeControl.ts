/**
 * ¿El número con que Bodega registró una compra a mano dice que es ESTE DTE?
 *
 * Una compra cargada a mano lleva en `documento_numero` lo que la persona
 * tecleó, recortado a 20 caracteres. Dos formas aparecen:
 *
 * 1. **El número de control entero, recortado.** `DTE-03-M001P001-000000000020680`
 *    queda `DTE-03-M001P001-0000`. Cuando el recorte cae ANTES de la primera
 *    cifra significativa del correlativo, lo que queda es igual en TODAS las
 *    facturas del emisor: el 2026-11-03 una factura de COFARSAL por $184.68
 *    (un pedido que se repite cada mes) se dio por registrada en **14** compras
 *    desde 2025. Ese recorte no identifica: devuelve `"prefijo"`, y quien
 *    llama lo acepta sólo si la compra cae cerca de la fecha del DTE
 *    (`fechaCercana`). Descartarlo del todo dejaba pasar una real: la de
 *    $565.94 del 24-oct estaba cargada así (compra 6391, del 26-oct).
 * 2. **El correlativo solo**, sin ceros a la izquierda: `20680`. Así estaba
 *    cargada de verdad (compra 6482) y la regla vieja no la veía.
 *
 * Puro y sin red: lo usa `cargar-compra-erp` y lo prueba
 * `tests/unit/numeroDeControl.test.js`.
 */
const norm = (s: string) => s.replace(/\s/g, "").replace(/\./g, "").replace(/O/gi, "0").toUpperCase();

export function coincideConControl(numeroControl: string, documentoNumero: string): "control" | "correlativo" | "prefijo" | null {
  const control = norm(String(numeroControl ?? ""));
  const doc = norm(String(documentoNumero ?? ""));
  if (!control || !doc) return null;
  const corte = control.lastIndexOf("-");
  const segmento = corte >= 0 ? control.slice(corte + 1) : control;
  const correlativo = segmento.replace(/^0+/, "");
  if (correlativo && (doc === correlativo || doc === segmento)) return "correlativo";
  if (doc.length >= 15 && control.startsWith(doc)) {
    // La parte del correlativo que alcanzó a entrar en el recorte tiene que
    // tener alguna cifra que no sea cero; si no, es el prefijo común del emisor.
    const delSegmento = corte >= 0 && doc.length > corte + 1 ? doc.slice(corte + 1) : "";
    return /[1-9]/.test(delSegmento) ? "control" : "prefijo";
  }
  return null;
}

/** La compra se registró entre 3 días antes y 30 después de la emisión. */
export function fechaCercana(emision: string, compra: string): boolean {
  const e = Date.parse(String(emision).slice(0, 10)), c = Date.parse(String(compra).slice(0, 10));
  if (!Number.isFinite(e) || !Number.isFinite(c)) return false;
  const dias = (c - e) / 86_400_000;
  return dias >= -3 && dias <= 30;
}
