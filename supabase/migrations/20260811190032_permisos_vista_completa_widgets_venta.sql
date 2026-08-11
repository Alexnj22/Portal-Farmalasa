SET lock_timeout = '5s';

-- Dos capacidades nuevas, una por widget de venta del Inicio:
--   dash_meta_sala_vista_completa  → la Meta del mes con sus montos
--   dash_vendedores_vista_completa → el ranking con lo vendido por cada quien
--
-- Apagadas, el widget NO desaparece: habla en porcentajes (cumplimiento,
-- proyección de cierre, participación de cada vendedor) y conserva las dos
-- cifras que sirven para trabajar y no delatan a nadie — el ritmo diario que
-- hace falta y el ticket promedio.
--
-- Backfill en true para todo rol que ya ve el widget padre, igual que las 28
-- capacidades del canon (20260804014121) y que ventas_ver_cards
-- (20260811185453): hoy nadie ve algo distinto, apagarlo es explícito.
INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT rp.role_id, n.hija, true, false, false, 'ALL', now()
  FROM role_permissions rp
  JOIN (VALUES
    ('dash_meta_sala',  'dash_meta_sala_vista_completa'),
    ('dash_vendedores', 'dash_vendedores_vista_completa')
  ) AS n(padre, hija) ON n.padre = rp.module_key
 WHERE rp.can_view = true
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();
