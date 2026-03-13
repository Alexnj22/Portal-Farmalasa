import React, { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  Megaphone, Send, Trash2, Globe, Building2,
  Users, User, Target, X, Search, Plus, CheckCircle2,
  Archive, Eye, AlertCircle, PartyPopper, ChevronLeft, ChevronRight, Loader2, Clock, Flame, Edit3, Save, CalendarClock, Power, Timer
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import ConfirmModal from '../components/common/ConfirmModal';
import AlertModal from '../components/common/AlertModal';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import { useToastStore } from '../store/toastStore';

const makeId = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));

// ============================================================================
// 🚀 COMPONENTE DE TARJETA OPTIMIZADO (Liquidglass DNA)
// ============================================================================
const AnnouncementCard = memo(({ ann, onArchive, onDelete, onViewDetail, onEdit, isEditingThis }) => {
  const renderBadge = () => {
    switch (ann.badgeType) {
      case 'GLOBAL': return <span className="flex items-center gap-1.5 text-[#007AFF] bg-[#007AFF]/10 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-[#007AFF]/20"><Globe size={12} strokeWidth={2} /> {ann.badgeText}</span>;
      case 'BRANCH': return <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-emerald-200/50"><Building2 size={12} strokeWidth={2} /> {ann.badgeText}</span>;
      case 'ROLE': return <span className="flex items-center gap-1.5 text-purple-600 bg-purple-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-purple-200/50"><Users size={12} strokeWidth={2} /> {ann.badgeText}</span>;
      case 'EMPLOYEE': return <span className="flex items-center gap-1.5 text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-orange-200/50"><User size={12} strokeWidth={2} /> {ann.badgeText}</span>;
      default: return null;
    }
  };

  const isScheduled = ann.scheduledFor && new Date(ann.scheduledFor) > new Date();

  return (
    <div
      className={`p-6 rounded-[2.5rem] border flex flex-col gap-4 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group relative transform-gpu ${
        isEditingThis
          ? 'bg-white/95 backdrop-blur-xl border border-amber-300/60 shadow-[0_8px_30px_rgba(0,0,0,0.06)] animate-subtle-shake z-10'
          : ann.isCompleted
            ? 'border-white/40 opacity-80 hover:opacity-100 shadow-sm bg-white/40 backdrop-blur-md hover:-translate-y-1 hover:shadow-md'
            : isScheduled
              ? 'border-indigo-200/60 shadow-[0_4px_20px_rgba(99,102,241,0.05)] bg-indigo-50/40 backdrop-blur-2xl hover:-translate-y-1'
              : ann.priority === 'URGENT'
                ? 'border-red-300 shadow-[0_8px_30px_rgba(239,68,68,0.12)] hover:shadow-[0_12px_40px_rgba(239,68,68,0.2)] bg-white/90 backdrop-blur-xl hover:-translate-y-1'
                : 'border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 bg-white/60 backdrop-blur-2xl'
        }`}
    >
      <div className={`absolute top-5 right-5 flex items-center gap-2 transition-opacity duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isEditingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {!ann.isCompleted && (
          <>
            {ann.readIds.length === 0 && (
              <button
                onClick={() => onEdit(ann)}
                className={`p-2.5 rounded-full transition-all duration-300 active:scale-95 shadow-sm border ${isEditingThis ? 'bg-amber-100 text-amber-600 border-amber-300 hover:bg-amber-500 hover:text-white' : 'bg-white/80 text-amber-500 border-amber-100 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 hover:-translate-y-0.5 hover:shadow-md'}`}
                title="Editar aviso"
              >
                <Edit3 size={14} strokeWidth={2.5} />
              </button>
            )}
            <button
              onClick={() => onArchive(ann.id)}
              className="p-2.5 text-slate-400 bg-white/80 border border-white shadow-sm hover:text-slate-800 hover:bg-white hover:-translate-y-0.5 hover:shadow-md rounded-full transition-all duration-300 active:scale-95"
              title="Archivar aviso"
            >
              <Archive size={14} strokeWidth={2.5} />
            </button>
          </>
        )}
        {ann.readIds.length === 0 && (
          <button
            onClick={() => onDelete(ann)}
            className="p-2.5 text-red-400 bg-white/80 border border-red-50 shadow-sm hover:text-red-600 hover:bg-red-50 hover:border-red-200 hover:-translate-y-0.5 hover:shadow-md rounded-full transition-all duration-300 active:scale-95"
            title="Eliminar aviso"
          >
            <Trash2 size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {isScheduled && (
          <span className="flex items-center gap-1 text-indigo-600 bg-indigo-100 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest shadow-sm shadow-indigo-500/20 border border-indigo-200">
            <Timer size={12} strokeWidth={2.5} className="animate-pulse" /> Programado
          </span>
        )}
        {!isScheduled && ann.priority === 'URGENT' && (
          <span className="flex items-center gap-1 text-white bg-red-500 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest shadow-sm shadow-red-500/30 animate-pulse">
            <Flame size={12} strokeWidth={2.5} /> Urgente
          </span>
        )}

        {renderBadge()}

        <span className="text-[10px] font-bold text-slate-400 tracking-widest bg-white/50 border border-white/60 px-2 py-1 rounded-md">
          #{String(ann.id).slice(-5).toUpperCase()}
        </span>
        {ann.isCompleted && (
          <span className="text-[10px] font-bold text-slate-500 bg-white/50 border border-white/60 px-2 py-1 rounded-md flex items-center gap-1 uppercase tracking-widest">
            <Archive size={10} strokeWidth={2.5} /> Archivado
          </span>
        )}
      </div>

      <div className="pr-20">
        <h4 className="font-black text-slate-800 text-[18px] leading-tight mb-2 tracking-tight flex items-center gap-2">
          {ann.title}
          {ann.editedAt && <span className="text-[9px] text-amber-500 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md uppercase tracking-widest">Editado</span>}
        </h4>
        <p className="text-slate-600 text-[14px] leading-relaxed font-medium whitespace-pre-wrap">
          {ann.message}
        </p>
      </div>

      <div className="mt-2 space-y-2">
        <div className={`flex justify-between items-end text-[10px] font-bold uppercase tracking-widest ${ann.priority === 'URGENT' && !isScheduled ? 'text-red-400' : 'text-slate-500'}`}>
          <span>{isScheduled ? 'Progreso Bloqueado' : 'Progreso de Lectura'}</span>
          <span className={ann.priority === 'URGENT' && ann.readPercentage < 100 && !isScheduled ? 'text-red-500' : ann.readPercentage === 100 ? 'text-emerald-500' : isScheduled ? 'text-indigo-400' : 'text-[#007AFF]'}>
            {ann.readPercentage}%
          </span>
        </div>
        <div className={`w-full rounded-full h-2.5 overflow-hidden border ${ann.priority === 'URGENT' && !isScheduled ? 'bg-red-50/50 border-red-200/50' : 'bg-white/50 border-white/60'}`}>
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-sm ${ann.priority === 'URGENT' && ann.readPercentage < 100 && !isScheduled ? 'bg-red-500' : ann.readPercentage === 100 ? 'bg-emerald-500' : isScheduled ? 'bg-indigo-300' : 'bg-[#007AFF]'}`}
            style={{ width: `${ann.readPercentage}%` }}
          ></div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-4 border-t border-white/60 gap-4">
        <button
          onClick={() => onViewDetail(ann)}
          disabled={isScheduled}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md active:scale-95 w-full sm:w-auto bg-white/80 backdrop-blur-sm hover:bg-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:-translate-y-0 ${ann.priority === 'URGENT' && ann.readPercentage < 100 && !isScheduled
            ? 'text-red-600 border-red-200'
            : ann.readIds.length >= ann.totalExpected && ann.totalExpected > 0 && !isScheduled
              ? 'text-emerald-600 border-emerald-200'
              : isScheduled
                ? 'text-indigo-400 border-indigo-100'
                : 'text-[#007AFF] border-white'
            }`}
        >
          {isScheduled ? <CalendarClock size={16} strokeWidth={2.5} /> : ann.readIds.length >= ann.totalExpected && ann.totalExpected > 0 ? (
            <CheckCircle2 size={16} strokeWidth={2.5} />
          ) : (
            <Eye size={16} strokeWidth={2.5} />
          )}
          {isScheduled ? `0 / ${ann.totalExpected} (En espera)` : `Ver Detalle (${ann.readIds.length}/${ann.totalExpected})`}
        </button>

        <div className="flex flex-col items-end">
          {isScheduled ? (
            <p className="text-[11px] text-indigo-500 font-bold tracking-widest uppercase flex items-center gap-1.5">
              <CalendarClock size={12} /> Para: {new Date(ann.scheduledFor).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 font-bold tracking-widest uppercase flex items-center gap-1.5">
              <Clock size={12} /> {new Date(ann.date).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// VISTA PRINCIPAL
// ============================================================================
const AnnouncementsView = ({ openModal }) => {
  const storeAnnouncements = useStaff(state => state.announcements);
  const announcements = storeAnnouncements || [];
  const { branches, employees, roles, createAnnouncement, updateAnnouncement, deleteAnnouncement, archiveAnnouncement } = useStaff();

  const [editingAnnId, setEditingAnnId] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, annId: null });
  const [archiveDialog, setArchiveDialog] = useState({ isOpen: false, annId: null });
  const [alertDialog, setAlertDialog] = useState({ isOpen: false, title: '', message: '' });

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetType, setTargetType] = useState('GLOBAL');
  const [targetValue, setTargetValue] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [empSearch, setEmpSearch] = useState('');
  const [priority, setPriority] = useState('NORMAL');

  const [publishImmediately, setPublishImmediately] = useState(true);
  const [scheduledDate, setScheduledDate] = useState('');

  // 🚨 NUEVA PESTAÑA 'SCHEDULED'
  const [listTab, setListTab] = useState('ACTIVE'); // ACTIVE, SCHEDULED, ARCHIVED
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isSearchMode, setIsSearchMode] = useState(false);
  const [announcementSearch, setAnnouncementSearch] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  const searchInputRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    const timerId = setTimeout(() => { setDebouncedSearchTerm(announcementSearch); }, 300);
    return () => clearTimeout(timerId);
  }, [announcementSearch]);

  useEffect(() => {
    setCurrentPage(1);
  }, [listTab, debouncedSearchTerm]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (isSearchMode) { setIsSearchMode(false); setAnnouncementSearch(''); }
        if (editingAnnId) { handleCancelEdit(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchMode, editingAnnId]);

  const branchNameById = useMemo(() => {
    const m = new Map();
    (branches || []).forEach((b) => m.set(String(b.id), b.name));
    return m;
  }, [branches]);

  const employeesById = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => m.set(String(e.id), e));
    return m;
  }, [employees]);

  const uniqueRoles = useMemo(() => {
    return (roles || []).map(r => r.name).sort();
  }, [roles]);

  const targetTypes = useMemo(() => [
    { id: 'GLOBAL', label: 'Todos' },
    { id: 'BRANCH', label: 'Sucursal' },
    { id: 'ROLE', label: 'Cargo' },
    { id: 'EMPLOYEE', label: 'Personal' },
  ], []);

  const getTargetAudience = useCallback((type, value) => {
    const list = employees || [];
    if (type === 'GLOBAL') return list;
    if (type === 'BRANCH') return list.filter((e) => String(e.branchId) === String(value));
    if (type === 'ROLE') return list.filter((e) => e.role === value);
    if (type === 'EMPLOYEE') {
      const ids = (value || []).map(String);
      const set = new Set(ids);
      return list.filter((e) => set.has(String(e.id)));
    }
    return [];
  }, [employees]);

  const handleEditClick = useCallback((ann) => {
    setError('');
    if (ann.readIds?.length > 0) {
      setAlertDialog({
        isOpen: true,
        title: 'Operación Bloqueada',
        message: 'No puedes editar un aviso que ya fue leído. Por temas de auditoría, debes archivarlo y crear uno nuevo.'
      });
      return;
    }

    setEditingAnnId(ann.id);
    setTitle(ann.title);
    setMessage(ann.message);
    setTargetType(ann.targetType);
    setTargetValue(ann.targetType !== 'EMPLOYEE' ? ann.targetValue : '');
    setSelectedEmployees(ann.targetType === 'EMPLOYEE' ? ann.targetValue : []);
    setPriority(ann.priority);
    
    if (ann.scheduledFor && new Date(ann.scheduledFor) > new Date()) {
      setPublishImmediately(false);
      setScheduledDate(ann.scheduledFor.split('T')[0]); 
    } else {
      setPublishImmediately(true);
      setScheduledDate('');
    }

    setListTab(ann.scheduledFor && new Date(ann.scheduledFor) > new Date() ? 'SCHEDULED' : 'ACTIVE');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setError('');
    setEditingAnnId(null);
    setTitle('');
    setMessage('');
    setTargetType('GLOBAL');
    setTargetValue('');
    setSelectedEmployees([]);
    setPriority('NORMAL');
    setPublishImmediately(true);
    setScheduledDate('');
  }, []);

  const handlePublish = async (e) => {
    e.preventDefault();
    setError('');

    if (!title.trim() || !message.trim()) {
      setError('¡Ey! El aviso no tiene título o mensaje. Llena los campos.'); return;
    }
    if (targetType === 'BRANCH' && !targetValue) {
      setError('Por favor, selecciona a qué sucursal quieres enviarle el aviso.'); return;
    }
    if (targetType === 'ROLE' && !targetValue) {
      setError('Necesitas especificar a qué cargo va dirigido este mensaje.'); return;
    }
    if (targetType === 'EMPLOYEE' && selectedEmployees.length === 0) {
      setError('No has seleccionado a nadie. Elige al menos a una persona.'); return;
    }
// 🚨 Validación estricta de fecha futura
    if (!publishImmediately) {
      if (!scheduledDate) {
        setError('Si no publicas inmediatamente, debes elegir una fecha de programación.'); 
        return;
      }
      
      const [year, month, day] = scheduledDate.split('-');
      // Fecha elegida a las 00:00:00
      const selected = new Date(year, month - 1, day, 0, 0, 0, 0); 
      
      // Hoy a las 00:00:00
      const today = new Date();
      today.setHours(0, 0, 0, 0); 
      
      // 🚨 BLINDAJE: Si la fecha es Hoy o en el pasado, lo bloquea.
      if (selected <= today) {
        setError('La fecha programada debe ser a partir de mañana. Si lo necesitas para hoy, usa "Publicar Inmediatamente".'); 
        return;
      }
    }

    const finalTargetValue = targetType === 'EMPLOYEE' ? selectedEmployees.map(String) : String(targetValue);
    
// 🚨 Generar fecha programada a prueba de zonas horarias
    let finalScheduledFor = null;
    if (!publishImmediately && scheduledDate) {
      // Creamos la fecha usando la zona horaria local, fijándola a las 00:00:00 del día seleccionado
      const [year, month, day] = scheduledDate.split('-');
      const sDate = new Date(year, month - 1, day, 0, 0, 0, 0); 
      
      // Convertimos a ISO (que es lo que acepta Supabase)
      finalScheduledFor = sDate.toISOString();
    }
    setIsSubmitting(true);

    try {
      if (editingAnnId) {
        const originalAnn = announcements.find(a => a.id === editingAnnId);
        const updatePayload = {
          title: title.trim(),
          message: message.trim(),
          targetType,
          targetValue: finalTargetValue,
          priority,
          scheduledFor: finalScheduledFor,
          editedAt: new Date().toISOString()
        };
        await updateAnnouncement(editingAnnId, updatePayload, {});
        useToastStore.getState().showToast('Aviso Actualizado', 'Los cambios se han guardado con éxito.', 'success');
        if (finalScheduledFor && new Date(finalScheduledFor) > new Date()) {
          setListTab('SCHEDULED');
        }
      } else {
        await createAnnouncement({
          title: title.trim(),
          message: message.trim(),
          targetType,
          targetValue: finalTargetValue,
          priority,
          scheduledFor: finalScheduledFor 
        });
        useToastStore.getState().showToast(
          finalScheduledFor ? 'Aviso Programado' : '¡Boom! Enviado',
          finalScheduledFor ? `Se mostrará a partir del ${new Date(finalScheduledFor).toLocaleDateString()}.` : 'El aviso ya está en las pantallas de tu equipo. 🚀',
          'success'
        );
        if (finalScheduledFor && new Date(finalScheduledFor) > new Date()) {
          setListTab('SCHEDULED');
        } else {
          setListTab('ACTIVE');
        }
      }
      handleCancelEdit();
    } catch (err) {
      setError(`Hubo un error al ${editingAnnId ? 'actualizar' : 'publicar'} el aviso.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveCallback = useCallback((id) => {
    setError(''); setArchiveDialog({ isOpen: true, annId: id });
  }, []);

  const executeArchive = async () => {
    if (!archiveDialog.annId) return;
    setIsSubmitting(true);
    try {
      await archiveAnnouncement(archiveDialog.annId);
      setArchiveDialog({ isOpen: false, annId: null });
      useToastStore.getState().showToast('Aviso Archivado', 'El aviso ya no será visible.', 'success');
    } catch (err) {
      setError('No se pudo archivar el aviso.');
      setArchiveDialog({ isOpen: false, annId: null });
    } finally { setIsSubmitting(false); }
  };

  const handleDeleteCallback = useCallback((ann) => {
    setError('');
    if (ann.readIds?.length > 0) {
      setAlertDialog({ isOpen: true, title: 'Operación Bloqueada', message: 'Alguien ya leyó este aviso. Por seguridad no puedes eliminarlo, archívalo.' });
      return;
    }
    setConfirmDialog({ isOpen: true, annId: ann.id });
  }, []);

  const executeDelete = async () => {
    if (!confirmDialog.annId) return;
    setIsSubmitting(true);
    try {
      await deleteAnnouncement(confirmDialog.annId);
      if (editingAnnId === confirmDialog.annId) handleCancelEdit();
      setConfirmDialog({ isOpen: false, annId: null });
      useToastStore.getState().showToast('Aviso Eliminado', 'El aviso fue borrado permanentemente.', 'success');
    } catch (err) {
      setError('No se pudo eliminar el aviso. Intenta de nuevo.');
      setConfirmDialog({ isOpen: false, annId: null });
    } finally { setIsSubmitting(false); }
  };

  const handleViewDetailCallback = useCallback((ann) => {
    if (openModal) openModal('viewAnnouncementReaders', { announcement: ann });
  }, [openModal]);

  const addEmployee = (id) => {
    const sid = String(id);
    setSelectedEmployees((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
    setEmpSearch('');
  };

  const removeEmployee = (id) => {
    const sid = String(id);
    setSelectedEmployees((prev) => prev.filter((empId) => empId !== sid));
  };

  const processedAnnouncements = useMemo(() => {
    return (announcements || []).map((ann) => {
      const audience = getTargetAudience(ann.targetType, ann.targetValue);
      const totalExpected = audience.length;
      const readIds = (ann.readBy || []).map((r) => String(typeof r === 'object' ? r.employeeId : r));
      const readSet = new Set(readIds);
      const isFullyRead = totalExpected > 0 && readSet.size >= totalExpected;
      const readPercentage = totalExpected > 0 ? Math.round((readIds.length / totalExpected) * 100) : 0;

      let badgeText = '';
      if (ann.targetType === 'GLOBAL') badgeText = 'Global';
      else if (ann.targetType === 'BRANCH') badgeText = branchNameById.get(String(ann.targetValue)) || 'Sucursal';
      else if (ann.targetType === 'ROLE') badgeText = ann.targetValue;
      else if (ann.targetType === 'EMPLOYEE') badgeText = `${Array.isArray(ann.targetValue) ? ann.targetValue.length : 0} Personal`;

      return {
        ...ann,
        audience, readIds, readSet, totalExpected, readPercentage,
        isCompleted: ann.isArchived || isFullyRead,
        badgeText, badgeType: ann.targetType
      };
    });
  }, [announcements, employees, getTargetAudience, branchNameById]);

  // 🚨 LÓGICA DE SEPARACIÓN EN PESTAÑAS MEJORADA
  const currentList = useMemo(() => {
    const now = new Date();
    
    // Filtramos según la pestaña seleccionada
    const baseList = processedAnnouncements.filter((a) => {
        const isScheduled = a.scheduledFor && new Date(a.scheduledFor) > now;
        
        if (listTab === 'ARCHIVED') return a.isCompleted;
        if (listTab === 'SCHEDULED') return isScheduled && !a.isCompleted;
        
        // ACTIVE: Solo los que NO están archivados/leídos y NO están en el futuro
        return !a.isCompleted && !isScheduled; 
    });

    if (!debouncedSearchTerm.trim()) return baseList;
    const query = debouncedSearchTerm.toLowerCase();

    return baseList.filter(a => {
      const matchesBasic = a.title.toLowerCase().includes(query) || a.message.toLowerCase().includes(query) || (a.badgeText && a.badgeText.toLowerCase().includes(query));
      if (matchesBasic) return true;
      if (Array.isArray(a.audience)) return a.audience.some(emp => emp.name && emp.name.toLowerCase().includes(query));
      return false;
    });
  }, [processedAnnouncements, listTab, debouncedSearchTerm]);

  const totalItems = currentList.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  const paginatedList = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return currentList.slice(startIndex, startIndex + itemsPerPage);
  }, [currentList, currentPage]);

  const filteredEmployeeSearch = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return [];
    return (employees || [])
      .filter((e) => e?.name?.toLowerCase().includes(q))
      .filter((e) => !selectedEmployees.includes(String(e.id)))
      .slice(0, 30);
  }, [empSearch, employees, selectedEmployees]);

  // CONTADOR DE PROGRAMADOS PARA EL BADGE
  const scheduledCount = useMemo(() => {
      const now = new Date();
      return processedAnnouncements.filter(a => !a.isCompleted && a.scheduledFor && new Date(a.scheduledFor) > now).length;
  }, [processedAnnouncements]);

  const renderFiltersContent = () => (
    <div className={`flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu overflow-hidden animate-in fade-in slide-in-from-right-8 w-max max-w-full`}>
      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchMode ? "max-w-[800px] opacity-100 px-4 md:px-5 gap-3" : "max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0 border-transparent"}`}>
        <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
        <input ref={searchInputRef} type="text" placeholder="Buscar en avisos, sucursales o roles..." className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0" value={announcementSearch} onChange={(e) => setAnnouncementSearch(e.target.value)} />
        {announcementSearch && <button onClick={() => setAnnouncementSearch('')} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:scale-110 hover:-translate-y-0.5 active:scale-95 transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>}
        <button onClick={() => setIsSearchMode(false)} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2"><ChevronRight size={18} strokeWidth={2.5} /></button>
      </div>

      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchMode ? "max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0" : "max-w-[800px] opacity-100 pl-2 pr-2 md:pr-3 gap-2 md:gap-3"}`}>
        <div className="flex items-center min-w-0 gap-1 md:gap-2">
          
          <button onClick={() => setListTab('ACTIVE')} className={`px-4 md:px-6 h-9 md:h-10 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${listTab === 'ACTIVE' ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]' : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'}`}>
            Activos
          </button>
          
          {/* 🚨 NUEVA PESTAÑA CON BADGE */}
          <button onClick={() => setListTab('SCHEDULED')} className={`relative px-4 md:px-5 h-9 md:h-10 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${listTab === 'SCHEDULED' ? 'bg-indigo-50 text-indigo-600 border-indigo-200 shadow-md scale-[1.02]' : 'bg-transparent text-slate-500 border-transparent hover:bg-indigo-50 hover:text-indigo-600 hover:-translate-y-0.5 hover:shadow-md hover:border-indigo-100'}`}>
            <span className="flex items-center gap-1.5"><CalendarClock size={14} /> Programados</span>
            {scheduledCount > 0 && (
                <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center text-[9px] font-black text-white rounded-full shadow-sm border-2 border-white transition-all ${listTab === 'SCHEDULED' ? 'bg-indigo-500' : 'bg-slate-400'}`}>
                    {scheduledCount}
                </span>
            )}
          </button>
          
          <button onClick={() => setListTab('ARCHIVED')} className={`px-4 md:px-6 h-9 md:h-10 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${listTab === 'ARCHIVED' ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]' : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'}`}>
            Archivo
          </button>

        </div>
        <div className="w-px h-6 md:h-8 bg-slate-200/60 mx-1 md:mx-2 shrink-0"></div>
        <button onClick={() => { setIsSearchMode(true); setTimeout(() => searchInputRef.current?.focus(), 100); }} className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu" title="Buscar avisos">
          <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
          {announcementSearch && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <style>{`@keyframes subtle-shake { 0%, 100% { transform: rotate(0deg) scale(1.01); } 25% { transform: rotate(-0.5deg) scale(1.01); } 75% { transform: rotate(0.5deg) scale(1.01); } } .animate-subtle-shake { animation: subtle-shake 0.4s ease-in-out infinite; }`}</style>
      <ConfirmModal isOpen={confirmDialog.isOpen} onClose={() => setConfirmDialog({ isOpen: false, annId: null })} onConfirm={executeDelete} title="¿Eliminar este aviso?" message="Esta acción borrará el aviso para siempre. No podrás recuperarlo ni ver las estadísticas." confirmText="Sí, Eliminar" isProcessing={isSubmitting} isDestructive={true} />
      <ConfirmModal isOpen={archiveDialog.isOpen} onClose={() => setArchiveDialog({ isOpen: false, annId: null })} onConfirm={executeArchive} title="¿Archivar Aviso?" message="El aviso se moverá a la pestaña de Archivo y dejará de mostrarse en los Kioscos. ¿Continuar?" confirmText="Sí, Archivar" isProcessing={isSubmitting} isDestructive={false} />
      <AlertModal isOpen={alertDialog.isOpen} onClose={() => setAlertDialog({ isOpen: false, title: '', message: '' })} title={alertDialog.title} message={alertDialog.message} type="error" />

      <GlassViewLayout icon={Megaphone} title="Centro de Comunicaciones" filtersContent={renderFiltersContent()} transparentBody={true} fixedScrollMode={true}>
        <div className="flex flex-col lg:flex-row items-start gap-6 md:gap-8 px-2 md:px-0 w-full h-full lg:h-[calc(100vh-230px)]">

{/* COLUMNA IZQUIERDA: Formulario */}
          <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 group/panel transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] z-[50] transform-gpu">
            <div className={`bg-white/40 backdrop-blur-[30px] backdrop-saturate-[180%] border p-6 md:p-8 rounded-[2.5rem] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] relative overflow-visible ${editingAnnId ? 'bg-white/60 border border-amber-300/80 shadow-[0_12px_40px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,0.7)]' : 'border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.12),inset_0_2px_15px_rgba(255,255,255,0.7)]'}`}>              
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-slate-800 flex items-center gap-2 text-[15px]">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${editingAnnId ? 'bg-amber-500' : 'bg-[#007AFF]'}`}>
                    {editingAnnId ? <Edit3 size={16} strokeWidth={2.5} /> : <Target size={16} strokeWidth={2.5} />}
                  </div>
                  <span className="font-black uppercase tracking-tight ml-1">{editingAnnId ? 'Editar Aviso' : 'Nuevo Aviso'}</span>
                </h3>
                {editingAnnId && (
                  <button onClick={handleCancelEdit} className="flex items-center gap-1.5 text-[10px] md:text-[11px] font-black uppercase tracking-widest text-red-500 bg-red-50 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl transition-all duration-300 border border-red-200 shadow-sm active:scale-95 group"><X size={14} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-300" /> Cancelar</button>
                )}
              </div>

              {error && <div className="mb-5 bg-amber-50/80 backdrop-blur-sm border border-amber-200/60 text-amber-700 px-4 py-3 rounded-2xl text-[11px] font-bold shadow-[inset_0_1px_4px_rgba(255,255,255,0.5)] flex items-start gap-2 animate-in fade-in slide-in-from-top-2"><AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} /><span className="leading-tight">{error}</span></div>}

              <form onSubmit={handlePublish} className="space-y-5 relative z-10">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">Nivel de Prioridad</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setPriority('NORMAL')} className={`flex items-center justify-center gap-2 py-3 rounded-xl border font-bold text-xs transition-all duration-300 ${priority === 'NORMAL' ? 'bg-white/80 border-[#007AFF]/30 text-[#007AFF] shadow-[0_2px_10px_rgba(0,122,255,0.2)]' : 'bg-white/40 border-white/60 text-slate-500 hover:bg-white/80 hover:shadow-sm hover:-translate-y-0.5'}`}><Megaphone size={14} /> Normal</button>
                    <button type="button" onClick={() => setPriority('URGENT')} className={`flex items-center justify-center gap-2 py-3 rounded-xl border font-bold text-xs transition-all duration-300 ${priority === 'URGENT' ? 'bg-red-50 border-red-300 text-red-600 shadow-[0_2px_10px_rgba(239,68,68,0.2)]' : 'bg-white/40 border-white/60 text-slate-500 hover:bg-white/80 hover:shadow-sm hover:-translate-y-0.5'}`}><Flame size={14} className={priority === 'URGENT' ? 'animate-pulse' : ''} /> Urgente</button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">Título del Mensaje</label>
                  <input type="text" placeholder="Ej: Mantenimiento de servidores..." className={`w-full py-3.5 px-4 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] rounded-2xl text-[13px] outline-none font-bold text-slate-700 transition-all duration-300 placeholder-slate-400 placeholder:font-normal placeholder:tracking-normal ${error && !title.trim() ? 'border-amber-300 focus:ring-amber-500/20' : ''}`} value={title} onChange={(e) => setTitle(e.target.value)} disabled={isSubmitting} />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">Contenido</label>
                  <textarea placeholder="Escribe los detalles de tu anuncio aquí..." className={`w-full py-3.5 px-4 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] rounded-2xl text-[13px] outline-none font-medium text-slate-700 resize-none h-24 transition-all duration-300 placeholder-slate-400 placeholder:font-normal placeholder:tracking-normal leading-relaxed custom-scrollbar ${error && !message.trim() ? 'border-amber-300 focus:ring-amber-500/20' : ''}`} value={message} onChange={(e) => setMessage(e.target.value)} disabled={isSubmitting} />
                </div>

                <div className="pt-3 border-t border-white/50">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">¿A quién va dirigido?</label>
                  <div className="flex items-center gap-1 bg-black/[0.03] p-1.5 rounded-full border border-black/[0.05] shadow-[inset_0_2px_8px_rgba(0,0,0,0.04)] mb-4">
                    {targetTypes.map((type) => {
                      const isActive = targetType === type.id;
                      return (
                        <button key={type.id} type="button" disabled={isSubmitting} onClick={() => { setTargetType(type.id); setTargetValue(''); setSelectedEmployees([]); setEmpSearch(''); }} className={`flex-1 h-9 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border ${isActive ? 'bg-white text-[#007AFF] border-white shadow-sm scale-[1.02]' : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-sm hover:border-white/90'}`}>{type.label}</button>
                      );
                    })}
                  </div>
                  {targetType === 'BRANCH' && ( <select className="w-full py-3.5 px-4 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 rounded-2xl text-[13px] outline-none font-bold text-slate-700 appearance-none cursor-pointer" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} disabled={isSubmitting}><option value="" disabled>-- Seleccionar Sucursal --</option>{(branches || []).map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}</select>)}
                  {targetType === 'ROLE' && ( <select className="w-full py-3.5 px-4 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 rounded-2xl text-[13px] outline-none font-bold text-slate-700 appearance-none cursor-pointer" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} disabled={isSubmitting}><option value="" disabled>-- Seleccionar Cargo --</option>{uniqueRoles.map((r) => (<option key={r} value={r}>{r}</option>))}</select>)}
                  {targetType === 'EMPLOYEE' && (
                    <div className="space-y-3">
                      {selectedEmployees.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 p-3 bg-white/60 rounded-[1rem] border border-white/80 shadow-sm">
                          {selectedEmployees.map((id) => (
                            <div key={id} className="flex items-center gap-1.5 bg-[#007AFF]/10 text-[#007AFF] px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-[#007AFF]/20 hover:scale-105">
                              <span>{employeesById.get(String(id))?.name || 'Empleado'}</span>
                              <button type="button" onClick={() => removeEmployee(id)} disabled={isSubmitting} className="hover:text-red-500"><X size={12} strokeWidth={2.5} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input type="text" placeholder="Buscar persona por nombre..." className="w-full pl-11 pr-4 py-3.5 bg-white/50 border border-white/60 focus:bg-white rounded-2xl text-[13px] outline-none font-bold text-slate-700" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} disabled={isSubmitting} />
                        {empSearch.trim() && (
                          <div className="absolute z-20 w-full mt-2 bg-white/90 backdrop-blur-xl border border-white/90 rounded-[1.25rem] shadow-[0_12px_40px_rgba(0,0,0,0.12)] max-h-60 overflow-y-auto p-1">
                            {filteredEmployeeSearch.length ? filteredEmployeeSearch.map((emp) => (<button type="button" key={emp.id} onClick={() => addEmployee(emp.id)} className="w-full p-3 hover:bg-[#007AFF]/10 text-left flex items-center justify-between rounded-xl mx-0.5"><p className="text-[13px] font-bold text-slate-700">{emp.name}</p><Plus size={14} className="text-[#007AFF]" /></button>)) : <div className="p-3 text-[12px] text-slate-400 font-bold text-center">Sin resultados.</div>}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-white/50">
                   <div className="flex items-center justify-between mb-3 pl-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] flex items-center gap-1.5">
                        <CalendarClock size={14} /> ¿Cuándo se publica?
                      </label>
                      <button
                        type="button"
                        onClick={() => setPublishImmediately(!publishImmediately)}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-300 ease-in-out ${publishImmediately ? 'bg-emerald-400' : 'bg-slate-300'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-300 ease-in-out shadow-sm ${publishImmediately ? 'translate-x-5' : 'translate-x-0'}`}></span>
                      </button>
                   </div>
                   
                   <div className={`transition-all duration-300 overflow-hidden ${publishImmediately ? 'h-0 opacity-0' : 'h-[60px] opacity-100 mt-2'}`}>
                       <div className="bg-white/50 rounded-xl px-3 py-2 border border-white/80 shadow-sm flex items-center">
                          <LiquidDatePicker 
                            value={scheduledDate} 
                            onChange={setScheduledDate} 
                            placeholder="Selecciona la fecha..." 
                          />
                       </div>
                   </div>
                   {publishImmediately && (
                      <p className="text-[10px] text-emerald-600 font-bold mt-1 ml-1 flex items-center gap-1">
                        <Power size={10} /> Se mostrará en los kioscos inmediatamente
                      </p>
                   )}
                </div>

                <button type="submit" disabled={isSubmitting} className={`w-full py-4 mt-2 active:scale-[0.98] text-white rounded-[1.25rem] font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 border-none shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] ${editingAnnId ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30' : 'bg-[#007AFF] hover:bg-[#0066CC]'}`}>
                  {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Procesando...</> : editingAnnId ? <><Save size={16} strokeWidth={2.5} /> Guardar Cambios</> : publishImmediately ? <><Send size={16} strokeWidth={2.5} /> Publicar Aviso</> : <><CalendarClock size={16} strokeWidth={2.5} /> Programar Aviso</>}
                </button>
              </form>
            </div>
          </div>

          {/* COLUMNA DERECHA: Lista y Empty States dinámicos */}
          <div className="flex-1 flex flex-col min-w-0 w-full h-[100dvh] overflow-y-auto overscroll-contain pb-32 scrollbar-hide -mt-[140px] md:-mt-[190px] pt-[140px] md:pt-[190px] pointer-events-auto">
            <div className="space-y-5 flex-1 pt-4 px-3 md:px-4">
              {paginatedList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                  <div className="relative group flex flex-col items-center text-center">
                    <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 transition-colors duration-700 ${announcementSearch ? 'bg-[#007AFF]' : listTab === 'ACTIVE' ? 'bg-emerald-500' : listTab === 'SCHEDULED' ? 'bg-indigo-500' : 'bg-slate-400'}`}></div>
                    
                    <div className={`relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-2 group-hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] ${announcementSearch ? 'text-[#007AFF]' : listTab === 'ACTIVE' ? 'text-emerald-500' : listTab === 'SCHEDULED' ? 'text-indigo-500' : 'text-slate-400'}`}>
                      {announcementSearch ? <Search size={40} strokeWidth={2} /> : listTab === 'ACTIVE' ? <CheckCircle2 size={40} strokeWidth={2} /> : listTab === 'SCHEDULED' ? <CalendarClock size={40} strokeWidth={2} /> : <Archive size={40} strokeWidth={2} />}
                    </div>
                    
                    <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">
                        {announcementSearch ? 'Sin resultados' : listTab === 'ACTIVE' ? 'Todo está al día' : listTab === 'SCHEDULED' ? 'Sin programaciones' : 'Archivo vacío'}
                    </h3>
                    <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">
                        {announcementSearch ? 'No encontramos avisos con esa búsqueda.' : listTab === 'ACTIVE' ? 'Bandeja limpia. No hay avisos activos pendientes por el momento.' : listTab === 'SCHEDULED' ? 'No tienes avisos esperando para publicarse en el futuro.' : 'Aquí aparecerán los avisos que ya cumplieron su ciclo.'}
                    </p>
                  </div>
                </div>
              ) : (
                paginatedList.map((ann) => (
                  <AnnouncementCard key={ann.id} ann={ann} onArchive={handleArchiveCallback} onDelete={handleDeleteCallback} onViewDetail={handleViewDetailCallback} onEdit={() => editingAnnId === ann.id ? handleCancelEdit() : handleEditClick(ann)} isEditingThis={editingAnnId === ann.id} />
                ))
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-6 mt-2 border-t border-slate-200/50 shrink-0 px-3 md:px-4">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest bg-white/60 backdrop-blur-sm shadow-sm px-3 py-1.5 rounded-lg border border-white/80">Pág {currentPage} de {totalPages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="w-10 h-10 flex items-center justify-center bg-white/70 border border-white/90 rounded-xl shadow-sm text-[#007AFF] disabled:opacity-30 transition-all active:scale-95"><ChevronLeft size={18} strokeWidth={2.5} /></button>
                  <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className="w-10 h-10 flex items-center justify-center bg-white/70 border border-white/90 rounded-xl shadow-sm text-[#007AFF] disabled:opacity-30 transition-all active:scale-95"><ChevronRight size={18} strokeWidth={2.5} /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      </GlassViewLayout>
    </>
  );
};

export default AnnouncementsView;