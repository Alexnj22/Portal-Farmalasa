SET lock_timeout = '5s';

-- Quien se lleva el efectivo no puede ser quien firma que salio de la sala.
--
-- Reporte del usuario, parado en administracion con seis bolsas de Salud 2 que
-- no podia recibir: «yo retire de salud 2, ya estoy en admin para recibirlo y
-- contar» y el portal no lo dejaba.
--
-- El freno de `recibir_bolsas` estaba bien y no se toca: compara contra
-- `entregada_por` —quien firmo la salida—, no contra quien cargo el dinero. Por
-- eso el mismo dia EDEMIR pudo recibir en administracion las bolsas de Salud 4,
-- Salud 5 y La Popular que el mismo se llevo: alla la salida la firmaron Idalia,
-- Wendy y Andy. Llevar el efectivo y recibirlo YA estaba permitido.
--
-- Lo que fallo es que en Salud 2 la entrega se firmo con la sesion de quien se
-- lo llevaba, asi que las dos firmas de la cadena son la misma persona y no
-- queda ningun control. Y el portal no dijo nada: dejo firmar, dejo escanear el
-- carne propio, y el freno aparecio tres pasos despues, con el dinero ya movido
-- y seis bolsas trabadas que solo puede destrabar un tercero.
--
-- O sea que la guarda estaba en el extremo equivocado de la cadena. Es la misma
-- leccion de `retiro_cargar`/`retiro_firmar` para el producto —FIRMA_PROPIA,
-- «Quien entrega tiene que ser alguien de esa sala, no tu»— y la del kiosco el
-- 2026-08-31: una verificacion que llega tarde no evita el acto, solo lo deja
-- sin salida. El efectivo era el unico circuito que no lo tenia.
--
-- Va ANTES de `consumir_vale_de_identidad` a proposito, por el mismo motivo que
-- ya explica el cuerpo: si algo no cuadra, el vale no se gasta y no hay que
-- volver a pasar el carne.
--
-- No deja a nadie trabado: medido el 2026-08-31, las siete salas tienen entre 5
-- y 7 personas con permiso para firmar una entrega.

CREATE OR REPLACE FUNCTION public.entregar_bolsas(p_ids bigint[], p_recibido_por uuid, p_vale uuid)
 RETURNS bolsas_entregas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := (SELECT auth_employee_id());
    v_scope  text := (SELECT auth_module_scope('bolsas'));
    v_mia    bigint := (SELECT auth_employee_branch_id());
    v_branch bigint;
    v_metodo text;
    v_codigo text;
    v_ent    public.bolsas_entregas;
    v_n      integer := 0;
    r        record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Hay que elegir al menos una bolsa.';
    END IF;
    IF p_recibido_por IS NULL THEN
        RAISE EXCEPTION 'Falta quien se lleva el efectivo.';
    END IF;
    -- Dos firmas de la misma persona no son un control, son dos clics. Y se
    -- dice ACA, con el dinero todavia en la sala: el mismo aviso al recibir
    -- llega cuando ya no hay marcha atras.
    IF p_recibido_por = v_yo THEN
        RAISE EXCEPTION 'Quien se lleva el efectivo no puede ser la misma persona que firma la entrega. La entrega la firma alguien de la sala.';
    END IF;

    -- Primero las bolsas y después la identidad: si algo de las bolsas no
    -- cuadra, el vale no se gasta y no hay que volver a escanear el carne.
    FOR r IN SELECT * FROM public.bolsas WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE LOOP
        IF v_scope IS DISTINCT FROM 'ALL' AND r.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;
        IF r.estado <> 'ABIERTA' THEN
            RAISE EXCEPTION 'La bolsa % ya salio de la sala.', r.folio;
        END IF;
        IF v_branch IS NULL THEN v_branch := r.branch_id;
        ELSIF v_branch <> r.branch_id THEN
            RAISE EXCEPTION 'Una entrega es de UNA sala: no se pueden juntar bolsas de dos sucursales.';
        END IF;
        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN RAISE EXCEPTION 'Ninguna de esas bolsas existe.'; END IF;
    IF v_n <> array_length(p_ids, 1) THEN
        RAISE EXCEPTION 'Alguna de esas bolsas ya no esta. Hay que cargar la lista de nuevo.';
    END IF;

    -- Quien se lleva el dinero tiene que estar activo. No se exige que sea de
    -- ESA sala: justamente suele ser alguien de administracion que recolecta.
    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_recibido_por AND e.status = 'ACTIVO') THEN
        RAISE EXCEPTION 'Esa persona no esta activa: no puede recibir efectivo.';
    END IF;

    v_metodo := public.consumir_vale_de_identidad(p_vale, p_recibido_por);

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo
      FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_entregas
        (folio, branch_id, entregada_por, recibido_por, recibido_metodo)
    VALUES ('E-' || v_codigo || '-' || nextval('public.bolsas_entrega_folio_seq'),
            v_branch, v_yo, p_recibido_por, v_metodo)
    RETURNING * INTO v_ent;

    UPDATE public.bolsas
       SET estado = 'ENTREGADA', entregada_por = v_yo, entregada_at = now(),
           entrega_id = v_ent.id, updated_at = now()
     WHERE id = ANY(p_ids);

    INSERT INTO public.bolsas_eventos
        (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'ENTREGAR', 'ABIERTA', 'ENTREGADA', b.monto_inicial, v_yo,
           format('%s · se lo lleva %s (%s)', v_ent.folio,
                  coalesce((SELECT e.name FROM public.employees e WHERE e.id = p_recibido_por), 'sin nombre'),
                  CASE WHEN v_metodo = 'CARNE' THEN 'carne' ELSE 'usuario y contrasena' END)
      FROM public.bolsas b WHERE b.id = ANY(p_ids);

    RETURN v_ent;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.entregar_bolsas(bigint[], uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.entregar_bolsas(bigint[], uuid, uuid) TO authenticated, service_role;
