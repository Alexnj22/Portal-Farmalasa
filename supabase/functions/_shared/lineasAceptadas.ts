// Cuánto de lo que se pidió entra de verdad, cuando no entra todo.
//
// Es el contrato de la aprobación parcial, y ya existía —escrito a mano dentro
// de `aplicar-movimiento-inventario`— cuando `aplicar-traslado-inventario` lo
// necesitó para poder despachar 2 de 3. Dos copias de la misma regla es
// exactamente cómo una se arregla y la otra no, así que la regla vive acá.
//
// ⚠️ `aplicar-movimiento-inventario` TODAVÍA tiene la suya, a propósito: no se
// refactoriza una función que mueve inventario real en el mismo cambio que
// estrena otra (es el mismo criterio con el que `erp-traslado.ts` se consolidó
// recién un tiempo después de copiarse). Cuando se la pase a esta, el contrato
// ya está anclado en `tests/unit/lineasAceptadas.test.js`.
//
// **Por qué es un archivo aparte y no vive en `erp-traslado.ts`**: ese archivo
// dice de sí mismo que lo que decide QUÉ trasladar —permisos, cantidades,
// candados— se queda en cada función. Esto es justamente una decisión de
// cantidad, así que respetar ese límite es tenerla en su propio lugar.

/** Un renglón que entra, y con cuánto. `i` es su posición en `metadata.items`. */
export interface Aceptada {
  i: number;
  cantidad: number;
}

/**
 * Qué renglones entran y con qué cantidad.
 *
 * **El cliente manda ÍNDICES con su cantidad, nunca los renglones.** La
 * diferencia no es de estilo: con los renglones, el navegador elegiría qué
 * producto se mueve, y quien llama a esto tiene credenciales para mover
 * inventario de cualquier sala. Con índices, lo único que puede hacer es
 * señalar cuáles de los que YA se guardaron entran, y bajarles la cantidad.
 *
 * **Bajarla, nunca subirla.** Despachar más de lo que alguien pidió no es
 * despachar: es otra solicitud, sin el motivo ni la firma de quien la habría
 * pedido. El tope es siempre lo pedido y se aplica ACÁ — la pantalla también lo
 * topa, pero la pantalla es una sugerencia.
 *
 * Índices repetidos, fuera de rango o no enteros se descartan en silencio; lo
 * que no se puede es quedarse sin ninguno, porque «aprobar cero renglones» no
 * es aprobar — es rechazar con otro nombre, y el rechazo tiene su propio camino
 * con su motivo obligatorio.
 *
 * Se acepta la forma vieja —un array de índices a secas— además de la nueva
 * (`{i, cantidad}`): son dos versiones del mismo cliente y durante un despliegue
 * conviven.
 *
 * Sin `crudas` (o con cualquier cosa que no sea un array) entra TODO lo pedido,
 * que es como funcionó siempre.
 *
 * @param pedidas Los renglones tal como se guardaron. No se modifican.
 * @param crudas  Lo que mandó el cliente, sin validar.
 * @param queNoEntraNada El mensaje de cuando no queda ningún renglón. Lo pone
 *                       quien llama porque en traslados se «despacha» y en
 *                       carga/descarte se «aplica», y el portal habla del
 *                       negocio, no de la función.
 */
export function elegirLineasAceptadas(
  pedidas: { cantidad: number }[],
  crudas: unknown,
  queNoEntraNada: string,
): { aceptadas: Aceptada[]; error: string | null } {
  if (!Array.isArray(crudas))
    return {
      aceptadas: pedidas.map((l, i) => ({ i, cantidad: Number(l.cantidad) || 0 })),
      error: null,
    };

  const vistos = new Set<number>();
  const aceptadas: Aceptada[] = [];

  for (const bruto of crudas) {
    const i = typeof bruto === "number" ? bruto : Number((bruto as { i?: unknown })?.i);
    if (!Number.isInteger(i) || i < 0 || i >= pedidas.length || vistos.has(i)) continue;
    vistos.add(i);

    const pedida = Number(pedidas[i].cantidad) || 0;
    const dicha = typeof bruto === "number" ? pedida : Number((bruto as { cantidad?: unknown })?.cantidad);
    // `Number.isFinite` y no `||`: un `0` es una decisión —«este renglón no
    // entra»— y con `||` se leería como «no dijo nada» y entraría entero.
    const cantidad = Number.isFinite(dicha) ? Math.min(pedida, Math.max(0, dicha)) : pedida;
    if (cantidad <= 0) continue;   // cantidad cero = el renglón no entra
    aceptadas.push({ i, cantidad });
  }

  aceptadas.sort((a, b) => a.i - b.i);

  return aceptadas.length === 0
    ? { aceptadas, error: queNoEntraNada }
    : { aceptadas, error: null };
}

/**
 * Lo que quedó afuera y lo que entró con menos, mirando lo pedido contra lo
 * aceptado.
 *
 * Se calcula acá y no en quien llama para que las dos listas se armen SIEMPRE
 * con el mismo criterio: un renglón está «ajustado» si entró con una cantidad
 * distinta de la pedida, y está «fuera» si no entró. Armadas por separado, un
 * renglón puede terminar en las dos o en ninguna.
 */
export function loQueNoEntro(
  pedidas: { cantidad: number }[],
  aceptadas: Aceptada[],
): { ajustados: Aceptada[]; fuera: number[]; parcial: boolean } {
  const entran = new Set(aceptadas.map((a) => a.i));
  const ajustados = aceptadas.filter((a) => a.cantidad !== (Number(pedidas[a.i].cantidad) || 0));
  const fuera = pedidas.map((_, i) => i).filter((i) => !entran.has(i));
  return { ajustados, fuera, parcial: fuera.length > 0 || ajustados.length > 0 };
}
