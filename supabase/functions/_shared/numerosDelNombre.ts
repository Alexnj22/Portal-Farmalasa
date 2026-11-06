/**
 * ¿La factura y el producto elegido hablan de la MISMA concentración y el
 * mismo tamaño? (2026-11-05)
 *
 * Nació del cruce de octubre: de 997 renglones que la carga daba por
 * «seguros», 20 no eran el producto que se cargó, y los peores diferían sólo
 * en un número — «Olexa 10 mg» emparejado con OLEXA 5 MG, «DAFLON 500 X 60»
 * aprendido como DAFLON 500 CX30, ALGODÓN 10 g contra 100 g. El parecido de
 * nombre no lo ve: un dígito es casi nada del texto y todo el producto.
 *
 * Compara sólo lo que los DOS nombran: si uno dice mg y el otro no, no hay
 * nada que comparar. Las masas se llevan a mg y los volúmenes a ml, así
 * 1 g = 1000 mg no es una diferencia.
 */

export type Medidas = Map<string, { norm: Set<number>; crudo: Set<number> }>;

const UNIDAD: Record<string, [string, number]> = {
  MCG: ["masa", 0.001], MG: ["masa", 1], G: ["masa", 1000], GR: ["masa", 1000], GRS: ["masa", 1000],
  GRAMOS: ["masa", 1000], KG: ["masa", 1_000_000],
  ML: ["volumen", 1], L: ["volumen", 1000], LT: ["volumen", 1000], LTS: ["volumen", 1000], CC: ["volumen", 1],
  UI: ["ui", 1], IU: ["ui", 1], "%": ["pct", 1],
};

const norm = (s: string) => String(s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")     // 25,000 → 25000
  .replace(/(\d),(\d)/g, "$1.$2");             // 0,5 → 0.5

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function medidas(texto: string): Medidas {
  const t = norm(texto);
  const out: Medidas = new Map();
  const poner = (k: string, crudo: number, f: number) => {
    if (!(Number.isFinite(crudo) && crudo > 0)) return;
    const e = out.get(k) ?? out.set(k, { norm: new Set(), crudo: new Set() }).get(k)!;
    e.norm.add(r3(crudo * f)); e.crudo.add(r3(crudo));
  };
  // `500/125 MG`, `40+12.5 MG`, `12.5/1000MG`: la unidad vale para toda la
  // lista. Y la SUMA también cuenta: AUGMENTIN 625 MG = 500/125.
  const re = /(\d+(?:\.\d+)?(?:\s*(?:MG|MCG)?\s*[\/+]\s*\d+(?:\.\d+)?)*)\s*(MCG|MG|GRAMOS|GRS|GR|G|KG|ML|LTS|LT|L|CC|UI|IU|%)(?![A-Z0-9])/g;
  for (const m of t.matchAll(re)) {
    const [clase, f] = UNIDAD[m[2]];
    const nums = m[1].split(/\s*(?:MG|MCG)?\s*[\/+]\s*/).map(Number).filter((x) => x > 0);
    for (const n of nums) poner(clase, n, f);
    if (nums.length > 1) poner(clase, nums.reduce((a, b) => a + b, 0), f);
  }
  return out;
}

/**
 * Las diferencias de concentración, peso, volumen, UI o % entre la factura y
 * el nombre del producto, en palabras para la pantalla. Vacío = nada que
 * objetar.
 *
 * Tres decisiones medidas contra octubre (2,008 renglones):
 * - La CANTIDAD POR CAJA («x 60») no se compara: la factura cuenta tabletas y
 *   el catálogo sobres («PANADOL x 104 capletas» = «X 52 SOBRES»), y daba más
 *   falsos avisos que hallazgos.
 * - El número CRUDO también vale: medio catálogo escribe «EUTIROX 75 MG» donde
 *   la caja dice 75 mcg. Que el número coincida alcanza.
 * - Una combinación vale por sus partes y por su suma (625 = 500/125).
 */
export function diferenciasDeNumeros(factura: string, producto: string): string[] {
  const a = medidas(factura), b = medidas(producto);
  const dif: string[] = [];
  const NOMBRE: Record<string, string> = { masa: "concentración o peso", volumen: "volumen", ui: "UI", pct: "porcentaje" };
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) continue;
    const comun = [...va.norm].some((x) => vb.norm.has(x)) || [...va.crudo].some((x) => vb.crudo.has(x));
    if (!comun) dif.push(`${NOMBRE[k]}: la factura dice ${[...va.crudo].join(" / ")} y el producto ${[...vb.crudo].join(" / ")}`);
  }
  return dif;
}
