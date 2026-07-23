import React, { memo } from 'react';

// Badge compartido — Fase T3 (AUDITORIA-TEMA-2026-07.md §9.1: 214 ocurrencias
// inline hoy, paleta hardcodeada por vista). Normal-case (misma decisión que
// Button, misma comparación lado a lado en la lámina T2.3). Colores
// verificados AA sobre su propio tinte (contrast-check.mjs): success 4.79:1,
// warning 5.80:1, danger 6.03:1, info 5.59:1.
const VARIANT_CLASSES = {
    success: 'text-[#0a7a46] bg-gradient-to-b from-success/[0.16] to-success/[0.09] border-success/30',
    warning: 'text-[#9a4507] bg-gradient-to-b from-warning/[0.18] to-warning/[0.09] border-warning/30',
    danger:  'text-[#a6291e] bg-gradient-to-b from-danger/[0.16] to-danger/[0.09] border-danger/30',
    info:    'text-brand bg-gradient-to-b from-brand/[0.16] to-brand/[0.09] border-brand/30',
    neutral: 'text-content-2 bg-gradient-to-b from-surface-card-hover to-surface-card border-border-card',
};

const DOT_CLASSES = {
    success: 'bg-success shadow-[0_0_6px_var(--success)]',
    warning: 'bg-warning shadow-[0_0_6px_var(--warning)]',
    danger:  'bg-danger shadow-[0_0_6px_var(--danger)]',
    info:    'bg-brand shadow-[0_0_6px_var(--brand)]',
    neutral: 'bg-content-3',
};

const Badge = memo(({ variant = 'neutral', dot = false, icon: Icon, className = '', children }) => (
    <span className={`inline-flex items-center gap-1.5 rounded-badge border font-bold text-[11px]
        tracking-[-0.005em] px-2.5 py-[3px]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]
        ${VARIANT_CLASSES[variant] || VARIANT_CLASSES.neutral}
        ${className}`}>
        {dot && <span className={`w-[6px] h-[6px] rounded-full ${DOT_CLASSES[variant] || DOT_CLASSES.neutral}`} />}
        {Icon && <Icon size={11} strokeWidth={2.5} />}
        {children}
    </span>
));

export default Badge;
