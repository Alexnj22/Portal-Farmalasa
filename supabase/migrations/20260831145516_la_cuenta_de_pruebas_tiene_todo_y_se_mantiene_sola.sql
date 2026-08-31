-- La cuenta de pruebas siempre tiene TODO activo — y se mantiene sola.
--
-- Regla del usuario (2026-08-31): «QA siempre debe tener todo activo».
--
-- POR QUÉ NO ALCANZA CON PONERLA AL DÍA HOY
--
-- Medido antes de escribir esto: de los 159 módulos del portal, a la cuenta de
-- QA le faltaban **5 enteros** (`caja_vales`, `bolsas_ver_cards`,
-- `cargar_compra`, `cuentas_por_pagar`, `dash_recetas_pendientes`) y otros
-- **20** los tenía a medias. Ninguno se le quitó a propósito: nacieron después
-- y nadie se acordó de dárselos.
--
-- Y el modo de falla es el peor que hay para una cuenta de pruebas: **no da
-- error, da un cero**. El barrido del teléfono entra a `/caja`, la cuenta no
-- tiene `caja_vales`, ve la pantalla de sin-acceso y el informe dice «cero
-- hallazgos». Un cero que habla de otra pantalla, y que se lee igual que uno
-- bueno. Así que un `UPDATE` de hoy arregla hoy y el próximo módulo vuelve a
-- abrir el hueco sin avisar.
--
-- POR QUÉ UNA COLUMNA Y NO EL NOMBRE DEL CARGO
--
-- El disparador tiene que saber CUÁL es la cuenta de pruebas. Cruzarlo contra
-- el texto `'QA / Testing (CI)'` es exactamente lo que la regla «un rótulo no
-- es una clave» prohíbe: el día que alguien le corrija el nombre al cargo, esto
-- deja de funcionar en silencio y volvemos al cero falso. La marca va en una
-- columna, que es un dato y no un rótulo.
--
-- QUÉ NO HACE
--
-- No toca ningún otro cargo, ni ninguna persona. Sólo escribe filas de
-- `role_permissions` de los cargos marcados.

SET lock_timeout = '5s';

-- ── 1. La marca ─────────────────────────────────────────────────────────────
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS es_cuenta_de_pruebas boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.roles.es_cuenta_de_pruebas IS
  'El cargo de una cuenta de PRUEBAS, no de una persona. Recibe todo módulo '
  'nuevo automáticamente (trigger dar_todo_a_las_cuentas_de_pruebas): una '
  'cuenta de pruebas sin un permiso no falla, devuelve un cero que se lee '
  'igual que un cero bueno.';

UPDATE public.roles SET es_cuenta_de_pruebas = true
 WHERE name = 'QA / Testing (CI)' AND NOT es_cuenta_de_pruebas;

-- ── 2. Al día, hoy ──────────────────────────────────────────────────────────
-- Los que le faltan enteros.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, m.module_key, true, true, true, 'ALL'
  FROM public.roles r
 CROSS JOIN (SELECT DISTINCT module_key FROM public.role_permissions) m
 WHERE r.es_cuenta_de_pruebas
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Los que tiene a medias.
UPDATE public.role_permissions rp
   SET can_view = true, can_edit = true, can_approve = true, scope = 'ALL',
       updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id AND r.es_cuenta_de_pruebas
   AND (rp.can_view, rp.can_edit, rp.can_approve, rp.scope)
       IS DISTINCT FROM (true, true, true, 'ALL');

-- ── 3. Y al día mañana ──────────────────────────────────────────────────────
-- Cuando un módulo nuevo aparece —para cualquier cargo—, la cuenta de pruebas
-- lo recibe en el mismo acto.
CREATE OR REPLACE FUNCTION public.dar_todo_a_las_cuentas_de_pruebas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  -- Sin esta guarda, la fila que escribe el propio disparador lo vuelve a
  -- disparar. No es un bucle infinito —la segunda vuelta no inserta nada por el
  -- ON CONFLICT— pero es trabajo por cada permiso que se toca en el portal.
  IF EXISTS (SELECT 1 FROM public.roles r
              WHERE r.id = NEW.role_id AND r.es_cuenta_de_pruebas) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
  SELECT r.id, NEW.module_key, true, true, true, 'ALL'
    FROM public.roles r
   WHERE r.es_cuenta_de_pruebas
  ON CONFLICT (role_id, module_key) DO NOTHING;

  RETURN NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dar_todo_a_las_cuentas_de_pruebas() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_dar_todo_a_las_cuentas_de_pruebas ON public.role_permissions;
CREATE TRIGGER trg_dar_todo_a_las_cuentas_de_pruebas
AFTER INSERT ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION public.dar_todo_a_las_cuentas_de_pruebas();
