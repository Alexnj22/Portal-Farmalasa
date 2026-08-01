SET lock_timeout = '5s';

-- ── Permisos del módulo `clientes` ───────────────────────────────────────────
--
-- Sin estas filas el módulo existe pero nadie lo ve: `PermissionGuard` niega el
-- acceso y los RPC levantan FORBIDDEN. Es el paso del checklist de módulo nuevo
-- que, cuando falta, se manifiesta como "AccessDenied para todos".
--
-- El reparto copia el de `facturacion` — es el mismo círculo de gente: quien
-- factura es quien necesita la ficha fiscal del cliente correcta. Se agrega
-- Contabilidad (Contador Externo, 35) en modo lectura: los datos del receptor
-- son los que terminan en el libro de IVA, pero corregirlos no es su trabajo.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit)
VALUES
    (2,  'clientes', true,  true),   -- Gerente General
    (3,  'clientes', true,  true),   -- Administrador
    (11, 'clientes', true,  true),   -- Jefe/a de Talento Humano
    (13, 'clientes', true,  true),   -- Supervisor/a de Ventas
    (33, 'clientes', true,  true),   -- QA / Testing (CI)
    (35, 'clientes', true,  false),  -- Contador Externo — lee, no corrige
    (12, 'clientes', false, false),  -- Jefe/a de Compras y Logistica
    (30, 'clientes', false, false)   -- Dependiente de Farmacia
ON CONFLICT (role_id, module_key) DO NOTHING;
