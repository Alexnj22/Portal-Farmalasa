SET lock_timeout = '5s';

WITH plantilla AS (
    SELECT
        '[{"clave":"m","label":"Mañana","desde":"08:00","hasta":"11:00"},
          {"clave":"d","label":"Mediodía","desde":"12:00","hasta":"15:00"},
          {"clave":"t","label":"Tarde","desde":"16:00","hasta":"19:00"}]'::jsonb AS franjas_ambiente,
        '[{"clave":"m","label":"Mañana","desde":"08:00","hasta":"11:00"},
          {"clave":"t","label":"Tarde","desde":"16:00","hasta":"19:00"}]'::jsonb AS franjas_frio,
        '[{"clave":"apertura","label":"Apertura","desde":"07:00","hasta":"10:00"},
          {"clave":"cierre","label":"Cierre","desde":"17:00","hasta":"20:00"}]'::jsonb AS turnos_limpieza
),
nuevas AS (
    SELECT b.id AS branch_id, 'sala_ventas'::text AS tipo, 'Sala de ventas'::text AS nombre,
           p.franjas_ambiente AS franjas, p.turnos_limpieza AS limpiezas,
           NULL::numeric AS temp_min, 30::numeric AS temp_max,
           NULL::numeric AS hr_min, NULL::numeric AS hr_max, true AS mide_humedad
      FROM public.branches b CROSS JOIN plantilla p
     WHERE b.name NOT IN ('Administracion', 'Bodega')

    UNION ALL
    SELECT b.id, 'bodega', 'Bodega',
           p.franjas_ambiente, p.turnos_limpieza,
           NULL, 30, NULL, NULL, true
      FROM public.branches b CROSS JOIN plantilla p
     WHERE b.name <> 'Administracion'

    UNION ALL
    SELECT b.id, 'refrigerador', 'Refrigerador',
           p.franjas_frio, '[]'::jsonb,
           2, 8, NULL, NULL, false
      FROM public.branches b CROSS JOIN plantilla p
     WHERE b.name = 'Bodega'
)
INSERT INTO public.bitacora_areas
    (branch_id, tipo, nombre, franjas, limpiezas, temp_min, temp_max, hr_min, hr_max, mide_humedad)
SELECT branch_id, tipo, nombre, franjas, limpiezas, temp_min, temp_max, hr_min, hr_max, mide_humedad
  FROM nuevas
ON CONFLICT (branch_id, tipo, nombre) DO NOTHING;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
VALUES
    (2,  'bitacoras', true, true,  false, 'ALL'),
    (3,  'bitacoras', true, true,  false, 'ALL'),
    (13, 'bitacoras', true, true,  false, 'ALL'),
    (33, 'bitacoras', true, true,  false, 'ALL'),
    (8,  'bitacoras', true, true,  false, 'ALL'),
    (19, 'bitacoras', true, true,  false, 'BRANCH'),
    (20, 'bitacoras', true, true,  false, 'BRANCH'),
    (23, 'bitacoras', true, true,  false, 'BRANCH'),
    (30, 'bitacoras', true, true,  false, 'BRANCH'),
    (15, 'bitacoras', true, true,  false, 'BRANCH'),

    (2,  'bitacoras_tab_historial', true, false, false, 'ALL'),
    (3,  'bitacoras_tab_historial', true, false, false, 'ALL'),
    (8,  'bitacoras_tab_historial', true, false, false, 'ALL'),
    (13, 'bitacoras_tab_historial', true, false, false, 'ALL'),
    (33, 'bitacoras_tab_historial', true, false, false, 'ALL'),
    (19, 'bitacoras_tab_historial', true, false, false, 'BRANCH'),
    (20, 'bitacoras_tab_historial', true, false, false, 'BRANCH'),
    (23, 'bitacoras_tab_historial', true, false, false, 'BRANCH'),
    (30, 'bitacoras_tab_historial', true, false, false, 'BRANCH'),
    (15, 'bitacoras_tab_historial', true, false, false, 'BRANCH'),

    (2,  'bitacoras_tab_cierre', true, false, false, 'ALL'),
    (3,  'bitacoras_tab_cierre', true, false, false, 'ALL'),
    (8,  'bitacoras_tab_cierre', true, false, false, 'ALL'),
    (13, 'bitacoras_tab_cierre', true, false, false, 'ALL'),
    (33, 'bitacoras_tab_cierre', true, false, false, 'ALL'),
    (19, 'bitacoras_tab_cierre', true, false, false, 'BRANCH'),
    (20, 'bitacoras_tab_cierre', true, false, false, 'BRANCH'),

    (2,  'bitacoras_cerrar_mes', true, true, false, 'ALL'),
    (3,  'bitacoras_cerrar_mes', true, true, false, 'ALL'),
    (8,  'bitacoras_cerrar_mes', true, true, false, 'ALL'),
    (13, 'bitacoras_cerrar_mes', true, true, false, 'ALL'),
    (33, 'bitacoras_cerrar_mes', true, true, false, 'ALL'),

    (2,  'bitacoras_configurar', true, true, false, 'ALL'),
    (3,  'bitacoras_configurar', true, true, false, 'ALL'),
    (8,  'bitacoras_configurar', true, true, false, 'ALL'),
    (13, 'bitacoras_configurar', true, true, false, 'ALL'),
    (33, 'bitacoras_configurar', true, true, false, 'ALL'),

    (2,  'bitacoras_descargar', true, false, false, 'ALL'),
    (3,  'bitacoras_descargar', true, false, false, 'ALL'),
    (8,  'bitacoras_descargar', true, false, false, 'ALL'),
    (13, 'bitacoras_descargar', true, false, false, 'ALL'),
    (33, 'bitacoras_descargar', true, false, false, 'ALL'),
    (19, 'bitacoras_descargar', true, false, false, 'BRANCH'),
    (20, 'bitacoras_descargar', true, false, false, 'BRANCH'),

    (2,  'dash_bitacoras', true, true, false, 'ALL'),
    (3,  'dash_bitacoras', true, true, false, 'ALL'),
    (8,  'dash_bitacoras', true, true, false, 'ALL'),
    (13, 'dash_bitacoras', true, true, false, 'ALL'),
    (33, 'dash_bitacoras', true, true, false, 'ALL'),
    (19, 'dash_bitacoras', true, true, false, 'BRANCH'),
    (20, 'dash_bitacoras', true, true, false, 'BRANCH'),
    (23, 'dash_bitacoras', true, true, false, 'BRANCH'),
    (30, 'dash_bitacoras', true, true, false, 'BRANCH'),
    (15, 'dash_bitacoras', true, true, false, 'BRANCH')
ON CONFLICT (role_id, module_key) DO NOTHING;
