---
name: New Module Checklist
description: Steps required every time a new module/view is added to the app
type: feedback
originSessionId: 02d464e3-41d3-4e74-b3d6-f29d7b197bc7
---
Whenever a new module (view) is created, always complete ALL of these steps:

1. **`src/views/NombreView.jsx`** — create the view
2. **`src/App.jsx`** — add import + `<Route path="nombre" element={<PermissionGuard moduleKey="nombre"><NombreView /></PermissionGuard>} />`
3. **`src/components/layout/AppLayout.jsx`** — add entry to `MODULE_MAP` and add key to the relevant `MENU_GROUPS` array
4. **`src/views/PermissionsView.jsx`** — add the module to the correct `MODULE_GROUPS` group (with icon, label, desc, hasApprove)
5. **DB `role_permissions`** — insert permission rows for the relevant roles (copy from a similar module or insert manually via Supabase SQL)

**Why:** Missing any step causes: broken nav (no menu item), AccessDenied for all users (no DB row), or module invisible in the Permisos de Acceso screen.

**How to apply:** Run through this checklist mentally before marking any new module task as done. Do not wait for the user to ask.
