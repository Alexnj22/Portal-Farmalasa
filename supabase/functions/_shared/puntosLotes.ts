/**
 * Los puntos no son un saldo: son grupos con fecha.
 *
 * ── Por qué hace falta reconstruirlos ───────────────────────────────────────
 * El sistema de puntos guarda UN número por cliente (`Clientes.Puntos`) y nada
 * más. Para que un punto pueda vencer hay que saber CUÁNDO se ganó, y eso no
 * está en ninguna columna — pero sí está en el historial: `Ventas` tiene una
 * fila fechada por cada acumulación y `Canjes` una por cada gasto.
 *
 * Así que los grupos no se guardan, se DERIVAN. La ventaja es que no hay una
 * segunda verdad que se pueda desincronizar del saldo; la condición es que la
 * derivación tiene que dar exactamente el saldo, y por eso quien la usa la
 * compara (`descuadre`) en vez de confiar.
 *
 * ── El más viejo se gasta primero ───────────────────────────────────────────
 * Es la regla que le conviene al cliente: vence lo menos posible. El sistema de
 * allá no la conoce —sólo resta del total— así que acá no se está leyendo una
 * decisión suya, se está imponiendo una nuestra sobre su historial. Da el mismo
 * total y reparte las fechas de la forma más favorable.
 *
 * ── La fecha de arranque no es la de la compra ──────────────────────────────
 * Un punto ganado en 2024 no puede vencer el día que el programa empieza: nadie
 * le avisó. Por eso la vida de un grupo se cuenta desde `INICIO_PROGRAMA` o
 * desde su propia fecha, la que sea MÁS TARDE. Consecuencia buscada: el primer
 * vencimiento posible del programa entero es INICIO_PROGRAMA + 12 meses, y
 * hasta ese día encender esto no le quita un punto a nadie.
 */

/** Desde cuándo corre el reloj para los puntos que ya existían. */
export const INICIO_PROGRAMA = "2026-10-01";

/** Cuánto vive un grupo de puntos. */
export const MESES_DE_VIDA = 12;

export type Lote = {
  /** Cuándo se ganaron, AAAA-MM-DD. */
  fecha: string;
  puntos: number;
  /** Último día en que sirven — ese día TODAVÍA sirven. AAAA-MM-DD. */
  vence: string;
};

/**
 * Suma meses a una fecha AAAA-MM-DD sin pasar por `Date`.
 *
 * A propósito: `new Date('2026-10-01')` se interpreta como UTC y en cualquier
 * huso al oeste vuelve como 30 de septiembre. Acá una fecha de vencimiento que
 * retrocede un día es un punto que muere antes de tiempo, y nadie lo notaría.
 *
 * El 29 de febrero se recorta al 28: sumar 12 meses tiene que caer en el mismo
 * día del año siguiente y ese día no existe.
 */
export function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.slice(0, 10).split("-").map(Number);
  const total = (m - 1) + meses;
  const anio = a + Math.floor(total / 12);
  // `%` en JavaScript conserva el signo, así que con meses negativos —restar
  // doce para saber el corte— daría un mes negativo y una fecha imposible. El
  // doble módulo lo trae al rango, y el `floor` de arriba ya bajó el año.
  const mes = ((total % 12) + 12) % 12 + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Cuándo vence un grupo ganado en `fecha`. */
export function venceEl(fecha: string): string {
  const arranca = fecha.slice(0, 10) > INICIO_PROGRAMA ? fecha.slice(0, 10) : INICIO_PROGRAMA;
  return sumarMeses(arranca, MESES_DE_VIDA);
}

/**
 * Los grupos vivos de UN cliente, con su fecha de vencimiento.
 *
 * `filas` son las acumulaciones que sobrevivieron al gasto, ya calculadas por
 * la base (ver SQL_LOTES_VIVOS): la resta FIFO se hace allá con una suma
 * corrida porque hacerla acá obligaría a bajarse el historial completo.
 */
export function lotesConVencimiento(
  filas: Array<{ fecha: string; quedan: number | string }>,
): Lote[] {
  return filas
    .map((f) => ({
      fecha: String(f.fecha).slice(0, 10),
      puntos: Number(f.quedan),
      vence: venceEl(String(f.fecha)),
    }))
    .filter((l) => l.puntos > 0);
}

/**
 * Junta los grupos por fecha de vencimiento.
 *
 * Un cliente con doscientas compras tiene doscientos grupos, y una lista de
 * doscientas líneas no le dice nada. Lo que le sirve es «tanto vence tal día».
 */
export function porVencimiento(lotes: Lote[]): Array<{ vence: string; puntos: number }> {
  const m = new Map<string, number>();
  for (const l of lotes) m.set(l.vence, (m.get(l.vence) ?? 0) + l.puntos);
  return [...m.entries()]
    .map(([vence, puntos]) => ({ vence, puntos }))
    .sort((x, y) => (x.vence < y.vence ? -1 : 1));
}

/**
 * ¿Este grupo ya no sirve al día `hoy`?
 *
 * **La única definición de «vencido» que existe.** Estuvo escrita dos veces con
 * un día de diferencia —una tomaba `vence` como el último día bueno y la otra
 * como el primero malo— y la estricta era la que iba a correr contra la gente:
 * a todos se les habrían muerto los puntos un día antes de lo que decía su
 * pantalla, sin ningún error de por medio.
 *
 * `vence` es el ÚLTIMO día en que sirven, y ese día todavía sirven. Se elige así
 * porque es lo que entiende cualquiera que lea «vence el 10/01» en la pantalla,
 * y porque ante la duda el día de más es del cliente.
 */
export function estaVencido(lote: Lote, hoy: string): boolean {
  return lote.vence < hoy.slice(0, 10);
}

/** Los grupos que ya no sirven al día `hoy` (AAAA-MM-DD). */
export function vencidosAl(lotes: Lote[], hoy: string): Lote[] {
  return lotes.filter((l) => estaVencido(l, hoy));
}

/**
 * La reconstrucción FIFO, en la base.
 *
 * `acumulado` es la suma corrida de lo ganado hasta ese grupo inclusive. Si esa
 * suma todavía no supera lo gastado, el grupo se consumió entero y no aparece;
 * el primero que la supera aparece con el resto (`acumulado - gastado`, que es
 * menos que sus puntos) y los siguientes, enteros. Eso ES gastar el más viejo
 * primero, escrito sin recorrer fila por fila.
 *
 * Un parámetro `?` para el idCliente en cada CTE.
 */
export const SQL_LOTES_VIVOS = `
  WITH canj AS (
    SELECT COALESCE(SUM(PuntosCanjeados), 0) AS gastado
      FROM Canjes WHERE idCliente = ?
  ),
  acum AS (
    SELECT DATE_FORMAT(v.Fecha_ingreso, '%Y-%m-%d') AS fecha,
           v.PuntosVenta AS puntos,
           SUM(v.PuntosVenta) OVER (ORDER BY v.Fecha_ingreso, v.idVenta
                                    ROWS UNBOUNDED PRECEDING) AS acumulado
      FROM Ventas v WHERE v.idCliente = ?
  )
  SELECT a.fecha,
         LEAST(a.puntos, a.acumulado - c.gastado) AS quedan
    FROM acum a CROSS JOIN canj c
   WHERE a.acumulado - c.gastado > 0
   ORDER BY a.fecha
`;
