// src/store/staffStore.js
import { create } from 'zustand';
import { createAuditSlice } from './slices/auditSlice';
import { createBranchSlice } from './slices/branchSlice';
import { createEmployeeSlice } from './slices/employeeSlice';
import { createSystemSlice } from './slices/systemSlice';
import { createNotificationsSlice } from './slices/notificationsSlice';
import { porcionDiferida, SOLICITUDES, PLANILLA, PLAN_VACACIONES, CONTEO_INVENTARIO, PRACTICANTES } from './porcionesDiferidas';
import { registrarNombresElegidos } from '../utils/nameUtils';

export const useStaffStore = create((...args) => ({
  ...createAuditSlice(...args),
  ...createBranchSlice(...args),
  ...createEmployeeSlice(...args),
  ...createSystemSlice(...args),
  // Se baja al primer uso: ver porcionesDiferidas.js.
  ...porcionDiferida(() => import('./slices/requestsAcciones').then((m) => m.createRequestsSlice), SOLICITUDES.estado, SOLICITUDES.acciones, SOLICITUDES.internas)(...args),
  // Se baja al primer uso: ver porcionesDiferidas.js.
  ...porcionDiferida(() => import('./slices/vacationPlanSlice').then((m) => m.createVacationPlanSlice), PLAN_VACACIONES.estado, PLAN_VACACIONES.acciones)(...args),
  // Se baja al primer uso: ver porcionesDiferidas.js.
  ...porcionDiferida(() => import('./slices/payrollSlice').then((m) => m.createPayrollSlice), PLANILLA.estado, PLANILLA.acciones)(...args),
  ...createNotificationsSlice(...args),
  // Se baja al primer uso: ver porcionesDiferidas.js.
  ...porcionDiferida(() => import('./slices/practicantesSlice').then((m) => m.createPracticantesSlice), PRACTICANTES.estado, PRACTICANTES.acciones)(...args),
  // Se baja al primer uso: ver porcionesDiferidas.js.
  ...porcionDiferida(() => import('./slices/conteoInventarioSlice').then((m) => m.createConteoInventarioSlice), CONTEO_INVENTARIO.estado, CONTEO_INVENTARIO.acciones)(...args),
}));

// El nombre que cada persona eligió para el portal se registra en cuanto cambia
// la lista: así lo usa cualquier pantalla que pinte un `id` o un nombre, sin
// que cada consulta tenga que traer las columnas (ver `nameUtils`). Corre
// dentro del `set`, antes de que React vuelva a pintar.
registrarNombresElegidos(useStaffStore.getState().employees);
useStaffStore.subscribe((state, prev) => {
  if (state.employees !== prev.employees) registrarNombresElegidos(state.employees);
});
