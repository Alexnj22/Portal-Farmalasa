-- El bono de meta de una sala, SIN la pregunta de permisos.
--
-- `get_bono_meta_sala` pregunta primero «¿quién llama?» y devuelve NULL si no
-- hay sesión. Eso la deja inservible para el cierre del mes, que corre en un
-- cron sin sesión — y el cierre tiene que fotografiar el bono de cada persona
-- (docs/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md): recalcularlo después usa el
-- personal ACTIVO de hoy, así que quien se fue desaparece de su propio mes.
--
-- El cuerpo NO se transcribe: se toma de `pg_proc.prosrc` en el momento de
-- aplicar y se le quita exactamente el bloque de permisos. Si el bloque no
-- aparece una sola vez tal cual, la migración aborta sin escribir nada.
-- La pública queda como envoltorio: resuelve la sala por permiso y delega.

SET lock_timeout = '5s';

DO $mig$
DECLARE
    v_src   text;
    v_auth  text := $b$    IF NOT auth_has_module_permission('metas', 'can_view') THEN
        RETURN NULL;
    END IF;

    -- Scope BRANCH: solo su propia sala, el parámetro se ignora.
    IF auth_module_scope('metas') = 'ALL' THEN
        v_branch := p_branch_id;
    ELSE
        v_branch := auth_employee_branch_id();
    END IF;$b$;
    v_nuevo text;
BEGIN
    SELECT prosrc INTO v_src FROM pg_proc
     WHERE oid = 'public.get_bono_meta_sala(bigint,text)'::regprocedure;

    IF (length(v_src) - length(replace(v_src, v_auth, ''))) / length(v_auth) <> 1 THEN
        RAISE EXCEPTION 'CUERPO_INESPERADO: el bloque de permisos de get_bono_meta_sala no aparece exactamente una vez';
    END IF;

    v_nuevo := replace(v_src, v_auth,
        '    -- Sin permisos: los decide quien llama (get_bono_meta_sala o el cierre).' || chr(10) ||
        '    v_branch := p_branch_id;');

    EXECUTE format($f$
CREATE OR REPLACE FUNCTION public.bono_meta_sala_interno(p_branch_id bigint, p_year_month text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS %L$f$, v_nuevo);
END
$mig$;

REVOKE EXECUTE ON FUNCTION public.bono_meta_sala_interno(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bono_meta_sala_interno(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_bono_meta_sala(p_branch_id bigint, p_year_month text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
BEGIN
    IF NOT auth_has_module_permission('metas', 'can_view') THEN
        RETURN NULL;
    END IF;

    -- Scope BRANCH: solo su propia sala, el parámetro se ignora.
    IF auth_module_scope('metas') = 'ALL' THEN
        v_branch := p_branch_id;
    ELSE
        v_branch := auth_employee_branch_id();
    END IF;
    IF v_branch IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN public.bono_meta_sala_interno(v_branch, p_year_month);
END;
$function$;
