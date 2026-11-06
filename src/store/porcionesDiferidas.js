// Las porciones del store que sólo usan pantallas de su módulo se bajan al
// PRIMER USO, no en el arranque (2026-11-06, gate:bundle).
//
// El store vive en el chunk de entrada, que todos descargan después de cada
// despliegue. Planilla, plan de vacaciones, conteo de inventario y
// practicantes eran ~35 kB de fuente que viajaban ahí para quien nunca abre
// esas pantallas. Acá queda su estado inicial y una acción de reemplazo por
// cada una: la primera llamada importa la porción real y le pasa la llamada.
// Todas sus acciones son `async`, así que quien las llama no nota la
// diferencia (un `await` de más la primera vez).
//
// Las listas se escriben a mano, y `tests/unit/porcionesDiferidas.test.js` las
// compara con la porción real: agregar una acción allá sin agregarla acá
// pone ese test en rojo, en vez de dejar `undefined` en el store.

// `internas`: ayudantes síncronos que las acciones llaman por `get()` (no las
// pantallas). Se instalan en el store al cargar la porción, antes de que corra
// la primera acción que los necesita.
export function porcionDiferida(cargar, estado, acciones, internas = []) {
  return (set, get, api) => {
    let real = null;
    const obtener = () => {
      if (!real) {
        real = cargar()
          .then((crear) => {
            const porcion = crear(set, get, api);
            if (internas.length) set(Object.fromEntries(internas.map((k) => [k, porcion[k]])));
            return porcion;
          })
          .catch((err) => { real = null; throw err; });  // reintentar, no quedar roto
      }
      return real;
    };
    const porcion = { ...estado };
    for (const nombre of acciones) {
      porcion[nombre] = async (...args) => (await obtener())[nombre](...args);
    }
    return porcion;
  };
}

export const PLANILLA = {
  estado: { payrollPeriods: [], activePayrollPeriod: null, payrollEntries: [], isLoadingPayroll: false },
  acciones: [
    'fetchPayrollPeriods', 'createPayrollPeriod', 'updatePayrollPeriodStatus', 'fetchPayrollEntries',
    'generatePayrollEntries', 'fetchOvertimeBankBalance', 'redeemOvertimeBank', 'updatePayrollEntry',
  ],
};

export const PLAN_VACACIONES = {
  estado: { vacationPlans: [], isLoadingVacationPlans: false, vacationHeaders: [], isGeneratingPlan: false, vacationChangeRequests: [] },
  acciones: [
    'fetchVacationHeaders', 'updateHeaderStatus', 'preApprovePlan', 'generateAIPlan',
    'fetchVacationChangeRequests', 'processChangeRequest', 'fetchVacationPlans', 'createVacationPlan',
    'updateVacationPlan', 'updateVacationPlanStatus', 'deleteVacationPlan',
  ],
};

export const CONTEO_INVENTARIO = {
  estado: { conteosInventario: [], conteosInventarioLoading: false },
  acciones: [
    'fetchConteosInventario', 'crearConteoInventario', 'eliminarConteoInventario', 'previewMuestraCiclica',
    'fetchConteoDetalle', 'fetchConteoProductsPage', 'fetchConteoLaboratorios', 'fetchConteoResumen',
    'sincronizarConteoEnVivo', 'fetchConteoProductItems', 'fetchConteoItemsForProducts', 'fetchConteoPendientesCount',
    'editarLoteConteoItem', 'guardarConteoItem', 'recontarConteoItem', 'fetchConteoItemHistory',
    'agregarProductoManualConteo', 'finalizarConteoInventario', 'aprobarConteoInventario', 'fetchConteoCaja',
    'fetchConteoCajaPlan', 'fetchReguladosSinLote', 'reintentarConteoCaja', 'marcarAjusteErp',
    'fetchTodosLosItemsConteo', 'anotarLotesRealesConteo',
  ],
};

export const PRACTICANTES = {
  estado: { practicantes: [], practicantesLoading: false, practicantesError: null },
  acciones: [
    'fetchPracticantes', 'createPracticante', 'updatePracticante', 'guardarPasantiaDeFicha',
    'deletePracticante',
  ],
};

export const SOLICITUDES = {
  estado: { requests: [], isLoadingRequests: false, personasDeSolicitudes: {} },
  acciones: [
    'resolverPersonasDeSolicitudes', 'fetchRequests', 'createRequest', '_aprobarFacturacion',
    '_aprobarCaja', '_decidirIngreso', '_decidirDistribucion', '_aprobarInventario',
    '_runFinalApproval', 'approveRequest', '_solicitudParaDecidir', 'rejectRequest',
    'approvePeerRequest', 'rejectPeerRequest', 'cancelRequest',
  ],
  internas: ['_decisionesDeAbono', '_avisoDeCaja'],
};
