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
 */
export function compararPorConjunto(
  lineasErp: string[],
  lineasPortal: string[],
  omitidas: Set<number>,
  maxDif = 3,
): ResultadoConjunto {
  const clave = (l: string) => l.split(';')
    .filter((_, i) => !omitidas.has(i))
    .map(c => normalizar(c)).join(';');

  const bolsa = new Map<string, string[]>();
  for (const l of lineasPortal) {
    const k = clave(l);
    const arr = bolsa.get(k);
    if (arr) arr.push(l); else bolsa.set(k, [l]);
  }

  let iguales = 0;
  const faltantes: string[] = [];
  for (const l of lineasErp) {
    const arr = bolsa.get(clave(l));
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
