SET lock_timeout = '5s';

-- Decision del usuario (2026-08-14): «las salas son las que confirman sus
-- propios cortes». Corrige el default que dejo la migracion anterior, que copio
-- los permisos de `ventas` y por eso dejo a la sala mirando sin poder resolver.
--
-- El alcance NO se toca: siguen en BRANCH, o sea que cada sala resuelve la suya
-- y nada mas. El RPC `resolver_corte_caja` vuelve a chequear esa frontera del
-- lado del servidor, asi que esto no abre la puerta a resolver cortes ajenos.
--
-- Efecto medido: Dependiente de Farmacia, Jefe/a de Sala, Subjefe/a de Sala y
-- Regente de Enfermeria pasan a can_edit = true con scope BRANCH.
UPDATE public.role_permissions rp
SET can_edit = true
FROM public.roles r
WHERE r.id = rp.role_id
  AND rp.module_key = 'cortes_caja'
  AND rp.can_view = true
  AND rp.can_edit = false
  AND rp.scope = 'BRANCH';
