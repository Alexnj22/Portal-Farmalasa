// Comparación de las líneas del CSV del portal contra las del archivo del ERP.
//
// Vive acá y no dentro de `verificar-csv-libros` por una razón concreta: es la
// pieza que falló. El modo conjunto miraba en una sola dirección —comprobaba
// que cada línea del ERP existiera en el portal y nunca lo inverso— así que un
// libro inflado pasaba con veredicto IDENTICO (H10). Ese es exactamente el modo
// de fallo de un `supplier_id` duplicado (H1): 503 líneas contra 389, y las 389
// se encuentran igual.
//
// Separada, se puede probar con datos armados a mano —incluido el caso de 503
// contra 389, que en producción ya no se puede reproducir porque el índice
// único de A1 lo impide— y el test queda como candado permanente.
// Ver tests/unit/compararLibros.test.js.

/**
 * Normaliza para comparar: el origen mezcla `1166` y `1166.00` en la misma
 * columna del mismo archivo (H21). Como número son el mismo valor, así que para
 * el veredicto se normaliza; lo que NO se hace es esconderlas — se cuentan
 * aparte en `formato_decimal`.
 */
export function normalizar(linea: string): string {
  return linea.split(';').map(c => {
    const t = c.trim();
    if (/^-?\d+(\.\d+)?$/.test(t) && t !== '') {
      const n = Number(t);
      if (Number.isFinite(n)) return n.toFixed(4);
    }
    return t;
  }).join(';');
}

/** La misma línea sin normalizar decimales: separa formato de contenido. */
export function crudo(linea: string): string {
  return linea.split(';').map(c => c.trim()).join(';');
}

/**
 * Las dos claves para comparar contra el archivo del origen cuando las formas
 * ya NO coinciden.
 *
 * Desde el 2026-08-11 los anexos de ventas del portal siguen el formato que
 * pide Hacienda (23 y 20 columnas) y el archivo del origen se quedó en el suyo
 * (22 y 19). Si se comparan por índice, la columna 13 de uno es "gravadas" y la
 * del otro es un relleno, así que **todo** sale distinto y el verificador queda
 * rojo para siempre — o sea, deja de servir justo cuando más se lo necesita.
 *
 * `mapa[i]` dice en qué columna del origen vive nuestra columna `i`, o `null`
 * si allá no existe. `divergentes` son las que existen en los dos lados con un
 * valor distinto **a propósito**, con su motivo escrito en `anexo-spec.json`.
 *
 * Lo que queda comparado es todo lo demás, que es donde vive el error de verdad:
 * los montos y la identidad del documento. Las columnas del origen que no
 * aparecen en el mapa no se comparan porque no tienen contraparte — y eso se
 * dice, no se esconde.
 */
export function clavesPorMapa(
  mapa: (number | null)[],
  divergentes: Set<number>,
): { portal: (l: string) => string; origen: (l: string) => string; comparadas: number } {
  const nuestras = mapa
    .map((destino, i) => ({ destino, i }))
    .filter(({ destino, i }) => destino !== null && !divergentes.has(i));

  return {
    portal: (l: string) => {
      const c = l.split(';');
      return nuestras.map(({ i }) => normalizar(c[i] ?? '')).join(';');
    },
    origen: (l: string) => {
      const c = l.split(';');
      return nuestras.map(({ destino }) => normalizar(c[destino as number] ?? '')).join(';');
    },
    comparadas: nuestras.length,
  };
}

export interface ResultadoConjunto {
  lineas_erp: number;
  lineas_portal: number;
  iguales: number;
  faltan_en_el_portal: number;
  sobran_en_el_portal: number;
  distintas: number;
  veredicto: 'IDENTICO' | 'DIFIERE' | 'AMBOS VACIOS';
  diferencias: { donde: string; erp: string | null; portal: string | null }[];
}

/**
 * Compara los dos conjuntos de líneas sin importar el orden.
 *
 * El veredicto exige las dos cosas: que no falte nada del ERP **y que al portal
 * no le sobre nada**. Lo segundo es lo que faltaba.
 *
 * @param omitidas Índices de columna que se excluyen, cada uno con su motivo
 *                 escrito por quien llama. No es para tapar diferencias: es para
 *                 poder responder "¿y el resto coincide?" sin que el ruido
 *                 conocido lo oculte.
 * @param claves   Cuando las dos formas ya no coinciden columna a columna, las
 *                 dos funciones que devuelve `clavesPorMapa`. Sin esto se
 *                 compara por índice, que es lo correcto sólo mientras las
 *                 formas sean iguales.
 */
export function compararPorConjunto(
  lineasErp: string[],
  lineasPortal: string[],
  omitidas: Set<number>,
  maxDif = 3,
  claves?: { portal: (l: string) => string; origen: (l: string) => string },
): ResultadoConjunto {
  const porIndice = (l: string) => l.split(';')
    .filter((_, i) => !omitidas.has(i))
    .map(c => normalizar(c)).join(';');
  const clavePortal = claves?.portal ?? porIndice;
  const claveOrigen = claves?.origen ?? porIndice;

  const bolsa = new Map<string, string[]>();
  for (const l of lineasPortal) {
    const k = clavePortal(l);
    const arr = bolsa.get(k);
    if (arr) arr.push(l); else bolsa.set(k, [l]);
  }

  let iguales = 0;
  const faltantes: string[] = [];
  for (const l of lineasErp) {
    const arr = bolsa.get(claveOrigen(l));
    if (arr && arr.length > 0) { arr.pop(); iguales++; }
    else if (faltantes.length < maxDif) faltantes.push(l);
  }

  const sobrantes: string[] = [];
  for (const arr of bolsa.values()) sobrantes.push(...arr);

  const faltan = lineasErp.length - iguales;
  return {
    lineas_erp: lineasErp.length,
    lineas_portal: lineasPortal.length,
    iguales,
    faltan_en_el_portal: faltan,
    sobran_en_el_portal: sobrantes.length,
    distintas: faltan + sobrantes.length,
    veredicto: lineasErp.length === 0 && lineasPortal.length === 0
      ? 'AMBOS VACIOS'
      : (faltan === 0 && sobrantes.length === 0 ? 'IDENTICO' : 'DIFIERE'),
    diferencias: [
      ...faltantes.map(l => ({ donde: 'solo en el ERP', erp: l, portal: null })),
      ...sobrantes.slice(0, maxDif).map(l => ({ donde: 'solo en el portal', erp: null, portal: l })),
    ],
  };
}
