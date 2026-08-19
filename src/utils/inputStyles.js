import { maskDui } from './duiUtils';

// Glow azul de marca al hover/focus — compartido entre PortalInput y
// cualquier wrapper de LiquidSelect/LiquidDatePicker que necesite el mismo
// look (ver EmployeeFormModal.jsx y PracticanteModal.jsx). Usa outline en vez
// de border/ring: en elementos con data-surface="input" (T3), Tailwind
// border/box-shadow pierde siempre contra la regla sin @layer de data-surface
// por cascade layers — outline es una propiedad CSS distinta, no compite.
export const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-brand/40 focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-brand/30";

// Máscaras de campos numéricos comunes (DUI/teléfono/ISSS/AFP/cuenta bancaria,
// NIT/NRC/porcentaje) — DUI delega en maskDui (utils/duiUtils.js); el resto vive
// aquí porque no es específico de ningún formulario en particular.
//
// La convención de los identificadores es RECORTAR, no agrupar: ISSS corta en
// 9, AFP en 12, y los tres que se agregaron el 2026-08-01 hacen lo mismo. Un
// separador que se acomoda solo mientras se teclea salta de lugar en cada
// pulsación, y el valor limpio es además el formato que espera el DTE.
//
// Los topes de NIT y NRC salen de datos reales, no de la teoría — ver
// `utils/clienteValidacion.js`, donde están las cuentas: NIT de 14 (o 9 cuando
// es el DUI) y NRC observado entre 4 y 7 dígitos en 60 DTE sellados por
// Hacienda, con el tope en 8 por prudencia.
export const applyInputMask = (value, type) => {
    if (!value) return '';
    if (type === 'ACCOUNT') return value.replace(/[^0-9-]/g, '').substring(0, 25);
    if (type === 'DUI') return maskDui(value);
    // DECIMAL acepta punto Y coma, y por eso el campo va como `type="text"`.
    //
    // Medido el 2026-08-17 sobre el campo de temperatura de las bitácoras, que
    // era `type="number"`: tecleando «24.9» funciona, pero tecleando «24,9» el
    // navegador **tira la coma sin avisar** y queda «249». No es que no deje
    // escribir el decimal — es que se lo come, y 249 °C entra como una lectura
    // válida. Un teclado en español (y el teclado decimal de un teléfono en
    // es-419) ofrece la coma, así que la trampa es la ruta normal, no la rara.
    //
    // De paso arregla lo que el usuario ve: con `type="number"` el punto recién
    // aparece cuando se escribe el dígito siguiente, así que la pantalla parece
    // estar ignorando la tecla.
    //
    // ── Y es el canónico del DINERO desde el 2026-08-19 ────────────────────
    // El mismo defecto, al revés y en producción: «en mi computadora funciona
    // con . pero en otras solo con ,» (usuario). Cuál acepta el campo nativo lo
    // decide el IDIOMA de cada computadora, así que el mismo formulario guarda
    // cosas distintas según la caja — y «120,50» donde se espera punto entra
    // como 12050. Todo campo de dinero va por acá; lo vigila el gate de diseño
    // en `monto-nativo` (DESIGN.md §15.11.1).
    if (type === 'DECIMAL') {
        const negativo = /^\s*-/.test(value) ? '-' : '';
        const limpio = value.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
        const [entero, ...decimales] = limpio.split('.');
        // Sólo el PRIMER grupo decimal: «24.9.5» es un error de tipeo, y pegar
        // los grupos daría 24.95 — otro número, no el que se quiso escribir.
        return limpio.includes('.')
            ? `${negativo}${entero}.${(decimales[0] || '').substring(0, 2)}`
            : `${negativo}${entero}`;
    }
    let v = value.replace(/\D/g, '');
    if (type === 'PHONE') {
        if (v.length > 4) return `${v.substring(0, 4)}-${v.substring(4, 8)}`;
        return v;
    }
    if (type === 'ISSS' && v.length > 9) return v.substring(0, 9);
    if (type === 'AFP' && v.length > 12) return v.substring(0, 12);
    if (type === 'NIT' && v.length > 14) return v.substring(0, 14);
    if (type === 'NRC' && v.length > 8) return v.substring(0, 8);
    if (type === 'PERCENT') return v.substring(0, 3);
    return v;
};
