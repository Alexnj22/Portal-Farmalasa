// src/store/staffStore.js
import { create } from 'zustand';
import { createAuditSlice } from './slices/auditSlice';
import { createBranchSlice } from './slices/branchSlice';
import { createEmployeeSlice } from './slices/employeeSlice';
import { createSystemSlice } from './slices/systemSlice';
import { createRequestsSlice } from './slices/requestsSlice';
import { createVacationPlanSlice } from './slices/vacationPlanSlice';
import { createPayrollSlice } from './slices/payrollSlice';
import { createNotificationsSlice } from './slices/notificationsSlice';
import { createPracticantesSlice } from './slices/practicantesSlice';
import { createConteoInventarioSlice } from './slices/conteoInventarioSlice';
import { registrarNombresElegidos } from '../utils/nameUtils';

export const useStaffStore = create((...args) => ({
  ...createAuditSlice(...args),
  ...createBranchSlice(...args),
  ...createEmployeeSlice(...args),
  ...createSystemSlice(...args),
  ...createRequestsSlice(...args),
  ...createVacationPlanSlice(...args),
  ...createPayrollSlice(...args),
  ...createNotificationsSlice(...args),
  ...createPracticantesSlice(...args),
  ...createConteoInventarioSlice(...args),
}));

// El nombre que cada persona eligió para el portal se registra en cuanto cambia
// la lista: así lo usa cualquier pantalla que pinte un `id` o un nombre, sin
// que cada consulta tenga que traer las columnas (ver `nameUtils`). Corre
// dentro del `set`, antes de que React vuelva a pintar.
registrarNombresElegidos(useStaffStore.getState().employees);
useStaffStore.subscribe((state, prev) => {
  if (state.employees !== prev.employees) registrarNombresElegidos(state.employees);
});
