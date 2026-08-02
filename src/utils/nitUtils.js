import { maskDui } from './duiUtils';

// El NIT salvadoreño tiene DOS formatos, y el portal mostraba los dos con la
// misma máscara. El resultado se veía así en el libro de contribuyentes:
//
//     0177-7948--2      ← doble guion, y sobra un tramo
//     0539-1795--5
//
// Eso no es un error de pintado: **está guardado así en `customers.nit`**. El
// dato llega del DTE con la máscara de 14 dígitos aplicada a un número de 9, y
// quedan cuatro formas distintas conviviendo para lo mismo (medido el
// 2026-08-02: 52 con el NIT clásico bien formado, 29 rotos, 1 bien).
//
// Los dos formatos legítimos:
//
//   14 dígitos  MMMM-DDMMAA-NNN-V   0614-100784-001-0   el NIT de siempre
//    9 dígitos  ########-#          01777948-2          el DUI haciendo de NIT,
//                                                       desde 2018 para personas
//                                                       naturales
//
// Esto es SOLO para mostrar. El CSV del libro va sin guiones —los quita
// `generar_csv_libro` y el export— así que el archivo fiscal nunca dependió de
// esto y no cambia.

/**
 * Pone el NIT en su formato correcto según cuántos dígitos tenga.
 *
 * No corrige el número ni valida el dígito verificador: reformatea. Lo que no
 * tiene 9 ni 14 dígitos se devuelve tal cual — inventarle una máscara a un
 * número que no la tiene es peor que mostrarlo crudo, porque disimula que está
 * mal.
 */
export function formatearNit(nit) {
    if (!nit) return '';
    const d = String(nit).replace(/\D/g, '');
    if (d.length === 9)  return maskDui(d);                       // ########-#
    if (d.length === 14) return `${d.slice(0, 4)}-${d.slice(4, 10)}-${d.slice(10, 13)}-${d.slice(13)}`;
    return String(nit).trim();
}

/** El NRC: dígitos y verificador (`354446-7`). Mismo criterio que el NIT. */
export function formatearNrc(nrc) {
    if (!nrc) return '';
    const d = String(nrc).replace(/\D/g, '');
    if (d.length < 2) return String(nrc).trim();
    return `${d.slice(0, -1)}-${d.slice(-1)}`;
}
