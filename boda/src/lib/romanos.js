// Numerales romanos para los capítulos (I, II, III…) y la fecha (17 · IV · 2027).
const TABLA = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function romano(n) {
  let resto = Math.max(0, Math.floor(n));
  let s = '';
  for (const [v, r] of TABLA) while (resto >= v) { s += r; resto -= v; }
  return s;
}
