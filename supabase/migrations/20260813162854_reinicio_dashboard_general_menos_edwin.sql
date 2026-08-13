-- Reinicio del tablero de INICIO · pestaña General (pedido del usuario, 2026-08-13).
--
-- Borra el acomodo personal de General de TODO el mundo menos EDWIN NUÑEZ, para
-- que la pestaña vuelva a armarse sola con el acomodo por renglones completos
-- que entra en esta misma versión (`empacarFilas` en `DashboardView.jsx`). Los
-- tableros guardados se compusieron contra el catálogo de otro momento y con el
-- acomodo viejo: conservarlos es conservar justo los huecos que este cambio
-- cierra.
--
-- La clave real es `arranged->'general'`: mientras esa marca esté puesta, el
-- tablero se pinta con las posiciones guardadas y el acomodo automático no
-- corre. Las otras cuatro columnas se limpian para no dejar la foto huérfana.
--
-- Esto es sólo la mitad del reinicio. La otra mitad vive en el navegador de cada
-- persona (`localStorage`), que esta migración no puede tocar y que el propio
-- portal borra una vez, en la primera carga tras el despliegue — ver
-- `REINICIO_GENERAL` en `src/views/DashboardView.jsx`.
--
-- Respaldo de lo que se descarta (los 7 que sí habían acomodado su General):
-- scratchpad `respaldo-general-2026-08-13.json` de la sesión.
--
-- Medido antes/después: 34 filas con `layout.general` y 7 con
-- `arranged.general` → 1 y 0, y la que queda es la de Edwin.
--
-- Tabla fría: no la escribe ningún cron. Aun así lleva el `lock_timeout` que
-- exige toda migración del proyecto.
SET lock_timeout = '5s';

UPDATE public.user_dashboard_prefs
SET layout        = layout        - 'general',
    sizes         = sizes         - 'general',
    mobile_layout = mobile_layout - 'general',
    mobile_sizes  = mobile_sizes  - 'general',
    arranged      = arranged      - 'general',
    updated_at    = now()
WHERE user_id <> 'bbc796d7-7435-495b-9306-a2115f44a18f'::uuid   -- EDWIN NUÑEZ
  AND (layout        ? 'general' OR sizes        ? 'general'
    OR mobile_layout ? 'general' OR mobile_sizes ? 'general'
    OR arranged      ? 'general');
