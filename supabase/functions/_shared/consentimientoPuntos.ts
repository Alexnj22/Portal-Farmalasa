// Los dos permisos del cliente, escritos UNA vez para las dos puertas que los
// piden: `/mis-puntos` (la web) y `app-clientes` (la app del teléfono).
//
// El Art. 27 letra c) exige que el consentimiento sea informado, y la prueba es
// el texto que la persona tenía delante. Si cada puerta tuviera su copia, el día
// que una cambie la redacción las evidencias de `consentimientos_cliente`
// dirían dos cosas distintas con la misma versión al lado.
//
// Cambiar la redacción = cambiar `version` y desplegar las DOS funciones.
export const TEXTOS_CONSENTIMIENTO = {
  version: "consentimiento-2026-09-05",
  aviso: "aviso-2026-09-04",
  programa:
    "Acepto seguir en el Programa de Puntos Salud. Para administrarlo, la " +
    "Empresa usa mi nombre, mi documento, mi teléfono y el historial de mis " +
    "compras y canjes.",
  promociones:
    "Acepto recibir promociones y descuentos especiales al teléfono o al " +
    "correo que tengo registrados.",
};
