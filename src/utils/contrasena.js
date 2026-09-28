// Las reglas de una contraseña nueva, escritas UNA vez.
//
// Vivían dos veces —en la entrada (cambio obligatorio) y en el formulario de
// Personal (fijarla a otra persona)— con textos distintos, y la app del
// teléfono iba a ser la tercera. El servidor (`set-employee-password`) sólo
// exige el largo: la mayúscula y el número los pide el portal.

export const LARGO_MINIMO_CONTRASENA = 8;

/** El primer problema de la contraseña nueva, o `null` si está bien. */
export function problemaDeContrasenaNueva(nueva, confirmacion) {
    const clave = nueva ?? '';
    if (clave.length < LARGO_MINIMO_CONTRASENA) return `Mínimo ${LARGO_MINIMO_CONTRASENA} caracteres.`;
    if (!/[A-Z]/.test(clave)) return 'Debe incluir al menos una mayúscula.';
    if (!/[0-9]/.test(clave)) return 'Debe incluir al menos un número.';
    if (confirmacion !== undefined && clave !== confirmacion) return 'Las contraseñas no coinciden.';
    return null;
}
