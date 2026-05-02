---
name: Always Log Actions to Audit
description: Every user action must be logged to audit_logs via appendAuditLog from staffStore
type: feedback
originSessionId: 02d464e3-41d3-4e74-b3d6-f29d7b197bc7
---
Every time a user performs an action (insert, update, delete, resolve, approve, etc.), always call `appendAuditLog` from the staffStore.

**How to use:**
```js
const appendAuditLog = useStaffStore.getState().appendAuditLog;
// or via hook:
const appendAuditLog = useStaff((state) => state.appendAuditLog);

await appendAuditLog(
  'ACCION_EN_MAYUSCULAS',   // action string
  String(targetId),          // target_id
  { ...details }             // jsonb details — put relevant context here
);
```

**Table:** `audit_logs` — columns: user_id, user_name (auto from localStorage sb_user), action, target_id, details (jsonb), source, severity, branch_id, branch_name.

**Severity** is inferred automatically: CRITICAL if action contains ELIMINAR/REVOCAR/FRAUDE, WARNING if FALLO/ERROR, INFO otherwise.

**Why:** The user explicitly requires audit trails for all actions. "Siempre siempre que haya una accion, guarda quien la hizo como auditoria."

**How to apply:** Before marking any feature with user-initiated writes as done, add the appendAuditLog call. Do not wait for the user to remind you.
