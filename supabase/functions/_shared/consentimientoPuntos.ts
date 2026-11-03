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
  // Aviso de privacidad v2 (vigente desde el 17-oct-2026): al subirlo, la app
  // y `/mis-puntos` vuelven a pedirlo a quien sólo aceptó el anterior.
  aviso: "aviso-2026-10-17",
  programa:
    "Acepto seguir en el Programa de Puntos Salud. Para administrarlo, la " +
    "Empresa usa mi nombre, mi documento, mi teléfono y el historial de mis " +
    "compras y canjes.",
  promociones:
    "Acepto recibir promociones y descuentos especiales al teléfono o al " +
    "correo que tengo registrados.",
};

// Las versiones del reglamento del programa, cada una con la fecha de su
// «vigente a partir del…» (docs/legal/reglamento-programa-de-puntos*.html).
// La vigente es la última cuya fecha ya llegó, así que el día que rige una
// nueva la app se la pide a todo el mundo SIN redesplegar nada.
// `tests/unit/documentosVigentes.test.js` compara estas fechas y la del aviso
// contra el texto de los documentos: cambiar un documento sin subir su versión
// falla la prueba — es lo que garantiza que el cliente lo vuelva a confirmar.
export const REGLAMENTOS = [
  { version: "reglamento-2026-10-01", desde: "2026-10-01" },
  { version: "reglamento-2026-11-15", desde: "2026-11-15" },
];

/** Las versiones que el cliente tiene que haber aceptado HOY (hora de El Salvador). */
export function documentosVigentes(ahora: Date = new Date()) {
  const hoy = new Date(ahora.getTime() - 6 * 3600_000).toISOString().slice(0, 10);
  const vigente = [...REGLAMENTOS].reverse().find((r) => r.desde <= hoy) ?? REGLAMENTOS[0];
  return { reglamento: vigente.version, aviso: TEXTOS_CONSENTIMIENTO.aviso };
}
