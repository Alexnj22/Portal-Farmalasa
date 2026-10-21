/* La boleta que en realidad es la REFERENCIA del POS Promerica.
 *
 * El prompt ya lo advierte (`boletaPrompt.ts`, «boletas a DOS COLUMNAS») y el
 * lector igual se equivoca: medido el 2026-10-21, 5 de 40 boletas Promerica de
 * dos días guardaron `numero_boleta = 102107425217` en vez de `000088`. Pedirlo
 * mejor no lo arregla; reconocerlo en código sí, porque la referencia tiene una
 * forma que una boleta nunca tiene:
 *
 *   102107425217  =  10-21 · 07:42:52 · 17
 *                    MMDD    HHMMSS     2 dígitos
 *
 * Y el lector SÍ ve la boleta: en `numeros_del_papel` sale siempre en el
 * renglón siguiente a la referencia (`…, "102107425217", "000088", …`), que es
 * el orden en que el papel los imprime — REFERENCIA arriba, BOLETA abajo.
 *
 * Si no hay un número corto justo después, se devuelve null: un campo vacío se
 * llena a mano; uno con el número equivocado se guarda sin que nadie lo mire.
 */

const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D+/g, '')

/** MMDD HHMMSS + 2: la referencia que imprime el POS Promerica. */
const REFERENCIA_POS = /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])[0-5]\d[0-5]\d\d{2}$/

export const pareceReferenciaDelPos = (v: unknown) => REFERENCIA_POS.test(soloDigitos(v))

/**
 * Devuelve el `numero_boleta` corregido: el mismo si no parece la referencia;
 * el número corto que le sigue en el papel si lo parece; o null si no hay uno.
 */
export function boletaSinReferencia(numeroBoleta: unknown, numerosDelPapel: unknown): string | null {
  if (numeroBoleta == null || numeroBoleta === '') return null
  if (!pareceReferenciaDelPos(numeroBoleta)) return String(numeroBoleta)
  const ref = soloDigitos(numeroBoleta)
  const lista = (Array.isArray(numerosDelPapel) ? numerosDelPapel : []).map(soloDigitos)
  const i = lista.indexOf(ref)
  const siguiente = i >= 0 ? lista[i + 1] : undefined
  return siguiente && siguiente.length >= 3 && siguiente.length <= 8 ? siguiente : null
}
