// ════════════════════════════════════════════════════════════════════════════
// ¿El nombre impreso en un comprobante es el titular de las cuentas?
//
// Vive aparte de `leer-pago-de-credito` por dos motivos. Lo que decide es si un
// pago se acepta o se rechaza con el cliente enfrente, así que se prueba
// (`tests/unit/titularDelComprobante.test.js`) — y desde `index.ts` no se
// podría, porque importarlo levanta su `Deno.serve`.
// ════════════════════════════════════════════════════════════════════════════

/** A nombre de quién tienen que estar las cuentas y los cheques. Es
 *  `EMPRESA.patrono` de `src/constants/empresa.js` — el nombre LEGAL, no el
 *  comercial «José Alemán V.».
 *  ⚠️ Las dos copias son la misma y se mueven juntas. */
export const TITULAR = "JOSÉ RUTILIO ALEMÁN VÁSQUEZ"

const PARTES = ["JOSE", "RUTILIO", "ALEMAN", "VASQUEZ"]
const APELLIDOS = ["ALEMAN", "VASQUEZ"]

/** Sin acentos, sin puntos, en mayúsculas y con un solo espacio. Un nombre
 *  impreso viene de mil formas y comparar cadenas crudas rechaza las buenas. */
export const norm = (v: unknown) => String(v ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()

/* ── Por qué se compara por PREFIJO y no por igualdad ──────────────────────
 *
 * El comprobante que trajo esta regla —una nota de cargo de Bancoagrícola del
 * 2026-09-02— imprime el destino como «Transfer365 JOSE RUTILIO ALEMA»: el
 * banco corta el nombre a un largo fijo y ALEMÁN pierde la N. Comparando
 * palabras enteras ese pago quedaba rechazado como «de otro beneficiario»
 * siendo nuestro, y el cliente se iba sin poder abonar.
 *
 * Cuatro letras y no tres: con tres, «JOSEFA» pasaría por «JOSE». */
const esParte = (palabra: string, parte: string) =>
  palabra === parte || (palabra.length >= 4 && parte.startsWith(palabra))

/**
 * ¿Este nombre es el titular, «más o menos»?
 *
 * El usuario lo pidió así —«que sea Jose Rutilio Aleman Vasquez (o más o menos
 * el nombre así)»— y tiene razón: un comprobante bancario recorta, abrevia e
 * invierte («ALEMAN VASQUEZ JOSE R», «J RUTILIO ALEMAN V»). Exigir la cadena
 * exacta rechazaría pagos buenos con el cliente enfrente.
 *
 * La regla: **al menos un apellido** —ALEMAN o VASQUEZ, que es lo que
 * identifica— y `minimo` de las cuatro palabras del nombre. Con dos, «JOSE
 * MARTINEZ» no pasa y «ALEMAN VASQUEZ J» sí.
 */
export function esElTitular(nombre: unknown, minimo = 2): boolean {
  const t = norm(nombre)
  if (!t) return false
  const palabras = t.split(" ")
  const tiene = (parte: string) => palabras.some((p) => esParte(p, parte))
  if (!APELLIDOS.some(tiene)) return false
  return PARTES.filter(tiene).length >= minimo
}

/**
 * ¿El titular está NOMBRADO en el papel, aunque no en la casilla del que
 * recibe?
 *
 * Existe porque el rótulo del que recibe no es uno solo. En una **nota de
 * cargo** —el comprobante que emite el banco de quien PAGA— la cuenta que
 * encabeza el papel es la que se debitó, así que «A nombre de» es el ORDENANTE
 * y el que recibe va pegado al tipo de transacción («Transfer365 JOSE RUTILIO
 * ALEMA»). Leerlo al revés invierte la operación, y ahí el freno de
 * «beneficiario ajeno» rechaza un pago que sí entró.
 *
 * Se pide MÁS parecido que en la casilla del beneficiario —tres de las cuatro
 * palabras y no dos— justamente porque acá no hay rótulo que respalde: sin
 * esto, un cliente apellidado Vásquez satisfaría la condición por su nombre.
 * Y no declara el pago bueno: **baja el freno a un aviso**, que es quien tiene
 * que hablar cuando no se pudo decir en qué dirección fue el dinero.
 */
export function elTitularEstaEnElPapel(nombres: unknown[]): boolean {
  return (nombres ?? []).some((n) => esElTitular(n, 3))
}
