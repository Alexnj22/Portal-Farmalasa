-- Quitar de un envío lo que no salió, cuando lo demás SÍ salió (2026-11-13).
--
-- `cancelar_envio` sólo sirve si no salió nada. Pero un envío puede salir a
-- medias: Bodega → Salud 2, 12 productos salieron y Salud 2 se los quedó, y un
-- TOTALVIT quedó en `error` porque se armó sin lote. Reenviar manda el MISMO
-- renglón guardado y choca otra vez; cancelar lo rebota porque ya salió algo.
-- Resultado: la tarjeta quedaba en «sin salir de tu sala» para siempre, con un
-- botón «Volver a enviar» que no podía funcionar.
--
-- El renglón quitado pasa a `cancelada`: un desenlace propio, distinto de
-- `error` (que pide acción) y de `no_llego` (que salió del estante). Como
-- `cancelada` no está en la lista de vivos de `get_envios_vivos`, el envío deja
-- de pedir algo en cuanto no le queda nada pendiente.
SET lock_timeout = '5s';

ALTER TABLE public.envio_linea DROP CONSTRAINT envio_linea_estado_check;
ALTER TABLE public.envio_linea ADD CONSTRAINT envio_linea_estado_check
  CHECK (estado = ANY (ARRAY['por_enviar','enviada','error','aceptada','devuelta',
                             'devuelta_recibida','no_llego','cancelada']));

CREATE OR REPLACE FUNCTION public.quitar_renglones_sin_salir(p_request_id uuid, p_motivo text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r      public.approval_requests%ROWTYPE;
    v_yo   uuid := public.auth_employee_id();
    v_mi   integer;
    v_todo boolean;
    v_org  integer;
    v_n    integer;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'Sesión inválida.'; END IF;

    SELECT * INTO r FROM public.approval_requests
     WHERE id = p_request_id AND type = 'INVENTORY_TRANSFER_PUSH';
    IF r.id IS NULL THEN RAISE EXCEPTION 'Ese envío no existe.'; END IF;
    IF r.status = 'CANCELLED' THEN RAISE EXCEPTION 'Ese envío ya está cancelado.'; END IF;

    IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Para quitar un producto del envío hay que decir por qué.';
    END IF;

    -- Si no salió nada, la salida es cancelar el envío entero (`cancelar_envio`).
    IF NOT EXISTS (SELECT 1 FROM public.envio_linea l
                    WHERE l.request_id = p_request_id AND l.enviado_at IS NOT NULL) THEN
        RAISE EXCEPTION 'No salió nada de este envío: cancélalo entero.';
    END IF;

    -- Mismo permiso que cancelar: la sala de la que iba a salir, quien lo armó,
    -- o alcance sobre todas en traslados.
    v_org := nullif(r.metadata->>'origen_branch_id','')::integer;
    SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_mi FROM public.employees WHERE id = v_yo;
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = v_yo
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                          AND rp.module_key = 'traslados' AND rp.scope = 'ALL')
    ) INTO v_todo;

    IF NOT v_todo AND v_yo IS DISTINCT FROM r.employee_id AND v_mi IS DISTINCT FROM v_org THEN
        RAISE EXCEPTION 'Esto lo resuelve la sala de la que iba a salir el producto.';
    END IF;

    -- Sólo lo que de verdad no salió: `enviado_at` y no el estado, igual que
    -- en `cancelar_envio`.
    UPDATE public.envio_linea
       SET estado = 'cancelada',
           error = 'Se quitó del envío antes de salir: ' || btrim(p_motivo),
           updated_at = now()
     WHERE request_id = p_request_id
       AND enviado_at IS NULL
       AND estado IN ('por_enviar', 'error');
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'A este envío no le queda nada sin salir.';
    END IF;

    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.quitar_renglones_sin_salir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quitar_renglones_sin_salir(uuid, text) TO authenticated, service_role;
