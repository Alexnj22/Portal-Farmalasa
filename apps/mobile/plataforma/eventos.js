// Avisos entre partes del núcleo — la versión del TELÉFONO (sin `window`).
const oyentes = new Map();

export function emitir(nombre, detalle) {
  for (const fn of [...(oyentes.get(nombre) || [])]) fn(detalle);
}

export function escuchar(nombre, alRecibir) {
  if (!oyentes.has(nombre)) oyentes.set(nombre, new Set());
  oyentes.get(nombre).add(alRecibir);
  return () => oyentes.get(nombre)?.delete(alRecibir);
}
