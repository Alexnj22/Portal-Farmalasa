-- Marketing de muestra para el entorno de pruebas (2026-10-26).
--
-- El branch nace sin un solo mes ni pieza de Marketing, así que `PiezaModal`
-- —el diálogo más largo del módulo: flujo, archivos, pauta y conversación—
-- no se podía abrir desde `tests/e2e/pieza-marketing-movil.spec.js`, que se
-- saltaba con «no hay nada que abrir». Este archivo siembra el MES EN CURSO
-- con tres piezas en estados distintos y una conversación corta.
--
-- Todo es inventado y lleva «PRUEBA» en el título. Se puede correr las veces
-- que haga falta: si el mes en curso ya tiene piezas, no hace nada. Como el
-- mes se calcula con `current_date`, cada mes nuevo vuelve a tener muestra la
-- primera vez que corre el mantenimiento diario (`mantener_al_dia.mjs`).
--
-- Los estados se escriben directo con `marketing.por_funcion = 'si'`, la misma
-- marca que usan las funciones del módulo: sin ella el candado no deja nacer
-- una pieza aprobada ni un mes en revisión (por diseño, eso lo firma quien
-- revisa). La marca es local a la transacción.
SET lock_timeout = '5s';

DO $siembra$
DECLARE
    v_mes    date := date_trunc('month', current_date)::date;
    v_mes_id uuid;
    v_autor  uuid;
    v_rev    uuid;
    v_p1     uuid;
    v_p2     uuid;
    v_p3     uuid;
BEGIN
    -- La guarda de todas las semillas: con datos de producción, no se siembra.
    IF (SELECT count(*) FROM public.sales_invoices) > 50000
       OR (SELECT count(*) FROM public.employees) > 30 THEN
        RAISE EXCEPTION 'Esta base parece PRODUCCIÓN. Abortado.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.marketing_piezas p
                 JOIN public.marketing_meses m ON m.id = p.mes_id
                WHERE m.mes = v_mes) THEN
        RAISE NOTICE 'Marketing: % ya tiene piezas, no se siembra.', to_char(v_mes, 'MM/YYYY');
        RETURN;
    END IF;

    -- La cuenta de pruebas es la autora: así puede mover sus piezas en el
    -- tablero sin chocar con «Sólo quien creó la pieza la mueve».
    SELECT id INTO v_autor FROM public.employees WHERE username = 'pruebas' LIMIT 1;
    SELECT id INTO v_rev FROM public.employees
     WHERE id IS DISTINCT FROM v_autor ORDER BY name LIMIT 1;
    IF v_autor IS NULL THEN
        RAISE NOTICE 'Marketing: no existe la cuenta de pruebas, no se siembra.';
        RETURN;
    END IF;

    PERFORM set_config('marketing.por_funcion', 'si', true);

    INSERT INTO public.marketing_meses (mes, estado, objetivo, version, publicado_at, publicado_por, created_by)
    VALUES (v_mes, 'en_revision', 'PRUEBA — campaña de temporada y educación en salud', 1,
            now(), v_autor, v_autor)
    ON CONFLICT (mes) DO NOTHING;
    SELECT id INTO v_mes_id FROM public.marketing_meses WHERE mes = v_mes;

    -- 1) Pendiente: lo mínimo, sin copy largo.
    INSERT INTO public.marketing_piezas (mes_id, marca_id, marcas, fecha, hora, formato, redes, pilar,
                                         titulo, copy, estado, created_by)
    VALUES (v_mes_id, 1, ARRAY[1]::smallint[], v_mes + 4, '09:00', 'post', ARRAY['facebook','instagram'],
            'educativo', 'PRUEBA Hidratación en temporada de calor',
            'Tomar agua seguido también es cuidarse. Pasá por tu farmacia más cercana.',
            'pendiente', v_autor)
    RETURNING id INTO v_p1;

    -- 2) Con cambios pedidos: copy largo, hashtags, notas y una conversación,
    --    que es lo que estira el diálogo hacia abajo.
    INSERT INTO public.marketing_piezas (mes_id, marca_id, marcas, fecha, hora, formato, redes, pilar,
                                         titulo, copy, hashtags, notas, estado, pautar, created_by)
    VALUES (v_mes_id, 2, ARRAY[2,1]::smallint[], v_mes + 11, '18:30', 'carrusel',
            ARRAY['facebook','instagram','whatsapp'], 'promocion',
            'PRUEBA Carrusel de vitaminas — 3×2 en toda la línea',
            E'Esta semana llevá tres y pagá dos en toda la línea de vitaminas.\n\n'
            || E'Válido en todas las sucursales hasta agotar existencias. No acumulable con otras promociones.\n\n'
            || 'Consultá a tu dependiente por la presentación que más te conviene.',
            '#salud #vitaminas #promocion', 'Usar las fotos del catálogo nuevo.',
            'cambios', true, v_autor)
    RETURNING id INTO v_p2;

    -- 3) Aprobada: la firma de revisión la pone quien revisa.
    INSERT INTO public.marketing_piezas (mes_id, marca_id, marcas, fecha, hora, formato, redes, pilar,
                                         titulo, copy, estado, revisado_por, revisado_at, created_by)
    VALUES (v_mes_id, 1, ARRAY[1]::smallint[], v_mes + 19, '12:00', 'reel', ARRAY['instagram'],
            'institucional', 'PRUEBA Reel — conocé a nuestro equipo',
            'Detrás de cada mostrador hay alguien que te conoce por tu nombre.',
            'aprobado', v_rev, now(), v_autor)
    RETURNING id INTO v_p3;

    INSERT INTO public.marketing_comentarios (mes_id, pieza_id, tipo, texto, autor_id)
    VALUES (v_mes_id, v_p2, 'cambio', 'PRUEBA La segunda lámina tiene el precio viejo, cambiarlo.', coalesce(v_rev, v_autor)),
           (v_mes_id, v_p2, 'comentario', 'PRUEBA Listo, ya lo actualicé en el borrador.', v_autor),
           (v_mes_id, v_p3, 'aprobacion', 'PRUEBA Aprobado, se ve muy bien.', coalesce(v_rev, v_autor));

    RAISE NOTICE 'Marketing: % sembrado con 3 piezas (pendiente, cambios, aprobado).', to_char(v_mes, 'MM/YYYY');
END
$siembra$;
