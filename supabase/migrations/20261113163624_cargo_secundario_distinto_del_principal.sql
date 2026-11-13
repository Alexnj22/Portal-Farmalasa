-- El cargo secundario nunca es el mismo que el principal (2026-11-13).
-- Una ficha (Juan Antonio Díaz Ramírez) tenía «Referente de Farmacovigilancia»
-- en los dos: el formulario ofrecía el principal también como secundario. El
-- usuario: «eso es un error. el principal regente el secundario farmaco».
--   · Esa ficha: principal Regente (8), secundario Referente (9). Guardado por
--     id Y por el valor de hoy: en cualquier otra base (pruebas) no toca nada.
--   · Cualquier otra ficha con los dos iguales pierde el secundario repetido.
--   · Y un CHECK, para que la base lo rechace aunque un formulario se equivoque.
SET lock_timeout = '5s';

UPDATE public.employees SET role_id = 8, secondary_role_id = 9
 WHERE id = 'cb00a5a4-a76e-47d3-bc48-b954cea788d7' AND role_id = 9 AND secondary_role_id = 9;

UPDATE public.employees SET secondary_role_id = NULL WHERE secondary_role_id = role_id;

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_cargo_secundario_distinto;
ALTER TABLE public.employees ADD CONSTRAINT employees_cargo_secundario_distinto
  CHECK (secondary_role_id IS NULL OR secondary_role_id IS DISTINCT FROM role_id);

INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, details)
SELECT NULL, 'Sistema', 'CAMBIO_CARGO', 'cb00a5a4-a76e-47d3-bc48-b954cea788d7', 'ADMIN_PANEL', 'INFO',
       jsonb_build_object('antes', jsonb_build_object('role_id', 9, 'secondary_role_id', 9),
                          'despues', jsonb_build_object('role_id', 8, 'secondary_role_id', 9),
                          'motivo', 'principal Regente, secundario Referente de Farmacovigilancia (pedido del usuario 2026-11-13)')
 WHERE EXISTS (SELECT 1 FROM public.employees WHERE id = 'cb00a5a4-a76e-47d3-bc48-b954cea788d7' AND role_id = 8);
