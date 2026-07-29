-- ============================================================
-- DB AUDIT CLEANUP v6 — Índices faltantes en columnas FK
-- ============================================================

-- cotizacion_items: cotizacion_id es el filtro principal al abrir una cotización
CREATE INDEX IF NOT EXISTS idx_cotizacion_items_cotizacion ON cotizacion_items(cotizacion_id);

-- employees: role_id se consulta en cada carga de permisos
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role_id);

-- cotizaciones: customer_id para búsquedas por cliente
CREATE INDEX IF NOT EXISTS idx_cotizaciones_customer ON cotizaciones(customer_id) WHERE customer_id IS NOT NULL;

-- approval_requests: approver_id para filtrar solicitudes por aprobador
CREATE INDEX IF NOT EXISTS idx_approval_requests_approver ON approval_requests(approver_id) WHERE approver_id IS NOT NULL;

-- branch_documents: branch_id para cargar documentos por sucursal
CREATE INDEX IF NOT EXISTS idx_branch_documents_branch ON branch_documents(branch_id);

-- branch_expenses: branch_id para cargar gastos por sucursal
CREATE INDEX IF NOT EXISTS idx_branch_expenses_branch ON branch_expenses(branch_id);

-- timesheets: scheduled_shift_id para queries de horarios
CREATE INDEX IF NOT EXISTS idx_timesheets_shift ON timesheets(scheduled_shift_id) WHERE scheduled_shift_id IS NOT NULL;

-- sales_payment_confirmations: invoice_id para búsqueda por factura
CREATE INDEX IF NOT EXISTS idx_payment_confirmations_invoice ON sales_payment_confirmations(invoice_id);
