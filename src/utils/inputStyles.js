import { maskDui } from './duiUtils';

// Glow azul de marca al hover/focus — compartido entre PortalInput y
// cualquier wrapper de LiquidSelect/LiquidDatePicker que necesite el mismo
// look (ver EmployeeFormModal.jsx y PracticanteModal.jsx). Usa outline en vez
// de border/ring: en elementos con data-surface="input" (T3), Tailwind
// border/box-shadow pierde siempre contra la regla sin @layer de data-surface
// por cascade layers — outline es una propiedad CSS distinta, no compite.
export const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-brand/40 focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-brand/30";

// Máscaras de campos numéricos comunes (DUI/teléfono/ISSS/AFP/cuenta bancaria)
// — DUI delega en maskDui (utils/duiUtils.js); el resto vive aquí porque no es
// específico de ningún formulario en particular.
export const applyInputMask = (value, type) => {
    if (!value) return '';
    if (type === 'ACCOUNT') return value.replace(/[^0-9-]/g, '').substring(0, 25);
    if (type === 'DUI') return maskDui(value);
    let v = value.replace(/\D/g, '');
    if (type === 'PHONE') {
        if (v.length > 4) return `${v.substring(0, 4)}-${v.substring(4, 8)}`;
        return v;
    }
    if (type === 'ISSS' && v.length > 9) return v.substring(0, 9);
    if (type === 'AFP' && v.length > 12) return v.substring(0, 12);
    return v;
};
