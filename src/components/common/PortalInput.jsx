import React, { memo } from 'react';
import { AlertCircle, Lock } from 'lucide-react';
import { inputHoverClass, applyInputMask } from '../../utils/inputStyles';

// Input estándar del portal: label uppercase + badge "Requerido"/error, icono
// izquierdo opcional, glow azul de marca al hover/focus, borde rojo cuando
// falta o es inválido. Todo formulario nuevo debe reusar este componente en
// vez de duplicar el estilo (ver memoria feedback_design_audit_means_full_pass).
// Clases completas y literales: Tailwind escanea el fuente, un
// `border-${tono}/30` armado en tiempo de ejecución no genera nada.
const TONOS = {
    brand:     { caja: 'border-brand/30 bg-brand/5',       texto: 'text-brand-text',   icono: 'text-brand' },
    success:   { caja: 'border-success/30 bg-success/5',   texto: 'text-success-text', icono: 'text-success' },
    danger:    { caja: 'border-danger/30 bg-danger/5',     texto: 'text-danger',       icono: 'text-danger' },
    warning:   { caja: 'border-warning/30 bg-warning/5',   texto: 'text-warning-text', icono: 'text-warning' },
    'chart-1': { caja: 'border-chart-1/30 bg-chart-1/5',   texto: 'text-chart-1-text', icono: 'text-chart-1' },
    'chart-3': { caja: 'border-chart-3/30 bg-chart-3/5',   texto: 'text-chart-3-text', icono: 'text-chart-3' },
    'chart-4': { caja: 'border-chart-4/30 bg-chart-4/5',   texto: 'text-chart-4-text', icono: 'text-chart-4' },
    'chart-6': { caja: 'border-chart-6/30 bg-chart-6/5',   texto: 'text-chart-6-text', icono: 'text-chart-6' },
    'chart-9': { caja: 'border-chart-9/30 bg-chart-9/5',   texto: 'text-chart-9-text', icono: 'text-chart-9' },
};

// `onDark`: la MISMA razón por la que existe en `ListRow` y `Badge`. Un campo
// sobre el kiosco —oscuro en los cuatro temas— no puede sacar su superficie de
// los tokens de tema sin quedar claro sobre negro. La ANATOMÍA es la del
// canónico (alto, radio, aro de foco, área tocable); lo único bespoke es la
// paleta, igual que en los flyouts del sidebar.
const ON_DARK = {
    caja:   'bg-white/[0.06] border border-white/[0.12]',
    texto:  'text-white placeholder:text-white/35',
    icono:  'text-white/50',
    label:  'text-white/60',
};

const PortalInput = memo(({ icon: Icon, label, name, value, onChange, type = "text", placeholder, colSpan = 1, required = false, helperText, prefix, readOnly = false, maskType, hasError, errorMessage,
    // ── 2026-07-27 ──────────────────────────────────────────────────────
    // `labelAction`: una acción a la derecha de la etiqueta (`+ Agregar` en
    // teléfono, "usar el de la sucursal"). Al medir los inputs que faltaban
    // migrar aparecieron 37 que son ESTE componente reconstruido a mano, y lo
    // único que sobraba en varios era eso. Sin la ranura, cada uno seguía
    // escribiendo la etiqueta, el badge de error y el contenedor por su cuenta.
    labelAction,
    // `compact`: alto de 32px en vez de 40 y texto más chico, para las celdas
    // numéricas densas de las grillas (nómina, min/max) donde el campo va
    // dentro de una tabla y no como campo de formulario.
    compact = false,
    inputClassName = '',
    // `className` va al CONTENEDOR, no al `<input>` (para eso está
    // `inputClassName`). Lo necesitan las celdas de ancho fijo: `w-20`, `w-24`,
    // `flex-1`. Verificado antes de definirlo: cero llamadores lo usaban, así
    // que no cambia nada existente.
    className = '',
    // `tono`: el campo tintado con un color semántico o de categoría. Al medir
    // D3.4 aparecieron **33 inputs a mano en 16 archivos** que son exactamente
    // esto — el salario nuevo en verde, el MIN propuesto en naranja y el MAX en
    // azul, las cantidades recibidas en el color de su fila. Ninguno podía usar
    // el canónico porque solo sabía pintarse neutro, así que cada uno reescribía
    // también la etiqueta y el contenedor.
    //
    // Los valores son los de la paleta CERRADA (DESIGN.md §6.0): no agrega
    // ningún color, solo hace alcanzables desde el canónico los que ya existen.
    tono,
    onDark = false,
    // ── 2026-07-28: sin esto, D3.4 era una migración con trampa ──────────
    // El componente aceptaba una lista FIJA de props y tiraba todo lo demás.
    // Medido sobre los 104 `<input>` que faltan migrar: **54 (51%) usan al
    // menos un atributo que no estaba en la lista**. Los de arriba:
    //
    //     min 38 · aria-label 22 · step 18 · max 13 · ref 6 · inputMode 2
    //
    // O sea que migrar un campo de cantidad de nómina le habría quitado su
    // rango (`min`/`max`/`step`) y migrar los 22 con `aria-label` habría
    // borrado justo los nombres accesibles que D3.4 acababa de agregar. Sin
    // que fallara el build, ni el lint, ni el gate.
    //
    // `rest` va PRIMERO en el `<input>` a propósito: lo que el componente
    // gestiona (id, type, value, onChange, className, el estado de error) gana
    // siempre, y lo que pasa el llamador llena los huecos. La única excepción
    // es `aria-describedby`, que se fusiona más abajo — si el campo no está en
    // error, el valor del llamador tiene que sobrevivir.
    ...rest
}) => {
    const handleInputChange = (e) => {
        let val = e.target.value;
        if (maskType) val = applyInputMask(val, maskType);
        e.target.value = val;
        onChange(e);
    };

    const t = TONOS[tono];
    const od = onDark ? ON_DARK : null;
    const isMissing = required && !value?.trim();
    const isInvalid = hasError || isMissing;
    const errorClasses = isInvalid ? 'outline outline-2 outline-danger/50' : '';
    const messageId = name ? `${name}-message` : undefined;

    return (
        <div className={`col-span-1 ${colSpan === 2 ? 'md:col-span-2' : ''} ${className}`}>
            {/* La etiqueta es OPCIONAL desde el 2026-07-28, y esa ranura es la
                que faltaba. Al medir los 56 `<input>` que seguían a mano
                agrupándolos por anatomía, 43 resultaron ser este mismo campo:
                borde, fondo y redondeo idénticos. Lo único que los dejaba fuera
                era que acá el `<label>` se dibujaba siempre, y ellos no llevan
                etiqueta visible —el encabezado de su columna ya dice qué son—.
                O sea que no hacía falta otro canónico: hacía falta esta línea.

                Sin `label` el nombre accesible tiene que venir en `aria-label`
                (el gate lo exige en `input-sin-nombre`, cero absoluto), y el
                mensaje de error pasa a ser solo para lectores de pantalla: la
                señal visible es el borde rojo, que ya estaba. */}
            {label ? (
                <label htmlFor={name} className={`text-caption font-black uppercase tracking-widest ${od ? od.label : 'text-content-3'} ml-1 mb-1.5 flex items-center justify-between transition-colors`}>
                    <span className="flex items-center gap-1.5">
                        {label} {helperText && <span className="text-micro text-brand-text">{helperText}</span>}
                        {labelAction}
                    </span>
                    {isMissing && !hasError && <span id={messageId} className="text-danger font-bold bg-danger/10 px-2 py-0.5 rounded-md shadow-sm border border-danger/30">Requerido</span>}
                    {hasError && errorMessage && <span id={messageId} className="text-danger font-bold bg-danger/15 px-2 py-0.5 rounded-md shadow-sm border border-danger/40 flex items-center gap-1"><AlertCircle size={10} /> {errorMessage}</span>}
                </label>
            ) : isInvalid && (
                <span id={messageId} className="sr-only">
                    {hasError && errorMessage ? errorMessage : 'Requerido'}
                </span>
            )}
            {/* Sin `tono` manda la superficie del tema (`data-surface="input"`).
                Con `tono` NO se emite: esa regla de index.css va sin @layer, así
                que le gana a cualquier utilidad de Tailwind — el borde tintado
                no se vería. Tintado ⇒ el contenedor se pinta entero acá. */}
            {/* La caja medía 40px fijos, así que en un teléfono el campo quedaba
                bajo el piso del dedo (medido en iPhone 13 el 2026-07-29 dentro
                del modal de perfil: 3 campos a 296x38). `--tap-min` es 0 en
                escritorio y 44px en táctil, así que el `max()` sube solo donde
                hace falta. Es el mismo arreglo que necesitaron `LiquidSelect` y
                `SegmentedControl` — los tres tenían la altura escrita a mano.
                `compact` se queda en 32px a propósito: son las celdas de grilla
                densa de DESIGN.md §15.12. */}
            <div data-surface={(t || od) ? undefined : 'input'} className={`relative flex items-center ${compact ? 'h-8' : 'h-[max(40px,var(--tap-min))]'} z-base ${t ? `border rounded-input ${t.caja}` : ''} ${od ? `rounded-input ${od.caja}` : ''} ${readOnly ? 'opacity-80 cursor-not-allowed' : `${inputHoverClass} ${errorClasses}`}`}>
                {Icon && <div className={`absolute left-3 ${t?.icono ?? od?.icono ?? 'text-content-3'}`}><Icon size={14} strokeWidth={2.5} /></div>}
                {prefix && <div className="absolute left-3 text-content-3 font-black text-body">{prefix}</div>}
                <input
                    {...rest}
                    id={name}
                    type={type}
                    name={name}
                    value={value || ''}
                    onChange={handleInputChange}
                    placeholder={placeholder}
                    readOnly={readOnly}
                    disabled={readOnly}
                    required={required}
                    aria-required={required || undefined}
                    aria-invalid={isInvalid || undefined}
                    aria-describedby={isInvalid ? messageId : rest['aria-describedby']}
                    className={`w-full h-full bg-transparent ${compact ? 'text-body-sm' : 'text-body-xl'} font-bold ${t?.texto ?? od?.texto ?? 'text-content'} outline-none ${inputClassName} ${Icon ? 'pl-9 pr-4' : prefix ? 'pl-8 pr-4' : 'px-4'}`}
                />
                {readOnly && <Lock size={12} className="absolute right-3 text-content-3" />}
            </div>
        </div>
    );
});

export default PortalInput;
