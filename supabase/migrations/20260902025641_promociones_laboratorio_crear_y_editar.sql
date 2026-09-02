-- Crear y editar una promoción de laboratorio.
--
-- ── La sobrecarga vieja se BORRA, no se deja ────────────────────────────────
-- `get_promociones` pasó de (text) a (text, text). `CREATE OR REPLACE` con una
-- firma distinta no reemplaza: crea una función NUEVA y la vieja se queda con
-- sus permisos y su cuerpo desactualizado. Es exactamente lo que le pasó a
-- `update_proveedor_manual`, que quedó con dos sobrecargas y la revocación
-- alcanzó a una sola.
DROP FUNCTION IF EXISTS public.get_promociones(text);

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- crear_promocion_laboratorio
-- ─────────────────────────────────────────────────────────────────────────────
-- Todo en UNA transacción: la promoción, sus laboratorios, sus niveles y la
-- matriz de umbrales. Una promoción a medias —con niveles pero sin umbrales—
-- se leería en pantalla como un programa que nadie puede alcanzar.
--
-- Formato de los parámetros (jsonb, para no multiplicar argumentos):
--   p_niveles  [{"nivel":1,"monto":10}, {"nivel":2,"monto":20}, …]
--   p_umbrales [{"nivel":1,"branch_id":3,"umbral":4250}, …]
CREATE OR REPLACE FUNCTION public.crear_promocion_laboratorio(
    p_nombre       text,
    p_year_month   text,
    p_laboratorios integer[],
    p_niveles      jsonb,
    p_umbrales     jsonb,
    p_paga         text    DEFAULT NULL,
    p_supplier_id  integer DEFAULT NULL,
    p_nota         text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_id    bigint;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    IF nullif(btrim(coalesce(p_nombre,'')), '') IS NULL THEN
        RAISE EXCEPTION 'NOMBRE_REQUERIDO: la promoción necesita un nombre';
    END IF;
    IF coalesce(p_year_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'MES_INVALIDO: el mes se escribe como AAAA-MM';
    END IF;
    IF p_laboratorios IS NULL OR array_length(p_laboratorios, 1) IS NULL THEN
        RAISE EXCEPTION 'SIN_LABORATORIOS: elegí al menos un laboratorio';
    END IF;

    INSERT INTO public.promociones
        (nombre, estado, nota, creado_por, tipo, year_month, paga, supplier_id)
    VALUES
        (btrim(p_nombre), 'borrador', nullif(btrim(coalesce(p_nota,'')), ''),
         v_actor, 'laboratorio', p_year_month,
         nullif(btrim(coalesce(p_paga,'')), ''), p_supplier_id)
    RETURNING id INTO v_id;

    PERFORM public.promocion_log(v_id, NULL, NULL, 'creada', NULL,
        btrim(p_nombre), 'laboratorio · ' || p_year_month);

    PERFORM public.escribir_niveles_promocion(v_id, p_laboratorios, p_niveles, p_umbrales);

    RETURN json_build_object('id', v_id, 'tipo', 'laboratorio', 'estado', 'borrador');
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- escribir_niveles_promocion — el cuerpo que comparten crear y editar
-- ─────────────────────────────────────────────────────────────────────────────
-- Está aparte porque crear y editar hacen LO MISMO con los niveles: reemplazar
-- el juego entero. Tenerlo dos veces es cómo dos validaciones que deberían ser
-- la misma terminan divergiendo.
--
-- ⚠️ Valida que los umbrales de cada sala SUBAN con el nivel. La lectura
-- resuelve el nivel alcanzado con `max(nivel) WHERE umbral <= venta`, y con un
-- nivel 3 más barato que el 2 esa cuenta premiaría un nivel que la sala no
-- alcanzó. La lectura puede ser simple porque acá no entra el caso raro.
CREATE OR REPLACE FUNCTION public.escribir_niveles_promocion(
    p_id           bigint,
    p_laboratorios integer[],
    p_niveles      jsonb,
    p_umbrales     jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_mal record;
BEGIN
    IF jsonb_typeof(coalesce(p_niveles, 'null'::jsonb)) <> 'array'
       OR jsonb_array_length(p_niveles) = 0 THEN
        RAISE EXCEPTION 'SIN_NIVELES: la promoción necesita al menos un nivel';
    END IF;
    IF jsonb_typeof(coalesce(p_umbrales, 'null'::jsonb)) <> 'array'
       OR jsonb_array_length(p_umbrales) = 0 THEN
        RAISE EXCEPTION 'SIN_UMBRALES: hay que decir cuánto necesita cada sala';
    END IF;

    DELETE FROM public.promocion_laboratorio   WHERE promocion_id = p_id;
    DELETE FROM public.promocion_nivel_umbral  WHERE promocion_id = p_id;
    DELETE FROM public.promocion_nivel         WHERE promocion_id = p_id;

    INSERT INTO public.promocion_laboratorio (promocion_id, laboratorio_id)
    SELECT DISTINCT p_id, x FROM unnest(p_laboratorios) x
     WHERE EXISTS (SELECT 1 FROM public.laboratorios l WHERE l.id = x);

    IF NOT EXISTS (SELECT 1 FROM public.promocion_laboratorio WHERE promocion_id = p_id) THEN
        RAISE EXCEPTION 'SIN_LABORATORIOS: ninguno de los laboratorios existe';
    END IF;

    INSERT INTO public.promocion_nivel (promocion_id, nivel, monto_por_persona)
    SELECT p_id,
           (n ->> 'nivel')::smallint,
           round((n ->> 'monto')::numeric, 2)
      FROM jsonb_array_elements(p_niveles) n;

    INSERT INTO public.promocion_nivel_umbral (promocion_id, nivel, branch_id, umbral_venta)
    SELECT p_id,
           (u ->> 'nivel')::smallint,
           (u ->> 'branch_id')::bigint,
           round((u ->> 'umbral')::numeric, 2)
      FROM jsonb_array_elements(p_umbrales) u;

    -- Todo umbral tiene que nombrar un nivel que exista.
    IF EXISTS (
        SELECT 1 FROM public.promocion_nivel_umbral nu
         WHERE nu.promocion_id = p_id
           AND NOT EXISTS (SELECT 1 FROM public.promocion_nivel nv
                            WHERE nv.promocion_id = p_id AND nv.nivel = nu.nivel)
    ) THEN
        RAISE EXCEPTION 'NIVEL_INEXISTENTE: hay un umbral para un nivel que no está definido';
    END IF;

    -- Los umbrales de cada sala suben con el nivel. Ver el comentario de arriba.
    SELECT b.name AS sala, x.nivel INTO v_mal
      FROM (
        SELECT nu.branch_id, nu.nivel, nu.umbral_venta,
               lag(nu.umbral_venta) OVER (PARTITION BY nu.branch_id ORDER BY nu.nivel) AS anterior
          FROM public.promocion_nivel_umbral nu
         WHERE nu.promocion_id = p_id
      ) x
      JOIN public.branches b ON b.id = x.branch_id
     WHERE x.anterior IS NOT NULL AND x.umbral_venta <= x.anterior
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
          'UMBRAL_NO_SUBE: en % el nivel % no pide más venta que el anterior; un nivel más alto tiene que costar más',
          v_mal.sala, v_mal.nivel;
    END IF;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- editar_promocion_laboratorio
-- ─────────────────────────────────────────────────────────────────────────────
-- Un mes ya CONGELADO no se toca: cambiarle el umbral a un mes cerrado le
-- cambiaría el bono a alguien que ya cobró. Es la regla «sin retroactividad»
-- de §9c, y acá es un freno y no una costumbre.
CREATE OR REPLACE FUNCTION public.editar_promocion_laboratorio(
    p_id           bigint,
    p_nombre       text,
    p_laboratorios integer[],
    p_niveles      jsonb,
    p_umbrales     jsonb,
    p_paga         text    DEFAULT NULL,
    p_supplier_id  integer DEFAULT NULL,
    p_nota         text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_pm    public.promociones%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_pm FROM public.promociones WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: la promoción % no existe', p_id; END IF;
    IF v_pm.tipo <> 'laboratorio' THEN
        RAISE EXCEPTION 'OTRO_TIPO: la promoción % es por producto', p_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.promocion_cierre_sala WHERE promocion_id = p_id) THEN
        RAISE EXCEPTION 'MES_CERRADO: % ya cerró y sus números están congelados', v_pm.year_month;
    END IF;

    IF nullif(btrim(coalesce(p_nombre,'')), '') IS NULL THEN
        RAISE EXCEPTION 'NOMBRE_REQUERIDO: la promoción necesita un nombre';
    END IF;

    UPDATE public.promociones
       SET nombre      = btrim(p_nombre),
           nota        = nullif(btrim(coalesce(p_nota,'')), ''),
           paga        = nullif(btrim(coalesce(p_paga,'')), ''),
           supplier_id = p_supplier_id,
           updated_at  = now()
     WHERE id = p_id;

    PERFORM public.escribir_niveles_promocion(p_id, p_laboratorios, p_niveles, p_umbrales);

    PERFORM public.promocion_log(p_id, NULL, NULL, 'editada',
        v_pm.nombre, btrim(p_nombre),
        'niveles y umbrales reescritos');

    RETURN json_build_object('id', p_id, 'tipo', 'laboratorio');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.escribir_niveles_promocion(bigint, integer[], jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.escribir_niveles_promocion(bigint, integer[], jsonb, jsonb)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.crear_promocion_laboratorio(text, text, integer[], jsonb, jsonb, text, integer, text)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_promocion_laboratorio(text, text, integer[], jsonb, jsonb, text, integer, text)
    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.editar_promocion_laboratorio(bigint, text, integer[], jsonb, jsonb, text, integer, text)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.editar_promocion_laboratorio(bigint, text, integer[], jsonb, jsonb, text, integer, text)
    TO authenticated, service_role;
