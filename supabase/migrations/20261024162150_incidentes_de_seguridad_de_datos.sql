-- ═══════════════════════════════════════════════════════════════════════════
-- 50 · Registro de incidentes de seguridad de datos personales (Art. 25 LPDP)
--
-- QUÉ CAMBIA: tabla nueva `incidentes_datos` + aviso a quien edita el módulo
--   `datos_personales` (los mismos que atienden las solicitudes):
--     · al registrarse (trigger), «72 horas para notificar»;
--     · a las 48 h si falta alguna de las tres notificaciones;
--     · al pasar las 72 h sin las tres (CRÍTICO también en la bitácora).
--   Las tres notificaciones del Art. 25: Agencia de Ciberseguridad del Estado,
--   Fiscalía General de la República y los titulares afectados. Y lo que el
--   mismo artículo manda documentar: fecha, motivo, hechos, efectos, medidas.
--
-- DESDE CUÁNDO RIGE: la ley ya rige; no depende de reglas_v2_desde().
--
-- CRON NUEVO `avisar-incidentes-datos` cada hora al minuto 7: el plazo es de
--   horas, un aviso diario llegaría con un día de atraso. Lee una tabla que
--   normalmente está vacía (0 peticiones al sistema de origen). Se crea sólo
--   si no existe. AL APLICAR EN PRODUCCIÓN, en el mismo commit, declararlo en
--   `scripts/eficiencia-gate.mjs` (CRONS):
--     { job: 'avisar-incidentes-datos', slug: null, cadencia: '7 * * * *',
--       corridasDia: 24, sistema: 0, motivo: 'Las 72 horas del Art. 25: cada hora porque
--       el plazo es de horas. Lee una tabla casi siempre vacía.' },
--   y correr `npm run tipos:base`.
--
-- POLICIES: SELECT con can_view, INSERT/UPDATE con can_edit de
--   `datos_personales` (envueltas en SELECT). INSERT exige además que quien
--   registra sea quien dice (`registrado_por = auth_employee_id()`). Sin
--   DELETE: es un registro que la ley pone a disposición de la autoridad.
--
-- VERIFICADO en staging: alta → aviso inmediato; detectado hace 50 h sin
--   notificar → aviso «apremia» una vez; hace 73 h → «vencido» una vez y fila
--   CRITICAL en audit_logs; con las tres fechas puestas → no avisa.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.incidentes_datos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detectado_at            timestamptz NOT NULL,
  ocurrido_at             timestamptz,
    registrado_por          uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
  naturaleza              text NOT NULL CHECK (btrim(naturaleza) <> ''),
  datos_comprometidos     text NOT NULL CHECK (btrim(datos_comprometidos) <> ''),
  afectados               text,
  medidas_inmediatas      text,
  recomendaciones         text,
  notificado_agencia_at   timestamptz,
  notificado_fiscalia_at  timestamptz,
  notificado_titulares_at timestamptz,
  medidas_definitivas     text,
  cerrado_at              timestamptz,
  notas                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- (Aplicada en dos partes: `apply_migration` rechazaba la migración entera con
-- «Invalid or expired requestState». La segunda mitad —índice, RLS, avisos y
-- cron— es 20261024162222_incidentes_datos_policies_avisos_y_cron.sql.)
