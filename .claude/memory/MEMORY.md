# Memory Index

- [Project Architecture](project_architecture.md) — Unified AppLayout, RBAC with role_permissions, route structure
- [Git Push After Changes](feedback_git_push.md) — Always commit + push after every code change
- [Always Log Actions to Audit](feedback_audit_log.md) — Every user action must call appendAuditLog from staffStore (audit_logs table)
- [New Module Checklist](feedback_new_module_checklist.md) — 5 steps required every time a new module is added (view, route, menu, permissions screen, DB)
- [Floating Header Search Standard](feedback_floating_header_standard.md) — Sliding search mode pattern (isSearchMode + ChevronRight), not inline toggle
- [DTE Sync Architecture & Known Fixes](project_dte_sync_state.md) — sync-dte-sales v15 fixes, FK removed, puntos detection, DB state after 2026-05 resync
- [UI Design Standards](feedback_ui_design_standards.md) — Filter pill (LiquidSelect), stat cards, table rows, color palette — must be consistent across ALL modules
- [Supabase 1000-Row Cap](feedback_supabase_row_limit.md) — NEVER omit .range() — PostgREST silently truncates at 1000 rows with no error
