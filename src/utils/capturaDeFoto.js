// ═══════════════════════════════════════════════════════════════════════════
// Tomar la foto con la cámara — la regla, y por qué `capture` solo no alcanza.
//
// Reportado desde sala el 2026-08-19: «en Android no se puede tomar la foto en
// la bitácora de antibióticos, ni donde haya que subir foto — solo sale la
// galería». Era cierto en TODAS las pantallas con foto, y no era un permiso ni
// una versión de Android: el portal corre dentro de una WebView de Capacitor, y
// ahí el que decide si abre la cámara o el explorador de archivos es
// `BridgeWebChromeClient.onShowFileChooser`. Su línea es literal:
//
//     boolean capturePhoto = captureEnabled && acceptTypes.contains("image/*");
//
// `acceptTypes` es la lista de `accept` partida por comas y `contains` compara
// cadenas EXACTAS. O sea que hacen falta las DOS cosas juntas:
//
//   1. el atributo `capture`, y
//   2. que la lista de `accept` traiga el token `image/*` tal cual.
//
// Si falta cualquiera de las dos cae a `showFilePicker`, que es el explorador
// de archivos — la galería. Así estaban los cinco selectores de foto:
//
//   accept="image/jpeg,image/png,image/webp" + capture   → no hay `image/*` en
//       la lista: el `capture` se ignoraba. (Devolver, Movimiento, Catálogo)
//   accept="image/*,application/pdf"  sin capture        → nunca hubo cámara.
//       (bitácoras, comprobantes, expedientes — todo lo que usa `FileField`)
//   accept="image/*"                  sin capture        → tampoco. (foto de
//       perfil del empleado, comprobante de bolsa)
//
// Los dos primeros DECÍAN abrir la cámara en su comentario. Nadie lo notó
// porque el explorador se abre igual y la foto termina subiéndose: el camino
// funciona, solo que es el otro.
//
// Por eso los atributos van en una constante y no escritos en cada archivo: la
// pareja `accept` + `capture` es una sola decisión, y separarla es exactamente
// lo que hace que se rompa sin dar error.
//
// ── El `accept` del selector de archivos NO se toca ────────────────────────
// La cámara siempre devuelve un JPEG, así que su `accept` puede ser el comodín
// sin abrir la puerta a nada. El input de archivos conserva su lista fina
// (`image/jpeg,image/png,image/webp`, `.pdf`, …), que es la que de verdad
// filtra lo que alguien puede elegir del disco y la que tiene que seguir
// coincidiendo con `allowed_mime_types` del bucket.
//
// ── Y en el lado nativo faltaba una pieza más ─────────────────────────────
// Con `targetSdk 36`, `resolveActivity(ACTION_IMAGE_CAPTURE)` devuelve null si
// el manifiesto no declara `<queries>` para esa acción (filtrado de visibilidad
// de paquetes de Android 11+). Capacitor lo trata como «no hay cámara» y cae al
// explorador — el mismo síntoma por otra causa. La declaración está en
// `android/app/src/main/AndroidManifest.xml`.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La pareja de atributos que abre la cámara. Se esparce tal cual:
 *
 *     <input type="file" {...PROPS_CAMARA} className="sr-only" onChange={…} />
 *
 * No separar `accept` de `capture` ni cambiar el `accept` por una lista fina:
 * juntos y con el comodín exacto es la única forma en que la WebView abre la
 * cámara.
 *
 * El `type="file"` queda AFUERA a propósito, escrito en cada input: los
 * detectores de `gate:design` leen el marcado como texto y eximen a los
 * selectores de archivo por su `type`. Escondido dentro del spread, cada input
 * de cámara se contaba como un campo de texto suelto sin rótulo.
 */
export const PROPS_CAMARA = Object.freeze({
    accept: 'image/*',
    capture: 'environment',
});

// Extensiones de imagen que aparecen en los `accept` del portal escritos por
// extensión y no por MIME (`.pdf,.jpg,.jpeg,.png` en el expediente del
// empleado). Sin esto, esos campos no ofrecerían la cámara aunque acepten fotos.
const EXTENSIONES_DE_IMAGEN = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif'];

/**
 * ¿Este `accept` admite una foto? Decide si vale la pena ofrecer la cámara.
 *
 * Un `accept` vacío admite cualquier cosa, foto incluida.
 *
 * @param {string} [accept] el mismo formato del atributo nativo.
 * @returns {boolean}
 */
export const aceptaImagenes = (accept) => {
    if (!accept) return true;
    return accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(regla => (
        regla.startsWith('image/') || EXTENSIONES_DE_IMAGEN.includes(regla)
    ));
};

export default PROPS_CAMARA;
