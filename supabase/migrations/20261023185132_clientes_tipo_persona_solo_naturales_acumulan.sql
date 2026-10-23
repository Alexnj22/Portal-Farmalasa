-- Reglamento Puntos Salud v2, cláusula 2.2 (vigente el 2026-11-15): el
-- programa es sólo para personas naturales. Hasta hoy acumulaban también
-- empresas e instituciones (DIHARE SA DE CV, ISSS, una asociación…), porque la
-- ficha del cliente no decía qué era.
--
-- Decisión del usuario (2026-10-23): un selector de tipo de persona en la
-- ficha, que se prellena SOLO; lo que es seguro se decide solo, y lo dudoso
-- se avisa para que alguien lo evalúe.
--
--   · forma legal en el nombre (S.A. DE C.V., ASOCIACIÓN, ISSS…) → jurídica
--   · nombre de negocio (FARMACIA, CLÍNICA, FERRETERÍA…)          → natural, y
--     `tipo_persona_revisar`: muchas farmacias y clínicas son de una persona
--     natural que comercia con ese nombre, así que no se decide por el nombre
--   · lo demás                                                    → natural
--
-- Medido sobre 28,900 fichas: 50 jurídicas y 14 para evaluar. El NIT no sirve
-- para distinguir (una persona con NIT viejo tiene la misma forma que una
-- sociedad), ni la categoría «Contribuyente» (casi todas son personas).
--
-- Lo decidido a mano (`tipo_persona_manual_at`) nunca lo pisa la regla.
-- `tipo_persona` arranca en 'natural' con default constante: agregar la
-- columna no reescribe la tabla.
SET lock_timeout = '5s';

-- ── La regla, una sola vez ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tipo_persona_sugerido(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN n ~ '(\mS\.?\s?A\.?\s*\.?\s*(DE\s*)?C\.?\s?V\M|,\s*S\.?\s?A\.?\s*$|\mS\.?\s?A\.?\s?S\.?(\s|$|,)|\mSOCIEDAD\M|\mDE\s+R\.?\s?L\M|\mASOC(IACION)?\M|\mFUNDACION\M|\mCOOPERATIVA\M|\mALCALDIA\M|\mMINISTERIO\M|\mISSS\M|\mIGLESIA\M|\mUNIVERSIDAD\M|\mCOLEGIO\M|\mESCUELA\M|\mCOMITE\M|\mADESCO\M|\mCORPORACION\M|\mGOBIERNO\M|FONDO\s?CIRCULANTE|\mINSTITUTO\M|\mBANCO\M|\mASEGURADORA\M|\mSEGUROS?\M)'
      THEN 'juridica'
    WHEN n ~ '(\mFARMACIA|\mCLINICA|\mLABORATORIO|\mDISTRIBUIDORA\M|\mGRUPO\M|\mINVERSIONES\M|\mFUNERARIA\M|\mFUNERALES\M|\mCENTRO\s+MEDICO|\mHOSPITAL\M|\mCONSTRUCTORA\M|\mBOTIQUIN\M|\mEMPRESA|\mCOMERCIAL\M|\mSERVICIOS\M|\mFERRETERIA\M|\mAGROSERVICIO|\mCLUB\M|\mDROGUERIA\M|\mDESPENSA\M)'
      THEN 'duda'
    ELSE 'natural'
  END
  -- Sin `unaccent` a propósito: es STABLE y la función dejaría de ser IMMUTABLE.
  FROM (SELECT translate(upper(coalesce(p_nombre, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS n) x;
$$;
REVOKE EXECUTE ON FUNCTION public.tipo_persona_sugerido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tipo_persona_sugerido(text) TO authenticated, service_role;

-- ── La ficha ────────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tipo_persona text NOT NULL DEFAULT 'natural'
    CONSTRAINT customers_tipo_persona_check CHECK (tipo_persona IN ('natural', 'juridica')),
  ADD COLUMN IF NOT EXISTS tipo_persona_revisar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tipo_persona_manual_at timestamptz,
  ADD COLUMN IF NOT EXISTS tipo_persona_manual_por uuid;
COMMENT ON COLUMN public.customers.tipo_persona IS
  'natural | juridica. Sólo la persona natural acumula puntos (Reglamento v2, 2.2). Lo prellena tipo_persona_sugerido(); lo decidido a mano no se pisa.';
COMMENT ON COLUMN public.customers.tipo_persona_revisar IS
  'Nombre de negocio: falta que una persona decida si es natural o jurídica. Lo avisa puntos_vigilar_irregularidades.';
CREATE INDEX IF NOT EXISTS customers_tipo_persona_revisar_idx
  ON public.customers (id) WHERE tipo_persona_revisar;

-- Las que ya existen.
UPDATE public.customers c
   SET tipo_persona = CASE s.t WHEN 'juridica' THEN 'juridica' ELSE 'natural' END,
       tipo_persona_revisar = (s.t = 'duda')
  FROM (SELECT id, public.tipo_persona_sugerido(name) AS t FROM public.customers) s
 WHERE s.id = c.id AND s.t <> 'natural';

-- Las nuevas, y las que cambian de nombre, se clasifican solas.
CREATE OR REPLACE FUNCTION public.customers_tipo_persona()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE v text;
BEGIN
  IF NEW.tipo_persona_manual_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name THEN RETURN NEW; END IF;
  v := public.tipo_persona_sugerido(NEW.name);
  NEW.tipo_persona := CASE v WHEN 'juridica' THEN 'juridica' ELSE 'natural' END;
  NEW.tipo_persona_revisar := (v = 'duda');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.customers_tipo_persona() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customers_tipo_persona ON public.customers;
CREATE TRIGGER customers_tipo_persona
  BEFORE INSERT OR UPDATE OF name ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_tipo_persona();

-- ── El selector ─────────────────────────────────────────────────────────────
-- Quien puede dar o quitar puntos decide; desde ahí la regla ya no la toca.
CREATE OR REPLACE FUNCTION public.cliente_tipo_persona_guardar(p_customer_id bigint, p_tipo text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_ajustar', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar el tipo de persona.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('natural', 'juridica') THEN
    RAISE EXCEPTION 'El tipo de persona es «natural» o «juridica».';
  END IF;
  UPDATE public.customers
     SET tipo_persona = p_tipo, tipo_persona_revisar = false,
         tipo_persona_manual_at = now(), tipo_persona_manual_por = public.auth_employee_id()
   WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el cliente %.', p_customer_id; END IF;
  RETURN json_build_object('ok', true, 'tipo_persona', p_tipo);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cliente_tipo_persona_guardar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_tipo_persona_guardar(bigint, text) TO authenticated, service_role;

-- ── La vigencia ─────────────────────────────────────────────────────────────
ALTER TABLE public.puntos_config ADD COLUMN IF NOT EXISTS solo_personas_naturales_desde date;
COMMENT ON COLUMN public.puntos_config.solo_personas_naturales_desde IS
  'Desde esta fecha de venta, una ficha jurídica no acumula (Reglamento v2, 2.2). NULL = apagado.';
UPDATE public.puntos_config SET solo_personas_naturales_desde = DATE '2026-11-15';

-- ── El aviso inicial: uno solo, no catorce ─────────────────────────────────
-- La vigilancia avisa cada ficha nueva por evaluar. Las que ya existen se
-- anotan como avisadas y se manda UN resumen, para no llenar de golpe la
-- bandeja de quien recibe los avisos de puntos.
INSERT INTO public.puntos_irregularidad (clave, tipo, dia, customer_id, nota, avisado_at)
SELECT 'persona:' || c.id, 'persona_por_evaluar', (now() AT TIME ZONE 'America/El_Salvador')::date, c.id,
       'Su nombre parece de un negocio: hay que decidir si es persona natural o jurídica', now()
  FROM public.customers c
 WHERE c.tipo_persona_revisar
ON CONFLICT (clave) DO NOTHING;

DO $$
DECLARE v_dest uuid[]; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.customers WHERE tipo_persona_revisar;
  IF v_n = 0 THEN RETURN; END IF;
  SELECT ARRAY[e.id] INTO v_dest
    FROM public.puntos_config pc JOIN public.employees e ON e.id = pc.avisar_fallas_a
   WHERE pc.id AND e.status = 'ACTIVO';
  IF v_dest IS NULL THEN
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e WHERE e.status = 'ACTIVO' AND e.role_id IN (2, 3);
  END IF;
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'PUNTOS_IRREGULAR',
      'Puntos: fichas por evaluar',
      format('%s fichas tienen nombre de negocio. Hay que decidir si cada una es persona natural o jurídica: desde el 15 de noviembre sólo acumula la persona natural.', v_n),
      '/puntos?tab=avisos', jsonb_build_object('check_key', 'puntos_personas_por_evaluar_inicial'), true, NULL);
  END IF;
END $$;
