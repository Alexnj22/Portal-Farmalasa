-- No se ajusta el inventario de una sala que está contando.
--
-- Pedido del usuario, 2026-08-26: «que no permita hacer solicitudes de ajuste
-- de inventario si tiene un conteo activo».
--
-- El motivo es el mismo que ya hizo que `crear_conteo_inventario` prohíba dos
-- conteos abiertos en la misma sucursal: **el número se movería debajo de quien
-- está contando**. Y con `fuente_sistema = 'VIVO'` es peor que un desorden de
-- papeles — la existencia se relee en el momento de capturar, así que una carga
-- aprobada a media jornada le cambia el "sistema" a los renglones que todavía
-- no se contaron y la diferencia deja de significar lo que dice. Nadie lo
-- notaría: no hay error, no falta una fila, y el conteo cierra "cuadrando".
--
-- **La guarda va en la base y no en la pantalla.** El alta de estas solicitudes
-- es un `INSERT` directo del navegador contra `approval_requests`
-- (`insertMovimientoInventario` → `insertApprovalRequestSilent`), o sea que un
-- `if` en el formulario es una sugerencia. El trigger es la regla; la pantalla
-- explica ANTES de que alguien llene el formulario entero, que es la mitad que
-- evita el trabajo perdido.
--
-- **Alcance: sólo las DOS del ajuste** (`INVENTORY_LOAD_REQUEST` y
-- `INVENTORY_DISCARD_REQUEST`) — la familia que la pantalla llama literalmente
-- «Ajuste de inventario». Los traslados (`INVENTORY_TRANSFER_*`) también mueven
-- existencia y NO se frenan acá: es una decisión aparte, porque frenarlos
-- dejaría a una sala sin poder pedirle producto a otra durante todo un conteo,
-- y eso no es lo que se pidió.
--
-- **«Activo» = abierto** (`BORRADOR` o `EN_PROGRESO`), el mismo predicado con
-- el que `crear_conteo_inventario` bloquea un segundo conteo. Un conteo
-- `FINALIZADO` ya no acepta captura: su ajuste es otro camino
-- (`marcar_ajuste_erp`) y frenar el movimiento normal ahí trabaría la sala sin
-- proteger nada.
--
-- **El orden de los triggers importa y salió a favor.** `approval_requests`
-- tiene otros cuatro `BEFORE INSERT` de validación; Postgres los corre por
-- nombre alfabético y `trg_frenar_ajuste_si_hay_conteo_abierto` va antes que
-- `trg_validar_solicitud_movimiento_inventario`. O sea que quien tiene la sala
-- contando lee POR QUÉ no puede, y no un reclamo por un campo del formulario.

SET lock_timeout = '5s';

-- Lo que la pantalla pregunta para avisar antes, no para decidir. Es DEFINER
-- porque la respuesta —«tu sala está contando»— no depende de que quien pregunta
-- pueda LEER el conteo: quien carga producto puede no tener el módulo.
CREATE OR REPLACE FUNCTION public.sucursal_en_conteo(p_branch_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
              'en_conteo', true,
              'conteo_id', c.id,
              'sala', b.name,
              'desde', c.created_at,
              'status', c.status)
       FROM public.conteos_inventario c
       JOIN public.branches b ON b.id = c.branch_id
      WHERE c.branch_id = p_branch_id
        AND c.status IN ('BORRADOR','EN_PROGRESO')
      ORDER BY c.created_at
      LIMIT 1),
    jsonb_build_object('en_conteo', false));
$function$;

REVOKE EXECUTE ON FUNCTION public.sucursal_en_conteo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sucursal_en_conteo(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.frenar_ajuste_si_hay_conteo_abierto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch bigint;
  v_sala text;
BEGIN
  IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN
    RETURN NEW;
  END IF;

  -- La sala viaja dentro de `metadata`. Si no viene, no se puede decidir, y una
  -- solicitud de ajuste SIN sala es un defecto por su cuenta: se rechaza en vez
  -- de dejarla pasar, porque "no sé de qué sala es" no puede ser la puerta por
  -- la que se cuela lo que esta regla existe para frenar. Las 28 filas que hay
  -- hoy la traen todas (medido).
  v_branch := NULLIF(NEW.metadata->>'branch_id','')::bigint;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'La solicitud no dice de qué sala es, y sin eso no se puede registrar.';
  END IF;

  SELECT b.name INTO v_sala
  FROM public.conteos_inventario c
  JOIN public.branches b ON b.id = c.branch_id
  WHERE c.branch_id = v_branch
    AND c.status IN ('BORRADOR','EN_PROGRESO')
  LIMIT 1;

  IF v_sala IS NOT NULL THEN
    -- El texto sale tal cual a la pantalla: `mensajeAmigable` muestra el
    -- mensaje de un RAISE cuando es presentable. Por eso está escrito para una
    -- persona —tuteo, sin jerga, sin nombrar de dónde salen los números— y dice
    -- qué hacer, no sólo que no se puede (DESIGN.md §26).
    RAISE EXCEPTION 'En % hay un conteo de inventario abierto. Mientras se cuenta no se puede cargar ni descargar producto: el número cambiaría debajo de quien está contando. Cierra el conteo y vuelve a intentarlo.', v_sala;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_frenar_ajuste_si_hay_conteo_abierto ON public.approval_requests;
CREATE TRIGGER trg_frenar_ajuste_si_hay_conteo_abierto
  BEFORE INSERT ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.frenar_ajuste_si_hay_conteo_abierto();

COMMENT ON FUNCTION public.frenar_ajuste_si_hay_conteo_abierto() IS
  'Rechaza una solicitud de carga o descarte de inventario si la sala tiene un conteo abierto. La guarda vive acá porque el alta es un INSERT directo del navegador.';
