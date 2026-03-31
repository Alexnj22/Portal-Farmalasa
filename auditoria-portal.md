# Auditoría Portal Farmacias La Popular & La Salud
**Fecha:** 2026-03-31 | **Stack:** React + Zustand + Supabase

---

## 1. BUGS CONOCIDOS 🐛

### 🔴 Críticos
- `LoginView.jsx` — Race condition en scanner: variable `cancelled` dentro de async, cámara queda activa al cambiar de modo
- `FormNovedad.jsx` — `useEffect` de fechas tiene `setFormData` en deps Y lo llama adentro → circular dependency / re-renders infinitos potenciales
- `AuthContext.jsx` — Idle timeout usa `localStorage` + intervalo 30s, race condition si se cambia de pestaña exactamente al límite
- `supabase/functions/ensure_user_by_code` — Contraseña inicial `init_{code}` es predecible; cualquiera puede entrar al portal
- `branchSlice.js:164` — Si `storage.move()` falla, código continúa; historial de versiones de documentos se pierde silenciosamente
- `systemSlice.js:139` — Mapeo de roles sin null check; empleados sin rol asignado fallan silenciosamente en lugar de mostrar fallback
- `AttendanceAuditView.jsx:157` — Cálculo de turno cruzando medianoche: incremento de fecha ocurre DESPUÉS de la comparación, no antes
- `registerEmployeeEvent` — Despacha `force-history-refresh` dentro de sí mismo → al editar se disparan 2× `fetchWeekRosters` en SchedulesView

### 🟡 Medios
- `SchedulesView.jsx` — `publishState.bulkUpdates` inicializado como `null`; puede fallar al publicar si no se popula antes
- `editEmployeeEvent` — Llama `registerEmployeeEvent` que ya dispara `force-history-refresh` + luego dispara `employee-event-updated` → doble fetch innecesario
- `getDayConflictLocal()` — Solo retorna el primer conflicto del día; PERMIT + SUPPORT simultáneos solo muestra uno
- `saly-ai/index.ts` — Sin manejo de timeouts ni rate limits de Gemini API; falla silenciosamente

### 🟢 Menores
- `auditSlice.js` — `safeDetails()` trunca en silencio si >20KB; no avisa al usuario
- `employeeSlice.js` — `compressImage()` usa callbacks en lugar de Promise, difícil de manejar errores
- `parseMeta()` — Silencia errores de JSON.parse; oculta metadata corrupta

---

## 2. MÓDULOS COMPLETOS ✅

- **AttendanceMonitorView** — Monitor en tiempo real con filtros, tardanzas, chips de historial
- **AuditView** — Log de auditoría con filtros de tipo/severidad
- **AnnouncementsView** — CRUD de anuncios con prioridad, búsqueda, filtros
- **BranchesView + BranchDetailView** — CRUD de sucursales, documentos legales con vencimiento
- **StaffManagementView** — Directorio con búsqueda, filtros, estados efectivos, cumpleaños
- **RolesView** — CRUD roles, límites de headcount, organigrama interactivo
- **TimeClockView** — Kiosk de marcaje con scanner
- **AttendanceAuditView** — Detección de marcajes faltantes y corrección manual (excepto bug de medianoche)
- **SchedulesView** — Planificador semanal con IA, publicación, cálculo de horas
- **auditSlice** — Log de auditoría con inferencia de severidad y fuente
- **scheduleHelpers** — Cálculos de tiempo, conflictos de calendario, temas de roles
- **constants.js** — EVENT_TYPES, DOCUMENT_TYPES, WEEK_DAYS completos
- **RangeDatePicker** — Selector con drag-to-select, multiRange, overlap validation
- **cancelEmployeeEvent** — Cancela en BD + store local + badge CANCELADO ✓
- **editEmployeeEvent** — Supersede + crea nuevo + store local + badge EDITADO ✓
- **OVERLAP_ERROR** — Validación server-side VACATION/DISABILITY/SUPPORT con mensajes descriptivos ✓

---

## 3. MÓDULOS INCOMPLETOS ⚠️

### 🔴 Crítico
- **Password inicial predecible** — `ensure_user_by_code` necesita generar password random + forzar cambio en primer login

### 🟡 Medio
- **Export de personal** — Botón presente en StaffManagementView pero sin implementación (CSV/Excel)
- **Mensajería de empleados** — UI visible en EmployeeDetailView pero sin backend
- **Export org chart PDF** — Botón en RolesView, dependencia html-to-image pero sin pruebas en estructuras grandes
- **Historial de versiones de documentos en branch** — BD no siempre recibe la versión anterior cuando storage.move falla

### 🟢 Menor
- **Múltiples conflictos en mismo día** — `getDayConflictLocal` solo muestra el primero
- **Paginación** — Anuncios, Auditoría y Personal cargan todo en memoria sin límite
- **Validación de schema en respuesta Saly AI** — JSON sin validación Zod; cliente puede recibir estructura inesperada

---

## 4. DEUDA TÉCNICA 🏗️

### 🟡 Medio
- `LoginView.jsx` — Lógica de scanner (300+ líneas en un solo effect) → extraer a `useBarcodeScan` hook
- `systemSlice.js` — Boot secuencial (~200 líneas); queries independientes (holidays, shifts, roles) podrían ir en `Promise.all`
- `branchSlice.js` — `sanitizeForJsonb()` no maneja File/Blob anidados recursivamente; puede corromper settings complejos
- `FormNovedad.jsx` — Validation effect con 10+ condiciones anidadas; difícil de testear
- `App.jsx` — `openModal()` con múltiples if/else; debería ser un `modalConfig` object
- Patrones de routing mezclados: algunos componentes usan `setView()`, otros `useNavigate()` directamente

### 🟢 Menor
- Sin tests unitarios visibles en ningún módulo
- `employeeSlice.js` cache de asistencia solo guarda 24h; sin forma de recuperar histórico desde localStorage
- `auditSlice.js` throttle de 1.5s hardcodeado; debería ser configurable por tipo de acción

---

## 5. PENDIENTES DE ESTA SESIÓN ⏳

### 🔴 Sin resolver
- **Double fetch al editar** — `registerEmployeeEvent` dispara `force-history-refresh` internamente; al llamarlo desde `editEmployeeEvent` se generan 2 `fetchWeekRosters` en SchedulesView. Fix: agregar `options.silent = true` para suprimir el dispatch interno cuando se llama desde `editEmployeeEvent`.

### 🟡 Implementado pero con limitaciones conocidas
- `editEmployeeEvent` — Funciona pero dispara fetch doble (ver arriba)
- `employee-event-updated` listener en SchedulesView — Llama `fetchWeekRosters`, no `fetchBoot`; rosters se actualizan pero cambio no visible si el empleado no está en la vista actual del planificador

---

## 6. PRÓXIMA SESIÓN 📋

### Prioridad alta
1. **Fix double fetch** — `options.silent` en `registerEmployeeEvent` para no despachar `force-history-refresh` cuando es llamado desde `editEmployeeEvent`
2. **Seguridad: password predecible** — Password random en `ensure_user_by_code` + flag `must_change_password` en metadata
3. **Fix scanner race condition** — Mover `cancelled` fuera del async en `LoginView`
4. **Fix midnight shift logic** — `AttendanceAuditView:157` mover incremento de fecha antes de comparación

### Prioridad media
5. **Export personal** — Implementar CSV desde StaffManagementView
6. **Múltiples conflictos en día** — Extender `getDayConflictLocal` para retornar array
7. **Fix null role mapping** — Agregar fallback `'Sin Cargo'` en `systemSlice` mapeo de empleados

### Prioridad baja
8. Paginación en listas grandes (Staff, Audit, Announcements)
9. Extraer `useBarcodeScan` hook desde LoginView
10. Estandarizar routing a `useNavigate` en toda la app
