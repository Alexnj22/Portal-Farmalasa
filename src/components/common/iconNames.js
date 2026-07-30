// ── Nombre accesible automático para `iconOnly` (2026-07-28) ─────────────
// Un botón que solo tiene un ícono no tiene texto, y un lector de pantalla lo
// anuncia como "botón" y nada más (WCAG 4.1.2). Medido: **102 de los 194
// `iconOnly` del proyecto no tenían `aria-label` ni `title`.**
//
// Lo llamativo fue la distribución: 56 son una `X`, 21 son un chevron. O sea
// que 77 de los 102 son cuatro íconos con un significado que no admite duda.
// Eso hace que el arreglo correcto sea UNO solo, acá, y no 102 ediciones:
// si no le dieron nombre, el componente lo deriva del ícono.
//
// No es un parche por pereza — es la regla correcta. Un botón cuyo único
// contenido es una `X` significa "cerrar" en todas partes; que cada llamador
// tenga que repetirlo es justamente por lo que 102 se lo saltaron.
//
// Quien tenga algo más específico que decir ("Quitar el filtro de sucursal")
// pasa su `aria-label` y gana el suyo: esto es el piso, no el techo.
export const NOMBRE_POR_ICONO = {
    X: 'Cerrar', XIcon: 'Cerrar', XCircle: 'Cerrar',
    ChevronLeft: 'Anterior', ChevronRight: 'Siguiente',
    ChevronUp: 'Contraer', ChevronDown: 'Expandir',
    ArrowLeft: 'Volver', ArrowRight: 'Continuar',
    Trash2: 'Eliminar', Trash: 'Eliminar',
    Plus: 'Agregar', Minus: 'Quitar',
    Check: 'Confirmar', CheckCircle2: 'Confirmar',
    Edit2: 'Editar', Edit3: 'Editar', Pencil: 'Editar', SquarePen: 'Editar',
    RefreshCw: 'Actualizar', RotateCcw: 'Deshacer',
    LogOut: 'Cerrar sesión', Menu: 'Abrir el menú',
    Maximize2: 'Ampliar', Minimize2: 'Reducir',
    ZoomIn: 'Acercar', ZoomOut: 'Alejar',
    Search: 'Buscar', Filter: 'Filtrar', Download: 'Descargar',
    Printer: 'Imprimir', Copy: 'Copiar', Save: 'Guardar',
    Eye: 'Ver', EyeOff: 'Ocultar', Info: 'Más información',
};

// Vive en su propio módulo y no dentro de `Button.jsx` porque exportar una
// constante desde un archivo de componente rompe el Fast Refresh de React
// (`react-refresh/only-export-components`): al editar el mapa, Vite recarga la
// página entera en vez de sustituir el componente.

// ── Tono canónico por ícono (2026-07-30) ─────────────────────────────────
// Mismo principio que `NOMBRE_POR_ICONO`, y por el mismo hallazgo. Auditados
// los 193 botones `iconOnly` del proyecto: **18 íconos se dibujan con 2 a 4
// colores distintos**. El ojo aparece sin tono, `chart-1`, `success` y
// `secondary`; `Download` es `success` en Personal y `chart-1` en Facturas de
// Compra. O sea que el mismo ícono significa lo mismo y se ve distinto según la
// pantalla, que es justo lo que el usuario señaló.
//
// El arreglo es un mapa y no N ediciones: si el llamador no dice de qué color
// es, lo dice el ícono. Es el piso, no el techo — quien pase `tone` o `variant`
// explícitos gana el suyo, y eso es necesario: un `Check` dentro de un
// "confirmar borrado" va en `destructive` a propósito, y los clústeres de
// acción por fila (Facturas de Compra pinta Eye/Download/FileJson/Archive de
// `chart-1` a la vez) tienen una coherencia local que es legítima.
//
// Por eso hoy lo consume SOLO `TabBarAction`, que es el botón de acción de una
// vista — el que vive en `FilterBar` y del que hay uno o dos por pantalla.
// Extenderlo a `Button` tocaría los 193 de una vez, incluidos esos clústeres.
export const TONO_POR_ICONO = {
    // Crear y confirmar: algo aparece.
    Plus: 'success', Check: 'success', CheckCircle2: 'success', Save: 'success',
    // Sacar datos del portal.
    Download: 'success', Upload: 'success', FileOutput: 'success', Printer: 'chart-1',
    // Mirar sin tocar.
    Eye: 'chart-1', EyeOff: 'chart-1', Search: 'chart-1', Maximize2: 'chart-1',
    // Modificar lo que ya existe.
    Edit2: 'warning', Edit3: 'warning', Pencil: 'warning', SquarePen: 'warning',
    // Rehacer / volver a traer.
    RefreshCw: 'chart-1', RotateCcw: 'chart-1', Copy: 'chart-1',
    // Guardar fuera de la vista, sin destruir.
    Archive: 'chart-4',
    // Destruir.
    Trash2: 'danger', Trash: 'danger',
};

// La clase de TEXTO por tono. Vivía duplicada dentro de `TabBarAction`; la
// comparte con `Button` desde que el tono por ícono se aplicó a todo el
// proyecto (2026-07-30). Es el color del ÍCONO, no un relleno: en una superficie
// neutra el color identifica la categoría sin gritar.
export const CLASE_TEXTO_POR_TONO = {
    brand:     'text-brand-text',
    success:   'text-success-text',
    warning:   'text-warning-text',
    danger:    'text-danger-text',
    'chart-1': 'text-chart-1-text',
    'chart-3': 'text-chart-3-text',
    'chart-4': 'text-chart-4-text',
    'chart-6': 'text-chart-6-text',
    'chart-8': 'text-chart-8-text',
    'chart-9': 'text-chart-9-text',
};

// Las variantes RELLENAS: su fondo ya es del color y el ícono va en blanco, así
// que el tono por ícono NO se les aplica — teñirlo lo haría desaparecer contra
// su propio fondo.
export const VARIANTES_RELLENAS = new Set(['primary', 'destructive']);
