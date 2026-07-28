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
