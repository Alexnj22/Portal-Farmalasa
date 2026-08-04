SET lock_timeout = '5s';

-- Aprobar registrando la autorización del gerente (2026-08-04, pedido del
-- usuario): el gerente dice que sí de palabra y el supervisor lo deja asentado.
--
-- La autoría NO se inventa: `gerente_por` sigue siendo QUIEN EJECUTÓ la acción
-- en el portal, y `autorizado_por` dice QUIÉN la autorizó. Nunca se escribe al
-- gerente como si hubiera entrado él.
ALTER TABLE public.metas_sucursal
  ADD COLUMN IF NOT EXISTS autorizado_por  uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS autorizado_nota text;

CREATE INDEX IF NOT EXISTS idx_metas_sucursal_autorizado_por
  ON public.metas_sucursal(autorizado_por);

COMMENT ON COLUMN public.metas_sucursal.autorizado_por IS
  'Aprobación por autorización verbal: quién la autorizó. `gerente_por` sigue siendo quien la ejecutó en el portal.';
COMMENT ON COLUMN public.metas_sucursal.autorizado_nota IS
  'Cómo y cuándo se dio esa autorización, en palabras de quien la registra.';

-- Quiénes pueden figurar como autorizantes. Sale de una función y no de la
-- tabla de empleados directo: el listado de gerentes no debería depender de
-- que quien registra pueda leer el expediente de nadie.
CREATE OR REPLACE FUNCTION public.get_metas_autorizadores()
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.id, e.name
  FROM public.employees e
  JOIN public.roles r ON r.id = e.role_id OR r.id = e.secondary_role_id
  WHERE r.name = 'Gerente General' AND e.status = 'ACTIVO'
  ORDER BY e.name;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_metas_autorizadores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_metas_autorizadores() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aprobar_meta_por_autorizacion(
  p_id bigint, p_autorizo uuid, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_yo uuid;
  v_autoriza_nombre text;
  v_yo_nombre text;
  v_pendientes integer;
BEGIN
  -- Basta con `can_edit`: quien ya tiene `can_approve` aprueba directo y no
  -- necesita este camino.
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;

  v_yo := public.auth_employee_id();
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_EMPLEADO: no se pudo resolver quién registra'; END IF;

  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado <> 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;

  -- El autorizante tiene que SER un gerente activo, y no puede ser uno mismo:
  -- si no, esto deja de ser una autorización y es una firma propia.
  SELECT a.name INTO v_autoriza_nombre FROM public.get_metas_autorizadores() a WHERE a.id = p_autorizo;
  IF v_autoriza_nombre IS NULL THEN
    RAISE EXCEPTION 'AUTORIZANTE_INVALIDO: quien autoriza debe ser un gerente activo';
  END IF;
  IF p_autorizo = v_yo THEN
    RAISE EXCEPTION 'AUTORIZANTE_INVALIDO: no podés registrarte a vos mismo como quien autoriza';
  END IF;
  IF p_nota IS NULL OR btrim(p_nota) = '' THEN
    RAISE EXCEPTION 'NOTA_REQUERIDA: hay que dejar dicho cómo se dio la autorización';
  END IF;

  UPDATE public.metas_sucursal
  SET estado          = 'oficial',
      gerente_por     = v_yo,          -- quien EJECUTÓ
      gerente_at      = now(),
      autorizado_por  = p_autorizo,    -- quien AUTORIZÓ
      autorizado_nota = btrim(p_nota)
  WHERE id = p_id;

  SELECT e.name INTO v_yo_nombre FROM public.employees e WHERE e.id = v_yo;

  -- El control que hace esto defendible: el gerente se entera en el momento y
  -- puede desmentirlo. Sin este aviso, «el gerente autorizó» es sólo un dicho.
  PERFORM public.notify_employees(
    ARRAY[p_autorizo], 'METAS_AUTORIZACION_REGISTRADA',
    'Se registró tu autorización',
    COALESCE(v_yo_nombre, 'Un supervisor') || ' dejó oficial la meta de '
      || public.metas_mes_label(v_row.year_month)
      || ' diciendo que vos la autorizaste. Si no fue así, avisá.',
    '/metas?tab=confirmacion');

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado <> 'oficial';
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_APROBADAS',
      'Metas aprobadas',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' quedaron oficiales. Cada sala verá la suya.');
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aprobar_meta_por_autorizacion(bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_meta_por_autorizacion(bigint, uuid, text) TO authenticated, service_role;
