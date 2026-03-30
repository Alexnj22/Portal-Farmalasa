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
  PROMOTION: { label: 'Cambio de Cargo', color: 'bg-purple-100 text-purple-800', icon: TrendingUp, requiresDuration: false, requiresNewRole: true, defaultDocType: 'CONTRACT' },
  TRANSFER: { label: 'Traslado de Sucursal', color: 'bg-blue-100 text-blue-800', icon: ArrowRightLeft, requiresDuration: false, requiresTargetBranch: true, defaultDocType: 'MEMO' },
  SUPPORT: { label: 'Apoyo Temporal', color: 'bg-orange-100 text-orange-800', icon: Building2, requiresDuration: true, requiresTargetBranch: true, defaultDocType: 'MEMO' },
  CODE_CHANGE: { label: 'Cambio de Código/ID', color: 'bg-indigo-100 text-indigo-800', icon: IdCard, requiresDuration: false, requiresNewCode: true, defaultDocType: 'OTHER' },
  INDUCTION: { label: 'Inducción', color: 'bg-teal-100 text-teal-800', icon: GraduationCap, requiresDuration: true, defaultDocType: 'OTHER' },
  SHIFT_CHANGE: { label: 'Cambio de Turno', color: 'bg-cyan-100 text-cyan-800', icon: Watch, requiresDuration: false, defaultDocType: 'MEMO' },
  TERMINATION: { label: 'Liquidación/Renuncia', color: 'bg-gray-800 text-white', icon: LogOut, requiresDuration: false, defaultDocType: 'CONTRACT' },
};


export const WEEK_DAYS = [
  { id: 1, name: 'Lunes' }, { id: 2, name: 'Martes' }, { id: 3, name: 'Miércoles' }, { id: 4, name: 'Jueves' },
  { id: 5, name: 'Viernes' }, { id: 6, name: 'Sábado' }, { id: 0, name: 'Domingo' },
];



// ---------- Helpers demo (marcajes de HOY) ----------
const isoToday = () => new Date().toISOString().slice(0, 10);


