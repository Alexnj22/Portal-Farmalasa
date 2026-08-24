// La bandeja de solicitudes y cinco catálogos de sala.
//
// La bandeja se prueba por lo que ya le pasó TRES veces: un filtro del navegador
// más angosto que el RLS la dejó vacía, y cero filas se ve idéntico a «no hay
// solicitudes». Medido en producción el 2026-08-17: Talento Humano veía **0 de 5
// pendientes** y Bodega **0 de 4 traslados**, con el aviso llegándoles igual.
//
// El resto son consultas de catálogo, y lo que se ancla en ellas es lo mismo de
// siempre: que lo que se pide entero se pagine, que el orden sea total, y que un
// filtro opcional ausente NO se convierta en `eq(col, null)` —que devuelve cero
// filas y se lee como «no hay»—.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchApprovalRequestsList, fetchEmployeeApprovalRequestsDetail, fetchEmployeeUnavailable,
        fetchBranchAdmins } = await import('../../src/data/requests');
const { fetchBranchDocuments, fetchActiveKioskDeviceCount, fetchBranchExpensesHistory,
        fetchBranchExpenseRecord } = await import('../../src/data/branches');
const { fetchScheduleCoverageAtBranch, fetchScheduleCoverageFromBranch } =
    await import('../../src/data/schedules');
const { fetchVacationHeaders, updateVacationPlansBulkPreApprove, fetchVacationChangeRequests } =
    await import('../../src/data/vacationPlans');
const { fetchSurveys, fetchSurveyBloques, fetchSurveyPreguntas } =
    await import('../../src/data/encuestas');
const { fetchLaboratoriosMinMaxVisibility, fetchActiveProductLabCounts } =
    await import('../../src/data/minmaxLabs');

beforeEach(() => espia.limpiar());

describe('la bandeja de solicitudes', () => {
    it('PAGINA: `approval_requests` sólo crece', async () => {
        // Al sacar el filtro de `approver_id`, la consulta pasó a traer todo lo
        // que el RLS deja pasar. Sin paginar, el día que cruce las 1000 filas
        // PostgREST corta ahí — el MISMO fallo mudo que se acababa de arreglar,
        // por la puerta de al lado.
        await fetchApprovalRequestsList({});
        expect(espia.tabla()).toBe('approval_requests');
        expect(espia.uso('range')).toBe(true);
    });

    it('el orden es TOTAL: `created_at` y después `id`', async () => {
        // `range()` corta por posición. Hoy `created_at` no empata —36 filas, 36
        // instantes— pero el default es `now()`, el instante de la TRANSACCIÓN,
        // así que dos filas insertadas juntas nacerían con el mismo sello.
        await fetchApprovalRequestsList({});
        expect(espia.todos('order')).toEqual([
            ['created_at', { ascending: false }],
            ['id', { ascending: false }],
        ]);
    });

    it('«sólo míos» son DOS cosas: lo que mandé y lo que me toca contestar', async () => {
        // El primer nivel de un cambio de turno lo responde el compañero, no una
        // jefatura. Sin la segunda mitad, encender ese alcance apagaba los
        // cambios de turno sin decirlo.
        await fetchApprovalRequestsList({ soloMiasId: 7 });
        const [expr] = espia.primero('or');
        expect(expr).toContain('employee_id.eq.7');
        expect(expr).toContain('approver_id.eq.7');
    });

    it('el recorte por sala NO puede descartar los traslados', async () => {
        // Es el único tipo donde quien pide y quien contesta están en salas
        // distintas: su `employee_id` es de la otra sala POR DEFINICIÓN. Con el
        // filtro a secas, Bodega veía 0 de 4 traslados pendientes.
        await fetchApprovalRequestsList({ branchEmpIds: [1, 2, 3] });
        const [expr] = espia.primero('or');
        expect(expr).toContain('employee_id.in.(1,2,3)');
        expect(expr).toContain('type.eq.INVENTORY_TRANSFER_REQUEST');
    });

    it('sin sala ni alcance propio no agrega ningún recorte', async () => {
        // Quién ve qué lo decide el RLS. La vista ordena después.
        await fetchApprovalRequestsList({});
        expect(espia.uso('or')).toBe(false);
        expect(espia.uso('eq')).toBe(false);
    });

    it('una lista vacía de la sala tampoco recorta', async () => {
        // `employee_id.in.()` no es una consulta válida, y un `in` con lista
        // vacía devolvería cero filas.
        await fetchApprovalRequestsList({ branchEmpIds: [] });
        expect(espia.uso('or')).toBe(false);
    });

    it('el historial de una persona también pagina y ordena total', async () => {
        await fetchEmployeeApprovalRequestsDetail(7);
        expect(espia.uso('range')).toBe(true);
        expect(espia.todos('order')).toHaveLength(2);
        expect(espia.primero('eq')).toEqual(['employee_id', 7]);
    });
});

describe('el enrutador de aprobadores', () => {
    it('la disponibilidad se PREGUNTA, no se lee la tabla', async () => {
        // Antes se traían los eventos DE OTRA PERSONA y se decidía en el
        // cliente, lo que obligaba a tener `employee_events` abierta a
        // cualquiera. Y cerrarla con la versión vieja habría sido un fallo
        // callado: cero filas, «disponible» sin error, y la solicitud a alguien
        // de vacaciones.
        await fetchEmployeeUnavailable(7);
        expect(espia.rpc[0]).toEqual({ nombre: 'empleado_no_disponible', args: { p_employee_id: 7 } });
        expect(espia.uso('from')).toBe(false);
    });

    it('«quién es admin» se decide por `system_role`, no por una columna que no existe', async () => {
        // Las tres consultas de fallback pedían `employees.is_admin`, que NO
        // existe: el `.eq()` devuelve error, el llamador lo lee como «no hay
        // nadie» y la solicitud se queda SIN APROBADOR.
        await fetchBranchAdmins(4, 7);
        const columnas = espia.todos('in').concat(espia.todos('eq')).flat();
        expect(JSON.stringify(columnas)).not.toContain('is_admin');
        expect(JSON.stringify(columnas)).toMatch(/system_role|ADMIN/);
    });
});

describe('el expediente de la sala', () => {
    it('los documentos salen del más nuevo al más viejo', async () => {
        await fetchBranchDocuments(4);
        expect(espia.primero('order')).toEqual(['created_at', { ascending: false }]);
    });

    it('contar kioscos activos pide el NÚMERO y filtra por estado', async () => {
        await fetchActiveKioskDeviceCount(4);
        expect(espia.primero('select')[1]).toEqual({ count: 'exact', head: true });
        expect(espia.todos('eq')).toContainEqual(['status', 'ACTIVE']);
    });

    it('el historial de gastos son sólo los PAGADOS, en orden cronológico', async () => {
        // Es una serie que se grafica: mezclar los pendientes la haría saltar.
        await fetchBranchExpensesHistory(4);
        expect(espia.todos('eq')).toContainEqual(['status', 'PAGADO']);
        expect(espia.primero('order')).toEqual(['billing_month', { ascending: true }]);
    });

    it('un gasto se identifica por sala + tipo + mes, no por uno solo', async () => {
        // Es la clave que evita cargar dos veces la misma factura del mes.
        await fetchBranchExpenseRecord(4, 'AGUA', '2026-08');
        expect(espia.todos('eq')).toEqual([
            ['branch_id', 4], ['expense_type', 'AGUA'], ['billing_month', '2026-08'],
        ]);
    });
});

describe('la cobertura entre salas', () => {
    it('se pregunta por la semana, no por el mes entero', async () => {
        await fetchScheduleCoverageAtBranch(4, '2026-08-17');
        expect(espia.tabla()).toBe('schedule_coverage');
        expect(espia.todos('eq')).toContainEqual(['week_start_date', '2026-08-17']);
    });

    it('la sala que CUBRE y la gente que va son dos consultas distintas', async () => {
        // Una pregunta «a quién recibo» y la otra «a dónde van los míos»: no son
        // la misma fila leída al revés.
        await fetchScheduleCoverageAtBranch(4, '2026-08-17');
        expect(espia.todos('eq')).toContainEqual(['coverage_branch_id', 4]);
        espia.limpiar();
        await fetchScheduleCoverageFromBranch([1, 2], '2026-08-17');
        expect(espia.primero('in')).toEqual(['employee_id', [1, 2]]);
    });
});

describe('el plan anual de vacaciones', () => {
    it('los años salen del más nuevo al más viejo', async () => {
        await fetchVacationHeaders();
        expect(espia.primero('order')).toEqual(['year', { ascending: false }]);
    });

    it('pre-aprobar en bloque toca SÓLO los borradores', async () => {
        // Aprobar en bloque no puede pisar una decisión ya tomada.
        await updateVacationPlansBulkPreApprove(3);
        expect(espia.todos('eq')).toContainEqual(['status', 'DRAFT']);
        expect(espia.primero('update')[0].status).toBe('PRE_APPROVED');
    });

    it('los cambios pendientes se piden paginados y con orden total', async () => {
        await fetchVacationChangeRequests();
        expect(espia.uso('range')).toBe(true);
        expect(espia.todos('order')).toHaveLength(2);
        expect(espia.todos('eq')).toContainEqual(['status', 'PENDING']);
    });
});

describe('la encuesta de clima', () => {
    it('los bloques y las preguntas salen en SU número, no como vengan', async () => {
        // Una encuesta con las preguntas desordenadas cambia de significado.
        await fetchSurveyBloques(1);
        expect(espia.primero('order')).toEqual(['numero']);
        espia.limpiar();
        await fetchSurveyPreguntas(1);
        expect(espia.primero('order')).toEqual(['numero']);
    });

    it('las campañas salen de la más reciente', async () => {
        await fetchSurveys();
        expect(espia.primero('order')).toEqual(['año', { ascending: false }]);
    });
});

describe('los laboratorios en el cálculo de Min·Máx', () => {
    it('el conteo por laboratorio lo hace la BASE', async () => {
        // Antes se descargaba `laboratorio_id` de TODOS los productos activos
        // —miles de filas en varios tramos— sólo para reducirlos a un conteo en
        // un `forEach`. Devuelve ~20-30 filas en vez de miles.
        await fetchActiveProductLabCounts();
        expect(espia.rpc[0].nombre).toBe('get_active_product_lab_counts');
        expect(espia.uso('from')).toBe(false);
    });

    it('la lista de laboratorios sale ordenada por nombre', async () => {
        await fetchLaboratoriosMinMaxVisibility();
        expect(espia.primero('order')).toEqual(['nombre']);
        expect(espia.primero('select')[0]).toContain('ocultar_en_minmax');
    });
});
