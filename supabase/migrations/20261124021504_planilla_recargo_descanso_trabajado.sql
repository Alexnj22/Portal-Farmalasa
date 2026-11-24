-- El descanso trabajado en su propio renglón de la planilla (2026-11-23).
-- Hasta hoy el recargo del día de descanso trabajado (CT Arts. 175 y 176: las
-- horas × 1,5 y un día compensatorio) iba sumado en `holiday_surcharge`
-- («Recargo de asuetos», CT Art. 192). Ahora cada uno va en el suyo; los dos
-- son no sujetos a retención y suman lo mismo que el renglón único de antes.
-- Aditiva: columna nueva con default constante (sin reescribir la tabla).
-- Producción no tenía filas en payroll_entries: no hay nada que repartir.
SET lock_timeout = '5s';
ALTER TABLE public.payroll_entries ADD COLUMN IF NOT EXISTS recargo_descanso_trabajado numeric(10,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.payroll_entries.recargo_descanso_trabajado IS 'Recargo por día de descanso trabajado (CT Arts. 175 y 176): horas × 1,5 sobre el básico por hora, con su extra y nocturno. No sujeto a retención. Antes iba sumado en holiday_surcharge (hasta 2026-11-23).';
