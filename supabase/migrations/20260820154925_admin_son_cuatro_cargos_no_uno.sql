SET lock_timeout = '5s';

-- ═══ «Admin» son CUATRO cargos, no uno ══════════════════════════════════════
--
-- Aclaración del usuario el 2026-08-20, después de que yo leyera «solo es admin»
-- como el rol llamado *Administrador*:
--
--   «el permiso lo debe tener admin (recuerda a admin como administrador,
--    gerente, talento y supervision) y claro QA»
--
-- O sea que **«admin» es el área, no el rol**: Administrador, Gerente General,
-- Jefe/a de Talento Humano y Supervisor/a de Ventas. Lo que él estaba señalando
-- cuando dijo «compras y logística no está ahí» era que ESE cargo no pertenece
-- al área — no que la lista tuviera que reducirse a uno.
--
-- Se restauran los tres que se habían quitado en
-- `20260820154401_imprimir_un_carne_es_solo_de_administracion`.
--
-- ⚠️ **La lección, para no volver a hacerlo:** «admin» en este negocio NO es el
-- rol `Administrador` (id 3). Un rótulo de la conversación no es una clave de la
-- tabla — es la misma trampa de la regla «un rótulo no es una clave» de
-- CLAUDE.md, sólo que acá el rótulo venía de una frase y no de un formulario.
-- Ante una palabra que suena a rol, preguntar qué cargos abarca ANTES de borrar
-- filas de permisos.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
VALUES
    (2,  'carne_temporal', true, true, false, 'ALL'),   -- Gerente General
    (11, 'carne_temporal', true, true, false, 'ALL'),   -- Jefe/a de Talento Humano
    (13, 'carne_temporal', true, true, false, 'ALL')    -- Supervisor/a de Ventas
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_view = true, can_edit = true;

DO $$
DECLARE v_roles text;
BEGIN
    SELECT string_agg(r.name, ', ' ORDER BY r.id) INTO v_roles
      FROM public.role_permissions rp
      JOIN public.roles r ON r.id = rp.role_id
     WHERE rp.module_key = 'carne_temporal' AND rp.can_edit;
    RAISE NOTICE 'Pueden imprimir un carne: %', coalesce(v_roles, 'NADIE');
END $$;
