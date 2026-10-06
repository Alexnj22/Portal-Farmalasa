-- Widget «Reservas de mi sala» (2026-10-06): lo ven los mismos cargos que ven
-- los cortes de su sala, con el mismo alcance. Idempotente.
INSERT INTO public.role_permissions (module_key, can_view, can_edit, can_approve, role_id, scope)
SELECT 'dash_reservas', true, true, false, rp.role_id, rp.scope
  FROM public.role_permissions rp
 WHERE rp.module_key = 'dash_cortes_sala' AND rp.can_view
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = rp.role_id AND x.module_key = 'dash_reservas');
