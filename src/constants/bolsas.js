// Catálogo de las etapas del circuito de bolsas de efectivo: clave, texto,
// estado de la base y alcance. El ícono va por NOMBRE; la pantalla lo resuelve
// (`views/bolsas/etapas.js`). Lo necesita la lógica y la app nativa.

/* ── Las cuatro etapas, en el orden en que pasan las cosas ──────────────────
 *
 * Vive en su propio archivo porque la leen los DOS lados: `BolsasView` para
 * dibujar las pestañas y `CircuitoDeBolsas` para saber qué cuerpo pintar. La
 * lista tiene que ser UNA — con dos copias, agregar una etapa al circuito
 * dejaría una pestaña sin contenido o un contenido sin pestaña, y las dos
 * fallan en silencio.
 *
 * Y va aparte del motor y no adentro por una razón mecánica: un archivo que
 * exporta componentes **y** constantes rompe el refresco en caliente de Vite
 * (`react-refresh/only-export-components`), o sea que tocar la lista obligaría
 * a recargar la pantalla entera en desarrollo.
 *
 * `estado` es el valor de la columna, y por eso está acá y no en la vista: es
 * la traducción entre lo que dice la base y lo que lee quien mueve el dinero.
 * «ABIERTA» no significa nada para quien tiene la bolsa en la mano.
 *
 * `soloAdmin` marca las tres que exigen alcance ALL. La sala ve una sola etapa
 * —la suya— y con una sola pestaña `ViewTabBar` no dibuja ninguna: no hay entre
 * qué elegir, que es exactamente la regla de §14.
 */
export const ETAPAS_DE_BOLSA = [
    { key: 'sala',        label: 'En la sala',          icono: 'Package',     estado: 'ABIERTA'   },
    /* ── «Diferencias» NO es una etapa del circuito, y por eso va aparte ────
     *
     * Es la única pestaña que la sala comparte con administración, y existe
     * porque el aviso llegaba a una puerta cerrada (2026-08-26). Cuando una
     * bolsa no cuadra, `confirmar_conteo` ya le avisa a la sala —eso funcionaba
     * desde el principio— y el aviso apuntaba a `/bolsas?tab=finalizadas`, que
     * es `soloAdmin`. O sea: le llegaba la notificación, tocaba, y caía en «En
     * la sala», donde esa bolsa ya no está porque se contó hace días.
     *
     * Y la sala SÍ puede resolverla: `resolver_diferencia_bolsa` acepta a quien
     * tenga `bolsas` con `can_edit` sobre una bolsa de su propia sucursal. El
     * permiso estaba; faltaba la pantalla.
     *
     * Va sin `estado` porque no lo tiene: son bolsas CONTADAS con una condición
     * —no cuadraron y nadie anotó por qué—. Va segunda, que para la sala es la
     * de al lado. */
    { key: 'diferencias', label: 'Diferencias',         icono: 'Scale',       estado: null },
    { key: 'camino',      label: 'Esperando recepción', icono: 'Send',        estado: 'ENTREGADA', soloAdmin: true },
    { key: 'contar',      label: 'Por contar',          icono: 'Banknote',    estado: 'RECIBIDA',  soloAdmin: true },
    { key: 'finalizadas', label: 'Finalizadas',         icono: 'ShieldCheck', estado: 'CONTADA',   soloAdmin: true },
];
