// Helpers compartidos para "economic_dependents" (JSONB en employees) — usados tanto
// por el modal de Empleado (UI) como por employeeSlice (normalización antes de guardar),
// para que la definición de "modo edad manual" y su validez no diverja entre cliente y store.

export const MIN_DEPENDENT_AGE = 0;
export const MAX_DEPENDENT_AGE = 120;

// Un dependiente está en modo "edad manual" (en vez de fecha de nacimiento exacta) si
// age_only ya fue decidido explícitamente (por el toggle o por lo persistido en BD), o,
// a falta de eso (fila nueva sin tocar), si hay una edad numérica válida y no hay fecha.
export const isDependentAgeOnly = (dep) => {
    if (!dep) return false;
    if (dep.age_only != null) return !!dep.age_only;
    return !dep.birth_date && dep.age !== '' && dep.age != null && !Number.isNaN(parseInt(dep.age, 10));
};

// Edad numérica ya validada (entero en rango), o null si no aplica / no es válida.
export const getDependentAge = (dep) => {
    if (!isDependentAgeOnly(dep)) return null;
    if (dep.age === '' || dep.age == null) return null;
    const n = parseInt(dep.age, 10);
    if (Number.isNaN(n) || !Number.isInteger(Number(dep.age)) || n < MIN_DEPENDENT_AGE || n > MAX_DEPENDENT_AGE) return null;
    return n;
};

// true si el dependiente está en modo edad manual pero el valor ingresado es inválido
// (vacío, no numérico, decimal, negativo o fuera de rango humano) — bloquea Guardar.
export const isDependentAgeInvalid = (dep) => {
    if (!isDependentAgeOnly(dep)) return false;
    if (dep.age === '' || dep.age == null) return true;
    const n = Number(dep.age);
    return !Number.isInteger(n) || n < MIN_DEPENDENT_AGE || n > MAX_DEPENDENT_AGE;
};
