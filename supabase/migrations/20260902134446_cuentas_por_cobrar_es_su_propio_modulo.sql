SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- «Cuentas por cobrar» es su propio módulo.
--
-- Nació como la cuarta pestaña de Efectivo y el usuario la sacó de ahí
-- (2-sep): «agregalo como vista nueva, Cuentas por cobrar». La razón de fondo
-- no es de acomodo — Efectivo contesta «¿cuadra el dinero de HOY?» y esto
-- «¿quién nos debe de los últimos dos años?». Comparten el cajón, no la
-- pregunta.
--
-- ── A quién se le da, y por qué a nadie más ────────────────────────────────
-- Exactamente a quien YA tenía `caja_vales`, con su mismo can_view/can_edit y
-- su mismo alcance. Así el permiso nuevo no le abre la cartera a nadie que no
-- pudiera abonar antes desde el sistema de la caja: la pantalla cambia de
-- lugar, no de público. Sumarle, por ejemplo, a los de `cortes_caja` habría
-- sido darles el nombre y la deuda de 43 clientes sin que nadie lo decidiera.
--
-- Se copia el ALCANCE y no se fija uno: la sala cobra lo suyo (BRANCH) y la
-- supervisión ve las seis (ALL), que es el mismo criterio que ya rige la caja.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT role_id, 'cuentas_por_cobrar', can_view, can_edit, false, scope
FROM public.role_permissions
WHERE module_key = 'caja_vales'
ON CONFLICT (role_id, module_key) DO NOTHING;
