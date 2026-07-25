import {
  FileText, IdCard, User, HeartPulse, AlertCircle, Paperclip, Calendar,
  TrendingUp, ArrowRightLeft, Building2, Watch, LogOut, GraduationCap, ClipboardList, DollarSign, RefreshCw
} from 'lucide-react';

// Bucket B (DESIGN.md §6) — categórico genuino, sin jerarquía de severidad.
export const DOCUMENT_TYPES = {
  CONTRACT: { label: 'Contrato Laboral', icon: FileText, color: 'text-chart-1-text bg-chart-1/10' },
  ID: { label: 'DUI / Identidad / Pasaporte', icon: IdCard, color: 'text-chart-3-text bg-chart-3/10' },
  CV: { label: 'Hoja de Vida (CV)', icon: User, color: 'text-chart-2-text bg-chart-2/10' },
  MEDICAL: { label: 'Incapacidad / Constancia', icon: HeartPulse, color: 'text-chart-6-text bg-chart-6/10' },
  MEMO: { label: 'Memorándum / Sanción', icon: AlertCircle, color: 'text-chart-4-text bg-chart-4/10' },
  OTHER: { label: 'Otro Documento', icon: Paperclip, color: 'text-content-3 bg-surface-card-hover' },
};

// Bucket B categórico (tipos de evento) salvo TERMINATION, que es Bucket A
// (severidad real — es un desenlace negativo/definitivo, no una categoría
// más entre pares).
export const EVENT_TYPES = {
  VACATION: { label: 'Vacaciones', color: 'bg-chart-2/10 text-chart-2-text', icon: Calendar, requiresDuration: true, defaultDocType: 'MEMO' },
  DISABILITY: { label: 'Incapacidad Médica', color: 'bg-chart-6/10 text-chart-6-text', icon: HeartPulse, requiresDuration: true, defaultDocType: 'MEDICAL' },
  PERMIT: { label: 'Permiso / Licencia', color: 'bg-chart-7/10 text-chart-7-text', icon: ClipboardList, requiresDuration: true, defaultDocType: 'MEMO' },
  PROMOTION: { label: 'Cambio de Cargo', color: 'bg-chart-3/10 text-chart-3-text', icon: TrendingUp, requiresDuration: false, requiresNewRole: true, defaultDocType: 'CONTRACT' },
  SALARY: { label: 'Ajuste Salarial', color: 'bg-chart-2/10 text-chart-2-text', icon: DollarSign, requiresDuration: false, requiresNewCode: false, defaultDocType: 'OTHER' },
  TRANSFER: { label: 'Traslado de Sucursal', color: 'bg-chart-1/10 text-chart-1-text', icon: ArrowRightLeft, requiresDuration: false, requiresTargetBranch: true, defaultDocType: 'MEMO' },
  SUPPORT: { label: 'Apoyo Temporal', color: 'bg-chart-4/10 text-chart-4-text', icon: Building2, requiresDuration: true, requiresTargetBranch: true, defaultDocType: 'MEMO' },
  CODE_CHANGE: { label: 'Cambio de Código/ID', color: 'bg-chart-3/10 text-chart-3-text', icon: IdCard, requiresDuration: false, requiresNewCode: true, defaultDocType: 'OTHER' },
  INDUCTION: { label: 'Inducción', color: 'bg-chart-9/10 text-chart-9-text', icon: GraduationCap, requiresDuration: true, defaultDocType: 'OTHER' },
  SHIFT_CHANGE: { label: 'Cambio de Turno', color: 'bg-chart-5/10 text-chart-5-text', icon: Watch, requiresDuration: false, defaultDocType: 'MEMO' },
  TERMINATION: { label: 'Liquidación/Renuncia', color: 'bg-danger text-white', icon: LogOut, requiresDuration: false, defaultDocType: 'CONTRACT' },
  REHIRE: { label: 'Recontratación', color: 'bg-success/10 text-success-text', icon: RefreshCw, requiresDuration: false, defaultDocType: 'CONTRACT' },
};


export const WEEK_DAYS = [
  { id: 1, name: 'Lunes' }, { id: 2, name: 'Martes' }, { id: 3, name: 'Miércoles' }, { id: 4, name: 'Jueves' },
  { id: 5, name: 'Viernes' }, { id: 6, name: 'Sábado' }, { id: 0, name: 'Domingo' },
];




