SET lock_timeout = '5s';

-- Contar el dinero deja de ser cosa de dos cargos.
--
-- «los demas que tienen permiso no pueden ayudar a contar» (usuario,
-- 2026-08-26). Era literal y no una impresión: `bolsas_conteo` con `can_edit`
-- lo tenían sólo Gerente General y Supervisor/a de Ventas. Administración y
-- Talento Humano VEÍAN la pestaña «Por contar» con sus bolsas y sus montos, y
-- no les salía ni «Cuadra» ni «No cuadra» — o sea que la pantalla les mostraba
-- el trabajo y les escondía la forma de hacerlo, sin decir por qué.
--
-- Quién contó cada bolsa ya se guardaba (`conteo_marcado_por` → `contado_por`),
-- así que abrirlo no pierde el rastro: lo gana, porque hasta hoy el rastro
-- decía siempre uno de dos nombres.
--
-- Jefe/a de Compras y Logística queda AFUERA a propósito: cuenta dinero sin
-- `bolsas_ver_montos` (decisión vieja del usuario), o sea que contaría a ciegas
-- —escribiendo una cifra sin poder ver contra cuál—.
UPDATE public.role_permissions rp
   SET can_edit = true, updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND rp.module_key = 'bolsas_conteo'
   AND r.name IN ('Administrador', 'Jefe/a de Talento Humano')
   AND rp.can_edit IS DISTINCT FROM true;
