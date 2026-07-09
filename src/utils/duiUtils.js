// DUI de El Salvador: 8 dígitos + 1 verificador (módulo 10, pesos 9..2).
// Extraído de EmployeeFormModal.jsx para reusar en otros módulos con campo
// de DUI (ej. Practicantes) sin duplicar el algoritmo por tercera vez.
export const maskDui = (value) => {
    if (!value) return '';
    const v = value.replace(/\D/g, '');
    if (v.length > 8) return `${v.substring(0, 8)}-${v.substring(8, 9)}`;
    return v;
};

export const isValidDUIAlgorithm = (dui) => {
    if (!dui) return true;
    const cleanDui = dui.replace(/\D/g, '');
    if (cleanDui.length !== 9) return true;

    const digits = cleanDui.split('').map(Number);
    const verifier = digits.pop();

    let sum = 0;
    for (let i = 0; i < 8; i++) {
        sum += digits[i] * (9 - i);
    }

    let calcVerifier = 10 - (sum % 10);
    if (calcVerifier === 10) calcVerifier = 0;

    return calcVerifier === verifier;
};
