---
name: Project Architecture
description: Unified AppLayout, RBAC with role_permissions table, route paths for all modules
type: project
---

# Unified Layout Architecture

**AppLayout.jsx** is the single layout for ALL users (`src/components/layout/AppLayout.jsx`).
- Menu items are filtered dynamically by `hasPermission(module_key, 'can_view')` from AuthContext
- Desktop: collapsible dark sidebar (same as old AdminLayout)
- Mobile: hamburger → sidebar overlay + bottom tabs (only when user has ONLY self-service modules)
- Old `AdminLayout.jsx` and `EmployeeLayout.jsx` are now unused (kept as orphans)

**Why:** User wanted one menu for all roles, items change per permissions. No more isAdmin/isJefe branching in router.

# Route Paths

## Self-service (emp_* modules)
- `/home` → EmployeeHomeView
- `/my-requests` → EmployeeRequestsView (was `/requests`)
- `/my-announcements` → EmployeeAnnouncementsView (was `/announcements`)
- `/my-documents` → EmployeeDocumentsView (was `/documents`)
- `/profile` → EmployeeProfileView

## Admin/Management modules
- `/dashboard` (+ `/dashboard/empleado/:id`) → StaffManagementView / EmployeeDetailView
- `/monitor` → AttendanceMonitorView
- `/audit` → AttendanceAuditView
- `/schedules` → SchedulesView
- `/requests` → RequestsView (admin staff requests)
- `/vacation-plan` → VacationPlanView
- `/announcements` → AnnouncementsView (admin)
- `/branches` (+ `/branches/:id`) → BranchesView / BranchDetailView
- `/roles` → RolesView
- `/permissions` → PermissionsView
- `/auditview` → AuditView

# RBAC: role_permissions table

Supabase table `role_permissions (system_role, module_key, can_view, can_edit, can_approve)`.
- SUPERADMIN: hardcoded ALL in AuthContext (no DB needed)
- All others: loaded from DB on login, cached in `rolePerms` state
- `hasPermission(moduleKey, action)` exposed from AuthContext
- emp_* modules added for: EMPLEADO, ADMIN, JEFE, SUBJEFE, SUPERVISOR

# PermissionsView

Located at `/permissions`. Shows groups: Autogestión, Personal, Asistencia, Operaciones, Estructura, Comunicación, Sistema.
Roles: SUPERADMIN (locked), ADMIN, JEFE, SUBJEFE, SUPERVISOR, EMPLEADO.
