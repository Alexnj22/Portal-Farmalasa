import React, { memo } from 'react';
import { AlertCircle } from 'lucide-react';
import { inputHoverClass } from '../../utils/inputStyles';

/**
 * PortalTextarea — el campo de varias líneas del portal.
 *
 * Canónico creado el 2026-07-27. Era **el último control de formulario sin
 * canónico**: `<select>` ya iba a `LiquidSelect`, la casilla a `Checkbox`, el
 * archivo a `FileField`, la fecha a `LiquidDatePicker` — y quedaban **37
 * `<textarea>` nativos** que nadie había mirado, con cuatro radios distintos
 * (`rounded-xl` 4 · `lg` 4 · `2xl` 3 · `3xl` 1) y alturas a ojo.
 *
 * Es el mismo hallazgo de siempre: no eran cuatro decisiones, es que nadie
 * había nombrado el control. Y el efecto se veía: en un mismo formulario, el
 * campo de una línea y el de varias no tenían ni el mismo borde ni el mismo
 * radio, porque uno pasaba por `PortalInput` y el otro no pasaba por nada.
 *
 * Comparte con `PortalInput` la etiqueta, el badge "Requerido", el borde rojo
 * de error, el glow de marca y `data-surface="input"` — no está reimplementado
 * acá, es literalmente la misma superficie y las mismas clases. Lo único que
 * cambia es que crece en alto en vez de en ancho.
 *
 * `rows` en vez de una altura fija en píxeles: el alto de un campo de texto
 * debería medirse en líneas, que es lo que el usuario ve. Un `h-24` deja de
 * calzar apenas cambia el tamaño de fuente del tema.
 */
const PortalTextarea = memo(({
    label,
    name,
    value,
    onChange,
    placeholder,
    rows = 3,
    colSpan = 1,
    required = false,
    helperText,
    labelAction,
    readOnly = false,
    hasError,
    errorMessage,
    maxLength,
    className = '',
    textareaClassName = '',
}) => {
    const isMissing = required && !value?.trim();
    const isInvalid = hasError || isMissing;
    const errorClasses = isInvalid ? 'outline outline-2 outline-danger/50' : '';
    const messageId = name ? `${name}-message` : undefined;

    return (
        <div className={`col-span-1 ${colSpan === 2 ? 'md:col-span-2' : ''} ${className}`}>
            {/* La etiqueta es opcional a propósito. Al migrar los 37 nativos,
                muchos ya tenían su `<label>` afuera, a veces envolviendo otras
                cosas. Obligar a que la etiqueta viva acá habría exigido
                reestructurar el JSX de cada formulario en la misma pasada en
                que se cambia la superficie — dos cambios encimados, y si algo
                sale mal no se sabe cuál fue. */}
            {(label || isMissing || (hasError && errorMessage)) && (
            <label htmlFor={name} className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between transition-colors">
                <span className="flex items-center gap-1.5">
                    {label} {helperText && <span className="text-micro text-brand-text">{helperText}</span>}
                    {labelAction}
                </span>
                {isMissing && !hasError && <span id={messageId} className="text-danger font-bold bg-danger/10 px-2 py-0.5 rounded-md shadow-sm border border-danger/30">Requerido</span>}
                {hasError && errorMessage && <span id={messageId} className="text-danger font-bold bg-danger/15 px-2 py-0.5 rounded-md shadow-sm border border-danger/40 flex items-center gap-1"><AlertCircle size={10} /> {errorMessage}</span>}
            </label>
            )}

            <div data-surface="input" className={`relative z-base ${readOnly ? 'opacity-80 cursor-not-allowed' : `${inputHoverClass} ${errorClasses}`}`}>
                <textarea
                    id={name}
                    name={name}
                    rows={rows}
                    value={value || ''}
                    onChange={onChange}
                    placeholder={placeholder}
                    readOnly={readOnly}
                    disabled={readOnly}
                    required={required}
                    maxLength={maxLength}
                    aria-required={required || undefined}
                    aria-invalid={isInvalid || undefined}
                    aria-describedby={isInvalid ? messageId : undefined}
                    // `resize-none` a propósito: el tirador nativo de la esquina
                    // es el mismo elemento del navegador que ya sacamos de todos
                    // los demás controles — no sigue el tema y se sale de la
                    // caja del formulario al arrastrarlo. El alto se elige con
                    // `rows`.
                    className={`w-full bg-transparent resize-none text-body-xl font-bold text-content
                        outline-none px-4 py-2.5 leading-relaxed ${textareaClassName}`}
                />
                {maxLength && (
                    <span className="absolute bottom-1.5 right-3 text-micro font-bold text-content-3 tabular-nums pointer-events-none">
                        {(value || '').length}/{maxLength}
                    </span>
                )}
            </div>
        </div>
    );
});

export default PortalTextarea;
