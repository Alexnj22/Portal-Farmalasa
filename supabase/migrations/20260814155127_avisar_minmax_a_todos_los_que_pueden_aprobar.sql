-- El aviso de una solicitud de Min/Max deja de ir a un cargo escrito a mano.
--
-- `get_minmax_approver_ids()` armaba la lista con `role_id = 13` (Supervisor/a
-- de Ventas) fijo en el cuerpo, sin mirar `role_permissions` ni una sola vez.
-- O sea que el interruptor «Min / Max» de la tarjeta «Decidir solicitudes» NO
-- gobernaba a quién se le avisa: encendido o apagado, el aviso iba al cargo 13.
--
-- Medido el 2026-08-14: la solicitud de descarte f5ca7417 avisó a Edwin, a
-- Celina Escobar (Jefe/a de Talento Humano) y a QA Testing —esa pasa por
-- `approval_requests`, que el 2026-08-12 aprendió a avisarle a todo el que
-- puede aprobar—, mientras que las de Min/Max #43 a #49 avisaron SÓLO a Edwin.
-- El permiso estaba bien: `puede_aprobar_modulo(celina,'requests_minmax')`
-- devolvía true y ella podía decidirlas. Nadie se lo decía.
--
-- Son dos tablas con dos disparadores: `approval_requests` →
-- `notificar_solicitud_creada` (arreglado) y `minmax_change_requests` →
-- `notificar_solicitud_minmax` (éste). Arreglar uno no arregla al otro, y por
-- eso el defecto sobrevivió dos días a su propia corrección.
--
-- ── El fallback viejo queda superado, no perdido ──────────────────────────
-- La versión anterior filtraba a quien tuviera VACATION/DISABILITY/PERMIT hoy
-- y, si no quedaba ningún supervisor, caía al cargo padre. Esa era una regla
-- de delegación paralela, escrita antes de que existiera la de verdad:
-- `puede_aprobar_modulo` ya llama a `hereda_por_ausencia_rol`, y los cuatro
-- cargos con `can_approve` sobre `requests_minmax` tienen `delega_en_ausencia`
-- encendido (verificado). Dos definiciones de lo mismo garantizan que dentro de
-- un mes digan cosas distintas.
--
-- Consecuencia a la vista: la lista ya no descuenta al que está de vacaciones.
-- Es el mismo criterio que usa `notificar_solicitud_creada` para todas las
-- demás familias — si algún día se decide filtrar por disponibilidad, va en las
-- dos, no en una.

SET lock_timeout = '5s';

-- ── 1 · Quién puede decidir un Min/Max sale del registro de permisos ──────
CREATE OR REPLACE FUNCTION public.get_minmax_approver_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT coalesce(array_agg(e.id ORDER BY e.id), ARRAY[]::uuid[])
  FROM public.employees e
  WHERE e.status = 'ACTIVO'
    AND public.puede_aprobar_modulo(e.id, 'requests_minmax');
$$;

REVOKE EXECUTE ON FUNCTION public.get_minmax_approver_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_minmax_approver_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_minmax_approver_ids() IS
  'Todos los empleados ACTIVOS que hoy pueden aprobar requests_minmax: por su cargo, por el secundario o por delegacion de un cargo ausente. Sale de role_permissions, NO de un role_id escrito a mano.';

-- ── 2 · Que no se avise a si mismo ────────────────────────────────────────
-- `notificar_solicitud_creada` ya excluye a quien la pidió (`s.x <>
-- NEW.employee_id`); acá el pedidor podía estar en la lista y recibir el aviso
-- de su propia solicitud. Con `IS DISTINCT FROM` un `requested_by_id` nulo no
-- descarta a nadie.
--
-- El reemplazo sale de `pg_proc.prosrc` y no de una transcripción: así lo que
-- se modifica es la versión VIVA, con lo que haya dejado cualquier otra sesión.
-- Y el conteo antes del `replace()` no es decorativo — un replace que no
-- encuentra nada devuelve el texto intacto y la migración diría «listo» sin
-- haber hecho nada.
DO $mig$
DECLARE
  v_src   text;
  v_viejo text := 'v_dest := public.get_minmax_approver_ids();';
  v_nuevo text := 'v_dest := ARRAY(SELECT x FROM unnest(public.get_minmax_approver_ids()) AS x '
               || 'WHERE x IS DISTINCT FROM NEW.requested_by_id);';
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'notificar_solicitud_minmax';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'No existe notificar_solicitud_minmax().';
  END IF;

  IF (length(v_src) - length(replace(v_src, v_viejo, ''))) / length(v_viejo) <> 1 THEN
    RAISE EXCEPTION 'Esperaba UNA aparicion de "%" y no la encontre asi. Alguien toco el bloque de destinatarios: revisar antes de reemplazar a ciegas.', v_viejo;
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.notificar_solicitud_minmax() '
    'RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER '
    'SET search_path TO ''public'', ''extensions'' AS %L',
    replace(v_src, v_viejo, v_nuevo));
END
$mig$;
