import React, { memo } from 'react';

/**
 * Contador — la burbuja con un número que va pegada a otra cosa.
 *
 * Es la tercera de las tres familias que salieron al medir los 316 "badges"
 * del proyecto (D3.5), y la única que se quedó sin canónico:
 *
 *     249  chip inline corto     → `Badge`
 *      58  aviso con ícono       → `Notice`
 *       9  **contador flotante** → esto
 *
 * `Badge` no sirve para esto y por eso se dejó fuera: un chip crece con su
 * texto, un contador tiene que ser **circular con un dígito y ovalado con
 * dos**, o sea ancho mínimo fijo y alto fijo. Meterlo en `Badge` habría dado
 * burbujas de anchos distintos según el número.
 *
 * Se escribió a mano NUEVE veces, y cuatro de ellas **dentro de componentes
 * canónicos** (`NotificationBell` ×2, `FilterBar`, y el del menú lateral).
 * Ahí es donde más duele: un canónico que reconstruye a mano algo que debería
 * ser otro canónico es cómo se multiplica la deuda.
 *
 * ── Por qué "9+" y no el número ──────────────────────────────────────────
 * El corte lo decide el llamador con `max`, no el componente, porque el
 * umbral depende de dónde vive: en el menú lateral cabe "9+", en la campana
 * de notificaciones cabe "99+". Lo que sí es fijo es que **se corta**: sin
 * eso, 1,247 avisos rompen la fila.
 */

// Literales, no plantilla: Tailwind escanea texto (misma nota que Badge/Switch).
const TONO = {
    danger:  'bg-danger-solid text-white',
    brand:   'bg-brand text-white',
    success: 'bg-success-solid text-white',
    warning: 'bg-warning-solid text-white',
    neutral: 'bg-content-3 text-white',
    'chart-8': 'bg-chart-8-solid text-white',
};

const TAMANO = {
    // `sm` es el que va pegado a un ícono (esquina de la campana, del menú).
    sm: 'min-w-[18px] h-[18px] px-1 text-micro',
    // `md` es el que va en línea con texto.
    md: 'min-w-[20px] h-5 px-1.5 text-caption',
};

const Contador = memo(({
    valor,
    max = 9,
    tono = 'danger',
    size = 'sm',
    className = '',
    // Sin nombre, un lector de pantalla lee "3" suelto y no se sabe 3 de qué.
    // El llamador tiene que decirlo: "3 avisos sin leer".
    'aria-label': ariaLabel,
    ...rest
}) => {
    const n = Number(valor) || 0;
    if (n <= 0) return null;
    return (
        <span
            aria-label={ariaLabel}
            className={`${TAMANO[size] || TAMANO.sm} ${TONO[tono] || TONO.danger}
                rounded-full font-black leading-none tabular-nums
                inline-flex items-center justify-center shrink-0 ${className}`}
            {...rest}>
            {n > max ? `${max}+` : n}
        </span>
    );
});

export default Contador;
