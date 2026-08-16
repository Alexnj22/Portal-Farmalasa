SET lock_timeout = '5s';

-- Quien instala una caja y quien mira si el papel salió es administración.
-- Estaban fuera: el módulo se había sembrado copiando el de `ios_test`, que no
-- los incluía. Sin esto, el Gerente General no puede registrar la caja de una
-- sala — o sea que la función no se puede encender.
--
-- La sala NO lo necesita: encolar no exige el módulo (lo hace cualquier sesión,
-- porque confirmar un corte tiene que poder imprimir su etiqueta), y la cola es
-- una pantalla de diagnóstico.
UPDATE public.role_permissions rp
   SET can_view = true, can_edit = true, scope = 'ALL', updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND rp.module_key = 'impresion'
   AND r.name IN ('Gerente General', 'Administrador');

-- Un tope a lo que puede esperar sin salir.
--
-- `encolar_impresion` la puede llamar cualquier sesión —tiene que poder, porque
-- confirmar un corte imprime su etiqueta— así que un bucle en el navegador o
-- alguien con ganas podrían dejar mil tickets esperando y gastar el rollo
-- entero. Cincuenta pendientes es muchísimo para una caja que imprime uno cada
-- dos segundos: si se llegó a eso, el agente está caído y encolar más no ayuda.
CREATE OR REPLACE FUNCTION public.encolar_impresion(
    p_branch_id bigint, p_titulo text, p_contenido text)
 RETURNS bigint
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_pendientes integer;
BEGIN
    IF (SELECT auth_employee_id()) IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Falta decir en que sala se imprime.'; END IF;
    IF p_contenido IS NULL OR btrim(p_contenido) = '' THEN
        RAISE EXCEPTION 'No hay nada que imprimir.';
    END IF;
    IF length(p_contenido) > 60000 THEN
        RAISE EXCEPTION 'Ese documento es demasiado largo para un rollo.';
    END IF;

    -- Sin caja registrada no se encola: una cola que nadie lee es papel que
    -- nunca sale y nadie se entera. Quien llama cae al camino de siempre.
    IF NOT EXISTS (SELECT 1 FROM public.impresion_dispositivos d
                    WHERE d.branch_id = p_branch_id AND d.activo) THEN
        RAISE EXCEPTION 'Esa sala no tiene una caja registrada para imprimir.';
    END IF;

    SELECT count(*) INTO v_pendientes FROM public.cola_impresion c
     WHERE c.branch_id = p_branch_id AND c.estado IN ('PENDIENTE','IMPRIMIENDO');
    IF v_pendientes >= 50 THEN
        RAISE EXCEPTION 'Esa caja tiene % documentos esperando: parece que la impresora no esta respondiendo.', v_pendientes;
    END IF;

    INSERT INTO public.cola_impresion (branch_id, titulo, contenido, creado_por)
    VALUES (p_branch_id, left(btrim(p_titulo), 120), p_contenido, (SELECT auth_employee_id()))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.encolar_impresion(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.encolar_impresion(bigint, text, text) TO authenticated, service_role;
