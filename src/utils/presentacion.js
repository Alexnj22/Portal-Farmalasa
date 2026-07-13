// Convierte unidades a presentación usando la regla del 40%:
// floor(units/factor) + (residuo/factor >= 0.4 ? 1 : 0)
export function applyPresRule(units, factor) {
    if (!units || units <= 0 || !factor || factor <= 1) return units ?? 0;
    const floor = Math.floor(units / factor);
    const rem   = units % factor;
    return floor + (rem / factor >= 0.4 ? 1 : 0);
}
