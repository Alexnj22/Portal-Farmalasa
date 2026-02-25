import {
  FileText, IdCard, User, HeartPulse, AlertCircle, Paperclip, Calendar,
  TrendingUp, ArrowRightLeft, Building2, Watch, LogOut, GraduationCap, ClipboardList
} from 'lucide-react';

export const DOCUMENT_TYPES = {
  CONTRACT: { label: 'Contrato Laboral', icon: FileText, color: 'text-blue-600 bg-blue-50' },
  ID: { label: 'DUI / Identidad / Pasaporte', icon: IdCard, color: 'text-purple-600 bg-purple-50' },
  CV: { label: 'Hoja de Vida (CV)', icon: User, color: 'text-green-600 bg-green-50' },
  MEDICAL: { label: 'Incapacidad / Constancia', icon: HeartPulse, color: 'text-red-600 bg-red-50' },
  MEMO: { label: 'Memorándum / Sanción', icon: AlertCircle, color: 'text-orange-600 bg-orange-50' },
  OTHER: { label: 'Otro Documento', icon: Paperclip, color: 'text-slate-600 bg-slate-50' },
};

export const EVENT_TYPES = {
  VACATION: { label: 'Vacaciones', color: 'bg-green-100 text-green-800', icon: Calendar, requiresDuration: true, defaultDocType: 'MEMO' },
  DISABILITY: { label: 'Incapacidad Médica', color: 'bg-red-100 text-red-800', icon: HeartPulse, requiresDuration: true, defaultDocType: 'MEDICAL' },
  PERMIT: { label: 'Permiso / Licencia', color: 'bg-yellow-100 text-yellow-800', icon: ClipboardList, requiresDuration: true, defaultDocType: 'MEMO' },
  PROMOTION: { label: 'Ascenso', color: 'bg-purple-100 text-purple-800', icon: TrendingUp, requiresDuration: false, requiresNewRole: true, defaultDocType: 'CONTRACT' },
  TRANSFER: { label: 'Traslado de Sucursal', color: 'bg-blue-100 text-blue-800', icon: ArrowRightLeft, requiresDuration: false, requiresTargetBranch: true, defaultDocType: 'MEMO' },
  SUPPORT: { label: 'Apoyo Temporal', color: 'bg-orange-100 text-orange-800', icon: Building2, requiresDuration: true, requiresTargetBranch: true, defaultDocType: 'MEMO' },
  ID_CHANGE: { label: 'Cambio de Código/ID', color: 'bg-indigo-100 text-indigo-800', icon: IdCard, requiresDuration: false, requiresNewCode: true, defaultDocType: 'OTHER' },
  INDUCTION: { label: 'Inducción', color: 'bg-teal-100 text-teal-800', icon: GraduationCap, requiresDuration: true, defaultDocType: 'OTHER' },
  SHIFT_CHANGE: { label: 'Cambio de Turno', color: 'bg-cyan-100 text-cyan-800', icon: Watch, requiresDuration: false, defaultDocType: 'MEMO' },
  TERMINATION: { label: 'Liquidación/Renuncia', color: 'bg-gray-800 text-white', icon: LogOut, requiresDuration: false, defaultDocType: 'CONTRACT' },
};

export const INITIAL_ROLES = [
  'Gerente General',
  'Gerente de Sucursal',
  'Vendedor Senior',
  'Vendedor Junior',
  'Cajero',
  'Bodeguero',
  'Auxiliar Administrativo',
  'Limpieza'
];

export const WEEK_DAYS = [
  { id: 1, name: 'Lunes' }, { id: 2, name: 'Martes' }, { id: 3, name: 'Miércoles' }, { id: 4, name: 'Jueves' },
  { id: 5, name: 'Viernes' }, { id: 6, name: 'Sábado' }, { id: 0, name: 'Domingo' },
];

// Helper local para generar horarios por defecto
const generateDefaultBranchSchedule = () => {
  const schedule = {};
  [1, 2, 3, 4, 5].forEach(d => schedule[d] = { start: '08:00', end: '17:00', isOpen: true });
  schedule[6] = { start: '08:00', end: '12:00', isOpen: true };
  schedule[0] = { start: '08:00', end: '17:00', isOpen: false };
  return schedule;
};

// ✅ NO CAMBIAR SUCURSALES (exactamente como las tenías)
export const INITIAL_BRANCHES = [
  { id: 1, name: 'La Popular', address: 'Av. Principal #123', phone: '2222-0001', cell: '7000-0001', weeklyHours: generateDefaultBranchSchedule() },
  { id: 2, name: 'Salud 1', address: 'Zona Industrial Calle 4', phone: '2222-0002', cell: '7000-0002', weeklyHours: generateDefaultBranchSchedule() },
  { id: 3, name: 'Salud 2', address: 'Plaza Norte, Local 5', phone: '2222-0003', cell: '7000-0003', weeklyHours: generateDefaultBranchSchedule() },
  { id: 4, name: 'Salud 3', address: 'Carretera al Sur Km 10', phone: '2222-0004', cell: '7000-0004', weeklyHours: generateDefaultBranchSchedule() },
  { id: 5, name: 'Salud 4', address: 'Carretera al Sur Km 15', phone: '2222-0005', cell: '7000-0005', weeklyHours: generateDefaultBranchSchedule() },
  { id: 6, name: 'Salud 5', address: 'Carretera al Sur Km 20', phone: '2222-0006', cell: '7000-0006', weeklyHours: generateDefaultBranchSchedule() },
  { id: 7, name: 'Bodega', address: 'Carretera al Sur Km 25', phone: '2222-0007', cell: '7000-0007', weeklyHours: generateDefaultBranchSchedule() },
  { id: 8, name: 'Admin', address: 'Carretera al Sur Km 30', phone: '2222-0008', cell: '7000-0008', weeklyHours: generateDefaultBranchSchedule() },
];

// ---------- Helpers demo (marcajes de HOY) ----------
const isoToday = () => new Date().toISOString().slice(0, 10);
// Nota: para demo está bien. Si en tu app usas local time, ajustamos luego.
const isoAtZ = (hhmm) => `${isoToday()}T${hhmm}:00.000Z`;
const punch = (type, hhmm) => ({ timestamp: isoAtZ(hhmm), type, details: {} });

// ✅ Más turnos para probar estados (sin tocar sucursales)
export const INITIAL_SHIFTS = [
  { id: 1, branchId: 8, name: 'Administrativo', start: '08:00', end: '17:00', lunchStart: '12:00', color: 'bg-blue-100 text-blue-800 border-blue-200' },

  { id: 2, branchId: 3, name: 'Matutino Norte', start: '06:00', end: '14:00', lunchStart: '10:00', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  { id: 3, branchId: 3, name: 'Vespertino Norte', start: '14:00', end: '22:00', lunchStart: '18:00', color: 'bg-orange-100 text-orange-800 border-orange-200' },

  { id: 4, branchId: 1, name: 'Administrativo Popular', start: '08:00', end: '17:00', lunchStart: '12:00', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  { id: 5, branchId: 2, name: 'Administrativo Salud 1', start: '08:00', end: '17:00', lunchStart: '12:00', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },

  { id: 6, branchId: 7, name: 'Bodega', start: '07:00', end: '16:00', lunchStart: '12:00', color: 'bg-slate-100 text-slate-800 border-slate-200' },

  { id: 7, branchId: 1, name: 'Sábado Corto', start: '08:00', end: '12:00', lunchStart: '', color: 'bg-slate-100 text-slate-700 border-slate-200' },
];

// ✅ Más empleados (escenarios completos)
export const INITIAL_EMPLOYEES = [
  // Admin (leve tarde + lunch ok)
  {
    id: 101, code: 'EMP001', name: 'Juan Pérez', role: 'Gerente General',
    email: 'juan.perez@empresa.com', phone: '7000-0001', branchId: 8, shiftId: 1,
    hireDate: '2020-01-15', birthDate: '1990-05-15', dui: '12345678-9',
    afp: 'CONFIA', bank: 'Agricola', account: '111-222-333', profession: 'Administrador de Empresas',
    status: 'Activo', photo: null, documents: [],
    history: [{ id: 1, type: 'SHIFT_CHANGE', date: '2020-01-15', note: 'Asignación inicial', newShiftId: 1 }],
    attendance: [
      punch('IN', '08:08'),
      punch('OUT_LUNCH', '12:00'),
      punch('IN_LUNCH', '13:00'),
    ],
    isAdmin: true, username: 'admin', password: '123',
    weeklySchedule: {
      1: { shiftId: 1, lunchTime: '12:00', lactationTime: '' },
      2: { shiftId: 1, lunchTime: '12:30', lactationTime: '' },
      3: { shiftId: 1, lunchTime: '13:00', lactationTime: '' },
      4: { shiftId: 1, lunchTime: '12:00', lactationTime: '' },
      5: { shiftId: 1, lunchTime: '12:00', lactationTime: '' },
      6: { shiftId: null }, 0: { shiftId: null }
    }
  },

  // Matutino con lactancia (en lunch actualmente)
  {
    id: 102, code: 'EMP002', name: 'Ana García', role: 'Vendedor Senior',
    email: 'ana.garcia@empresa.com', phone: '7000-0002', branchId: 3, shiftId: 2,
    hireDate: '2021-05-20', birthDate: '1995-08-22', dui: '98765432-1',
    afp: 'CRECER', bank: 'BAC', account: '444-555-666', profession: 'Bachiller',
    status: 'Activo', photo: null, documents: [],
    hasLactation: true,
    history: [
      { id: 2, type: 'SHIFT_CHANGE', date: '2021-05-20', note: 'Asignación inicial', newShiftId: 2 },
    ],
    attendance: [
      punch('IN', '06:18'),       // tarde vs 06:00
      punch('OUT_LUNCH', '10:05') // lunch activo
    ],
    isAdmin: false, username: '', password: '',
    weeklySchedule: {
      1: { shiftId: 2, lunchTime: '10:00', lactationTime: '13:00' },
      2: { shiftId: 2, lunchTime: '10:30', lactationTime: '13:00' },
      3: { shiftId: 3, lunchTime: '18:00', lactationTime: '21:00' },
      4: { shiftId: null },
      5: { shiftId: 3, lunchTime: '17:00', lactationTime: '21:00' },
      6: { shiftId: 7, lunchTime: '', lactationTime: '' },
      0: { shiftId: null }
    }
  },

  // Pendiente (sin marcas) - Popular
  {
    id: 103, code: 'EMP003', name: 'Carlos Martínez', role: 'Cajero',
    email: 'carlos.martinez@empresa.com', phone: '7000-0003', branchId: 1, shiftId: 4,
    hireDate: '2022-03-10', birthDate: '1998-11-02', dui: '10293847-5',
    afp: 'CONFIA', bank: 'Agricola', account: '222-333-444', profession: 'Bachiller',
    status: 'Activo', photo: null, documents: [],
    history: [{ id: 4, type: 'SHIFT_CHANGE', date: '2022-03-10', note: 'Asignación inicial', newShiftId: 4 }],
    attendance: [],
    isAdmin: false, username: '', password: '',
    weeklySchedule: {
      1: { shiftId: 4, lunchTime: '12:00', lactationTime: '' },
      2: { shiftId: 4, lunchTime: '12:00', lactationTime: '' },
      3: { shiftId: 4, lunchTime: '12:00', lactationTime: '' },
      4: { shiftId: 4, lunchTime: '12:00', lactationTime: '' },
      5: { shiftId: 4, lunchTime: '12:00', lactationTime: '' },
      6: { shiftId: 7, lunchTime: '', lactationTime: '' },
      0: { shiftId: null }
    }
  },

  // Finalizado (OUT) - Salud 1
  {
    id: 104, code: 'EMP004', name: 'María López', role: 'Vendedor Junior',
    email: 'maria.lopez@empresa.com', phone: '7000-0004', branchId: 2, shiftId: 5,
    hireDate: '2023-07-01', birthDate: '2000-01-19', dui: '55667788-1',
    afp: 'CRECER', bank: 'BAC', account: '555-666-777', profession: 'Estudiante',
    status: 'Activo', photo: null, documents: [],
    history: [{ id: 5, type: 'SHIFT_CHANGE', date: '2023-07-01', note: 'Asignación inicial', newShiftId: 5 }],
    attendance: [
      punch('IN', '08:00'),
      punch('OUT_LUNCH', '12:00'),
      punch('IN_LUNCH', '13:00'),
      punch('OUT', '17:01'),
    ],
    isAdmin: false, username: '', password: '',
    weeklySchedule: {
      1: { shiftId: 5, lunchTime: '12:00', lactationTime: '' },
      2: { shiftId: 5, lunchTime: '12:00', lactationTime: '' },
      3: { shiftId: 5, lunchTime: '12:00', lactationTime: '' },
      4: { shiftId: 5, lunchTime: '12:00', lactationTime: '' },
      5: { shiftId: 5, lunchTime: '12:00', lactationTime: '' },
      6: { shiftId: null },
      0: { shiftId: null }
    }
  },

  // Lactancia activa (OUT_LACTATION) - Salud 5
  {
    id: 105, code: 'EMP005', name: 'Sofía Hernández', role: 'Auxiliar Administrativo',
    email: 'sofia.hernandez@empresa.com', phone: '7000-0005', branchId: 6, shiftId: 1,
    hireDate: '2022-09-12', birthDate: '1996-04-09', dui: '66778899-0',
    afp: 'CONFIA', bank: 'Agricola', account: '888-999-000', profession: 'Administración',
    status: 'Activo', photo: null, documents: [],
    hasLactation: true,
    history: [{ id: 6, type: 'SHIFT_CHANGE', date: '2022-09-12', note: 'Asignación inicial', newShiftId: 1 }],
    attendance: [
      punch('IN', '08:00'),
      punch('OUT_LACTATION', '16:00'),
    ],
    isAdmin: false, username: '', password: '',
    weeklySchedule: {
      1: { shiftId: 1, lunchTime: '12:00', lactationTime: '16:00' },
      2: { shiftId: 1, lunchTime: '12:00', lactationTime: '16:00' },
      3: { shiftId: 1, lunchTime: '12:00', lactationTime: '16:00' },
      4: { shiftId: 1, lunchTime: '12:00', lactationTime: '16:00' },
      5: { shiftId: 1, lunchTime: '12:00', lactationTime: '16:00' },
      6: { shiftId: null },
      0: { shiftId: null }
    }
  },

  // Extra working (IN_EXTRA) - Bodega
  {
    id: 106, code: 'EMP006', name: 'Roberto Castillo', role: 'Bodeguero',
    email: 'roberto.castillo@empresa.com', phone: '7000-0006', branchId: 7, shiftId: 6,
    hireDate: '2019-11-05', birthDate: '1989-02-14', dui: '33445566-7',
    afp: 'CRECER', bank: 'BAC', account: '101-202-303', profession: 'Logística',
    status: 'Activo', photo: null, documents: [],
    history: [{ id: 7, type: 'SHIFT_CHANGE', date: '2019-11-05', note: 'Asignación inicial', newShiftId: 6 }],
    attendance: [
      punch('IN', '07:00'),
      punch('OUT', '16:00'),
      punch('IN_EXTRA', '18:10'),
    ],
    isAdmin: false, username: '', password: '',
    weeklySchedule: {
      1: { shiftId: 6, lunchTime: '12:00', lactationTime: '' },
      2: { shiftId: 6, lunchTime: '12:00', lactationTime: '' },
      3: { shiftId: 6, lunchTime: '12:00', lactationTime: '' },
      4: { shiftId: 6, lunchTime: '12:00', lactationTime: '' },
      5: { shiftId: 6, lunchTime: '12:00', lactationTime: '' },
      6: { shiftId: null },
      0: { shiftId: null }
    }
  },

  // Early exit (OUT_EARLY) - Salud 4
  {
    id: 107, code: 'EMP007', name: 'Valeria Díaz', role: 'Limpieza',
    email: 'valeria.diaz@empresa.com', phone: '7000-0007', branchId: 5, shiftId: 1,
    hireDate: '2024-02-01', birthDate: '2002-12-30', dui: '88990011-2',
    afp: 'CONFIA', bank: 'Agricola', account: '303-404-505', profession: 'Servicios',
    status: 'Activo', photo: null, documents: [],
    history: [{ id: 8, type: 'PERMIT', date: isoToday(), endDate: isoToday(), note: 'Salida por diligencia.', documentId: null }],
    attendance: [
      punch('IN', '08:00'),
      punch('OUT_EARLY', '15:10'),
    ],
    isAdmin: false, username: '', password: '',
    weeklySchedule: {
      1: { shiftId: 1, lunchTime: '12:00', lactationTime: '' },
      2: { shiftId: 1, lunchTime: '12:00', lactationTime: '' },
      3: { shiftId: 1, lunchTime: '12:00', lactationTime: '' },
      4: { shiftId: 1, lunchTime: '12:00', lactationTime: '' },
      5: { shiftId: 1, lunchTime: '12:00', lactationTime: '' },
      6: { shiftId: null },
      0: { shiftId: null }
    }
  },

  // Off day total (sin turno) - Salud 3
  {
    id: 108, code: 'EMP008', name: 'Diego Rivas', role: 'Vendedor Junior',
    email: 'diego.rivas@empresa.com', phone: '7000-0008', branchId: 4, shiftId: 3,
    hireDate: '2023-11-01', birthDate: '1999-06-11', dui: '11223344-5',
    afp: 'CRECER', bank: 'BAC', account: '606-707-808', profession: 'Ventas',
    status: 'Activo', photo: null, documents: [],
    history: [{ id: 9, type: 'SHIFT_CHANGE', date: '2023-11-01', note: 'Asignación inicial', newShiftId: 3 }],
    attendance: [],
    isAdmin: false, username: '', password: '',
    weeklySchedule: {
      1: { shiftId: null },
      2: { shiftId: null },
      3: { shiftId: null },
      4: { shiftId: null },
      5: { shiftId: null },
      6: { shiftId: null },
      0: { shiftId: null }
    }
  },
];