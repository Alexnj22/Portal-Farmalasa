// src/store/staffStore.js
import { create } from 'zustand';
import { createAuditSlice } from './slices/auditSlice';
import { createBranchSlice } from './slices/branchSlice';
import { createEmployeeSlice } from './slices/employeeSlice';
import { createSystemSlice } from './slices/systemSlice';
import { createRequestsSlice } from './slices/requestsSlice';
import { createVacationPlanSlice } from './slices/vacationPlanSlice';
import { createPayrollSlice } from './slices/payrollSlice';

export const useStaffStore = create((...args) => ({
  ...createAuditSlice(...args),
  ...createBranchSlice(...args),
  ...createEmployeeSlice(...args),
  ...createSystemSlice(...args),
  ...createRequestsSlice(...args),
  ...createVacationPlanSlice(...args),
  ...createPayrollSlice(...args),
}));