// Lo que comparten el catálogo y la ficha de un producto (2026-10-07).

/** «ACETAMINOFEN 500MG X 100 TAB» → «Acetaminofen 500mg x 100 Tab». Con número, en minúscula. */
export function nombreProducto(s) {
  return String(s ?? '').toLowerCase().split(/\s+/).filter(Boolean).map((w) => {
    if (/\d/.test(w) || w.length <= 1) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/** Las iniciales para el producto sin foto. */
export const iniciales = (s) => String(s ?? '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Un color estable por producto, para que el que no tiene foto no se vea igual a todos. */
const TONOS = [['#5B1E9C', '#B5308C'], ['#0A7C66', '#2BB673'], ['#1F5FAD', '#4CA3E8'], ['#B4560A', '#F0A23A'], ['#7A1F3D', '#D9486F'], ['#2E3D8F', '#6B7FE0']];
export const tonoDe = (id) => TONOS[Math.abs(Number(id) || 0) % TONOS.length];

/** Búsquedas rápidas: lo que la gente suele venir a buscar. */
export const BUSQUEDAS = [
  { q: 'acetaminofen', texto: 'Dolor y fiebre', sf: 'thermometer.medium' },
  { q: 'antigripal', texto: 'Gripe', sf: 'wind' },
  { q: 'vitamina', texto: 'Vitaminas', sf: 'leaf.fill' },
  { q: 'suero oral', texto: 'Hidratación', sf: 'drop.fill' },
  { q: 'pañal', texto: 'Bebé', sf: 'figure.and.child.holdinghands' },
  { q: 'glucometro', texto: 'Diabetes', sf: 'heart.text.square.fill' },
  { q: 'crema', texto: 'Piel', sf: 'hand.raised.fill' },
  { q: 'omeprazol', texto: 'Estómago', sf: 'cross.case.fill' },
];
