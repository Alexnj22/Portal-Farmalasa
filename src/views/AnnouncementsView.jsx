import React, { useMemo, useState, useEffect, useCallback, memo } from 'react';
import SegmentedControl from '../components/common/SegmentedControl';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import ViewTabBar from '../components/common/ViewTabBar';
import Switch from '../components/common/Switch';
import Badge from '../components/common/Badge';
import {
  Megaphone, Send, Trash2, Globe, Building2,
  Users, User, Target, X, Search, Plus, CheckCircle2,
  Archive, Eye, AlertCircle, PartyPopper, ChevronLeft, ChevronRight, Loader2, Clock, Flame, Edit3, Save, CalendarClock, Power, Timer
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import ConfirmModal from '../components/common/ConfirmModal';
import { tokenMatch, smartFilter } from '../utils/searchUtils';
import AlertModal from '../components/common/AlertModal';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import LiquidSelect from '../components/common/LiquidSelect';
import SearchInput from '../components/common/SearchInput';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import PortalTextarea from '../components/common/PortalTextarea';


// ============================================================================
// 🚀 COMPONENTE DE TARJETA OPTIMIZADO (Liquidglass DNA)
// ============================================================================
const AnnouncementCard = memo(({ ann, onArchive, onDelete, onViewDetail, onEdit, isEditingThis, canEdit = false }) => {
  const renderBadge = () => {
    switch (ann.badgeType) {
      case 'GLOBAL': return <Badge variant="info" icon={Globe}>{ann.badgeText}</Badge>;
      case 'BRANCH': return <Badge variant="success" icon={Building2}>{ann.badgeText}</Badge>;
      case 'ROLE': return <Badge variant="chart-3" icon={Users}>{ann.badgeText}</Badge>;
      case 'EMPLOYEE': return <Badge variant="chart-4" icon={User}>{ann.badgeText}</Badge>;
      default: return null;
    }
  };

  const isScheduled = ann.scheduledFor && new Date(ann.scheduledFor) > new Date();

  return (
    <div
      className={`p-6 rounded-header border flex flex-col gap-4 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group relative transform-gpu ${
        isEditingThis
          ? 'bg-surface-card backdrop-blur-xl border border-warning/40 shadow-[var(--shadow-elevation-sm)] animate-subtle-shake z-base'
          : ann.isCompleted
            ? 'border-border-card opacity-80 hover:opacity-100 shadow-sm bg-surface-card backdrop-blur-md hover:-translate-y-1 hover:shadow-md'
            : isScheduled
              ? 'border-chart-3/30 shadow-[var(--shadow-glow-chart-3-lg)] bg-chart-3/10 backdrop-blur-2xl hover:-translate-y-1'
              : ann.priority === 'URGENT'
                ? 'border-danger/40 shadow-[var(--shadow-glow-danger)] hover:shadow-[var(--shadow-glow-danger)] bg-surface-card backdrop-blur-xl hover:-translate-y-1'
                : 'border-border-card shadow-[var(--shadow-elevation-xs)] hover:shadow-[var(--shadow-elevation-md)] hover:-translate-y-1 bg-surface-card backdrop-blur-2xl'
        }`}
    >
      <div className={`absolute top-5 right-5 flex items-center gap-2 transition-opacity duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isEditingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
        {canEdit && !ann.isCompleted && (
          <>
            {ann.readIds.length === 0 && (
              <Button
                  icon={Edit3}
                  iconOnly
                  size="sm"
                  tone="warning"
                  soft
                  onClick={() => onEdit(ann)}
                  title="Editar aviso"
              />
            )}
            <Button variant="secondary" icon={Archive} title="Archivar aviso" iconOnly onClick={() => onArchive(ann.id)} />
          </>
        )}
        {canEdit && ann.readIds.length === 0 && (
          <Button variant="destructive" icon={Trash2} title="Eliminar aviso" iconOnly onClick={() => onDelete(ann)} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {isScheduled && (
          <Badge variant="chart-3" icon={Timer}>Programado</Badge>
        )}
        {!isScheduled && ann.priority === 'URGENT' && (
          <Badge variant="danger" tone="solid" icon={Flame}>Urgente</Badge>
        )}

        {renderBadge()}

        <Badge uppercase={false}>#{String(ann.id).slice(-5).toUpperCase()}</Badge>
        {ann.isCompleted && (
          <Badge icon={Archive}>Archivado</Badge>
        )}
      </div>

      <div className="pr-20">
        <h4 className="font-black text-content text-title-sm leading-tight mb-2 tracking-tight flex items-center gap-2">
          {ann.title}
          {ann.editedAt && <Badge variant="warning" size="sm">Editado</Badge>}
        </h4>
        <p className="text-content-2 text-body-lg leading-relaxed font-medium whitespace-pre-wrap">
          {ann.message}
        </p>
      </div>

      <div className="mt-2 space-y-2">
        <div className={`flex justify-between items-end text-caption font-bold uppercase tracking-widest ${ann.priority === 'URGENT' && !isScheduled ? 'text-danger' : 'text-content-3'}`}>
          <span>{isScheduled ? 'Progreso Bloqueado' : 'Progreso de Lectura'}</span>
          <span className={ann.priority === 'URGENT' && ann.readPercentage < 100 && !isScheduled ? 'text-danger' : ann.readPercentage === 100 ? 'text-success' : isScheduled ? 'text-chart-3-text' : 'text-brand-text'}>
            {ann.readPercentage}%
          </span>
        </div>
        <div className={`w-full rounded-full h-2.5 overflow-hidden border ${ann.priority === 'URGENT' && !isScheduled ? 'bg-danger/10 border-danger/30' : 'bg-surface-card border-border-card'}`}>
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-sm ${ann.priority === 'URGENT' && ann.readPercentage < 100 && !isScheduled ? 'bg-danger' : ann.readPercentage === 100 ? 'bg-success' : isScheduled ? 'bg-chart-3' : 'bg-brand'}`}
            style={{ width: `${ann.readPercentage}%` }}
          ></div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-4 border-t border-border-card gap-4">
        <button
          onClick={() => onViewDetail(ann)}
          disabled={isScheduled}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-label font-bold uppercase tracking-widest border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] w-full sm:w-auto bg-surface-card backdrop-blur-sm hover:bg-surface-card-hover shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:-translate-y-0 ${ann.priority === 'URGENT' && ann.readPercentage < 100 && !isScheduled
            ? 'text-danger border-danger/30'
            : ann.readIds.length >= ann.totalExpected && ann.totalExpected > 0 && !isScheduled
              ? 'text-success border-success/30'
              : isScheduled
                ? 'text-chart-3-text border-chart-3/30'
                : 'text-brand-text border-border-card'
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
            <p className="text-label text-chart-3-text font-bold tracking-widest uppercase flex items-center gap-1.5">
              <CalendarClock size={12} /> Para: {new Date(ann.scheduledFor).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-label text-content-3 font-bold tracking-widest uppercase flex items-center gap-1.5">
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
const EMPTY_ANNOUNCEMENTS = [];

const AnnouncementsView = ({ openModal }) => {
  const storeAnnouncements = useStaff(state => state.announcements);
  const announcements = storeAnnouncements || EMPTY_ANNOUNCEMENTS;
  
  // 🚨 NUEVO: Extraemos fetchInitialData para poder recargar desde la DB
  const branches = useStaff(state => state.branches);
  const employees = useStaff(state => state.employees);
  const roles = useStaff(state => state.roles);
  const createAnnouncement = useStaff(state => state.createAnnouncement);
  const updateAnnouncement = useStaff(state => state.updateAnnouncement);
  const deleteAnnouncement = useStaff(state => state.deleteAnnouncement);
  const archiveAnnouncement = useStaff(state => state.archiveAnnouncement);
  const fetchInitialData = useStaff(state => state.fetchInitialData);
  const { user, hasPermission, getScope } = useAuth();
  const canEdit = hasPermission('announcements', 'can_edit');
  // BRANCH scope: el usuario solo puede dirigir avisos a su propia sucursal
  const annScope = getScope('announcements');
  const isBranchScoped = annScope === 'BRANCH';

  const [editingAnnId, setEditingAnnId] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, annId: null });
  const [archiveDialog, setArchiveDialog] = useState({ isOpen: false, annId: null });
  const [alertDialog, setAlertDialog] = useState({ isOpen: false, title: '', message: '' });

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetType, setTargetType] = useState(() => isBranchScoped ? 'BRANCH' : 'GLOBAL');
  const [targetValue, setTargetValue] = useState(() => isBranchScoped ? String(user?.branchId || '') : '');
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [empSearch, setEmpSearch] = useState('');
  const [priority, setPriority] = useState('NORMAL');

  const [publishImmediately, setPublishImmediately] = useState(true);
  const [scheduledDate, setScheduledDate] = useState('');

  const [listTab, setListTab] = useState('ACTIVE'); 
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [announcementSearch, setAnnouncementSearch] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // 🚨 NUEVO: Escuchador global de "force-history-refresh" (Llamado por SalyChat)
  useEffect(() => {
    const handleSalyRefresh = async () => {
      // Forzamos al store a ir a Supabase y traer la info fresca
      if (fetchInitialData) {
         await fetchInitialData();
         setListTab('ACTIVE'); // Volvemos a Activos por si Saly publicó algo nuevo
         setCurrentPage(1);
      }
    };
    window.addEventListener('force-history-refresh', handleSalyRefresh);
    return () => window.removeEventListener('force-history-refresh', handleSalyRefresh);
  }, [fetchInitialData]);

  useEffect(() => {
    const timerId = setTimeout(() => { setDebouncedSearchTerm(announcementSearch); }, 300);
    return () => clearTimeout(timerId);
  }, [announcementSearch]);

  useEffect(() => {
    setCurrentPage(1);
  }, [listTab, debouncedSearchTerm]);

  const handleCancelEdit = useCallback(() => {
    setError('');
    setEditingAnnId(null);
    setTitle('');
    setMessage('');
    setTargetType(isBranchScoped ? 'BRANCH' : 'GLOBAL');
    setTargetValue(isBranchScoped ? String(user?.branchId || '') : '');
    setSelectedEmployees([]);
    setPriority('NORMAL');
    setPublishImmediately(true);
    setScheduledDate('');
  }, [isBranchScoped, user?.branchId]);

  // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
  // cierra Y limpia; click afuera cierra SOLO si está vacío.

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && editingAnnId) handleCancelEdit();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingAnnId, handleCancelEdit]);

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

    if (!publishImmediately) {
      if (!scheduledDate) {
        setError('Si no publicas inmediatamente, debes elegir una fecha de programación.'); 
        return;
      }
      
      const [year, month, day] = scheduledDate.split('-');
      const selected = new Date(year, month - 1, day, 0, 0, 0, 0); 
      
      const today = new Date();
      today.setHours(0, 0, 0, 0); 
      
      if (selected <= today) {
        setError('La fecha programada debe ser a partir de mañana. Si lo necesitas para hoy, usa "Publicar Inmediatamente".'); 
        return;
      }
    }

    const effectiveTargetType  = isBranchScoped ? 'BRANCH' : targetType;
    const effectiveTargetValue = isBranchScoped ? String(user?.branchId) : (targetType === 'EMPLOYEE' ? selectedEmployees.map(String) : String(targetValue));
    
    let finalScheduledFor = null;
    if (!publishImmediately && scheduledDate) {
      const [year, month, day] = scheduledDate.split('-');
      const sDate = new Date(year, month - 1, day, 0, 0, 0, 0); 
      finalScheduledFor = sDate.toISOString();
    }
    setIsSubmitting(true);

    try {
      if (editingAnnId) {
        const updatePayload = {
          title: title.trim(),
          message: message.trim(),
          targetType: effectiveTargetType,
          targetValue: effectiveTargetValue,
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
          targetType: effectiveTargetType,
          targetValue: effectiveTargetValue,
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
    } catch {
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
    } catch {
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
    } catch {
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
  }, [announcements, getTargetAudience, branchNameById]);

  // 🚨 LÓGICA DE SEPARACIÓN EN PESTAÑAS MEJORADA
  const currentListRaw = useMemo(() => {
    const now = new Date();

    const baseList = processedAnnouncements.filter((a) => {
        const isScheduled = a.scheduledFor && new Date(a.scheduledFor) > now;

        if (listTab === 'ARCHIVED') return a.isCompleted;
        if (listTab === 'SCHEDULED') return isScheduled && !a.isCompleted;

        return !a.isCompleted && !isScheduled;
    });

    const branchFiltered = isBranchScoped && user?.branchId
        ? baseList.filter(a =>
              a.targetType === 'GLOBAL' ||
              (a.targetType === 'BRANCH' && String(a.targetValue) === String(user.branchId))
          )
        : baseList;

    if (!debouncedSearchTerm.trim()) return { list: branchFiltered, isAnnFuzzy: false };

    const { results, isFuzzy } = smartFilter(debouncedSearchTerm, branchFiltered, a => [
        a.title, a.message, a.badgeText,
        ...(Array.isArray(a.audience) ? a.audience.map(e => e.name) : []),
    ]);
    return { list: results, isAnnFuzzy: isFuzzy };
  }, [processedAnnouncements, listTab, debouncedSearchTerm, isBranchScoped, user?.branchId]);
  const { list: currentList, isAnnFuzzy } = currentListRaw;

  const totalItems = currentList.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  const paginatedList = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return currentList.slice(startIndex, startIndex + itemsPerPage);
  }, [currentList, currentPage]);

  const filteredEmployeeSearch = useMemo(() => {
    if (!empSearch.trim()) return [];
    return (employees || [])
      .filter((e) => e?.name && tokenMatch(empSearch, e.name))
      .filter((e) => !selectedEmployees.includes(String(e.id)))
      .slice(0, 30);
  }, [empSearch, employees, selectedEmployees]);

  const scheduledCount = useMemo(() => {
      const now = new Date();
      return processedAnnouncements.filter(a => !a.isCompleted && a.scheduledFor && new Date(a.scheduledFor) > now).length;
  }, [processedAnnouncements]);

  // D3.9 (2026-07-27): barra reescrita a mano → canónico. El contador de
  // programados viaja en el label del tab, que es donde el canónico lo espera.
  const renderFiltersContent = () => (
    <ViewTabBar
      tabs={[
        { key: 'ACTIVE',    label: 'Activos' },
        { key: 'SCHEDULED', label: scheduledCount > 0 ? `Programados · ${scheduledCount}` : 'Programados', icon: CalendarClock },
        { key: 'ARCHIVED',  label: 'Archivo' },
      ]}
      activeTab={listTab}
      onTabChange={setListTab}
      searchValue={announcementSearch}
      onSearchChange={setAnnouncementSearch}
      placeholder="Buscar en avisos, sucursales o roles..."
    />
  );

  return (
    <>
      <style>{`@keyframes subtle-shake { 0%, 100% { transform: rotate(0deg) scale(1.01); } 25% { transform: rotate(-0.5deg) scale(1.01); } 75% { transform: rotate(0.5deg) scale(1.01); } } .animate-subtle-shake { animation: subtle-shake 0.4s ease-in-out infinite; }`}</style>
      <ConfirmModal isOpen={confirmDialog.isOpen} onClose={() => setConfirmDialog({ isOpen: false, annId: null })} onConfirm={executeDelete} title="¿Eliminar este aviso?" message="Esta acción borrará el aviso para siempre. No podrás recuperarlo ni ver las estadísticas." confirmText="Sí, Eliminar" isProcessing={isSubmitting} isDestructive={true} />
      <ConfirmModal isOpen={archiveDialog.isOpen} onClose={() => setArchiveDialog({ isOpen: false, annId: null })} onConfirm={executeArchive} title="¿Archivar Aviso?" message="El aviso se moverá a la pestaña de Archivo y dejará de mostrarse en los Kioscos. ¿Continuar?" confirmText="Sí, Archivar" isProcessing={isSubmitting} isDestructive={false} />
      <AlertModal isOpen={alertDialog.isOpen} onClose={() => setAlertDialog({ isOpen: false, title: '', message: '' })} title={alertDialog.title} message={alertDialog.message} type="error" />

      <GlassViewLayout icon={Megaphone} title="Centro de Comunicaciones" filtersContent={renderFiltersContent()} transparentBody={true} fixedScrollMode={true}>
        <div className="flex flex-col lg:flex-row items-start gap-6 lg:gap-8 px-2 lg:px-0 w-full lg:h-[calc(100vh-230px)]">

          <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 group/panel transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] z-sidebar transform-gpu">
            <div className={`bg-surface-card backdrop-blur-[30px] backdrop-saturate-[180%] border p-6 md:p-8 rounded-header transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] relative overflow-visible ${editingAnnId ? 'bg-surface-card border border-warning/40 shadow-[var(--shadow-glass-4)]' : 'border border-border-card shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glass-5)]'}`}>              
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-content flex items-center gap-2 text-subtitle">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${editingAnnId ? 'bg-warning-solid' : 'bg-brand'}`}>
                    {editingAnnId ? <Edit3 size={16} strokeWidth={2.5} /> : <Target size={16} strokeWidth={2.5} />}
                  </div>
                  <span className="font-black uppercase tracking-tight ml-1">{editingAnnId ? 'Editar Aviso' : 'Nuevo Aviso'}</span>
                </h3>
                {editingAnnId && (
                  <Button variant="destructive" icon={X} onClick={handleCancelEdit}>Cancelar</Button>
                )}
              </div>

              {error && <div className="mb-5 bg-warning/10 backdrop-blur-sm border border-warning/30 text-warning-text px-4 py-3 rounded-2xl text-label font-bold shadow-[var(--shadow-shine)] flex items-start gap-2 animate-in fade-in slide-in-from-top-2"><AlertCircle size={16} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} /><span className="leading-tight">{error}</span></div>}

              <form onSubmit={handlePublish} className="space-y-5 relative z-base">
                <div>
                  <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">Nivel de Prioridad</label>
                  {/* 2026-07-27: eran dos <button> con `priority === X ? activo :
                      inactivo`, que es exactamente un SegmentedControl. Los había
                      dejado fuera creyendo que eran otro control por ir a dos
                      columnas — pero eso es layout, no concepto. */}
                  <SegmentedControl
                    layout="block"
                    label="Nivel de prioridad"
                    value={priority}
                    onChange={setPriority}
                    options={[
                      { value: 'NORMAL', label: 'Normal',  icon: Megaphone },
                      { value: 'URGENT', label: 'Urgente', icon: Flame, tone: 'danger' },
                    ]}
                  />
                </div>

                <div>
                  <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">Título del Mensaje</label>
 <input type="text" placeholder="Ej: Mantenimiento de servidores..." className={`w-full py-3.5 px-4 bg-surface-card border border-border-card focus:bg-surface-card focus:border-brand/30 focus:shadow-[var(--shadow-ring-brand)] rounded-2xl text-body-xl font-bold text-content-2 transition-all duration-300 placeholder-content-3 placeholder:font-normal placeholder:tracking-normal ${error && !title.trim() ? 'border-warning/40' : ''}`} value={title} onChange={(e) => setTitle(e.target.value)} disabled={isSubmitting} />
                </div>

                <div>
                  <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">Contenido</label>
 <PortalTextarea
     placeholder="Escribe los detalles de tu anuncio aquí..." value={message} onChange={(e) => setMessage(e.target.value)} disabled={isSubmitting}
 />
                </div>

                <div className="pt-3 border-t border-border-card">
                  {isBranchScoped ? (
                    <div className="flex items-center gap-2 px-1 py-2 mb-1">
                      <Building2 size={14} className="text-success shrink-0" />
                      <span className="text-label font-bold text-content-2">Dirigido a tu sucursal</span>
                    </div>
                  ) : (
                    <>
                      <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">¿A quién va dirigido?</label>
                      <div className="flex items-center gap-1 bg-surface-card-hover/40 p-1.5 rounded-full border border-divider shadow-[var(--shadow-shine)] mb-4">
                        {targetTypes.map((type) => {
                          const isActive = targetType === type.id;
                          return (
                            <button key={type.id} type="button" disabled={isSubmitting} onClick={() => { setTargetType(type.id); setTargetValue(''); setSelectedEmployees([]); setEmpSearch(''); }} className={`flex-1 h-9 rounded-full text-micro md:text-caption font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border ${isActive ? 'bg-surface-card text-brand-text border-border-card shadow-sm scale-[1.02]' : 'bg-transparent text-content-3 border-transparent hover:bg-surface-card-hover hover:text-content hover:-translate-y-0.5 hover:shadow-sm hover:border-border-card'}`}>{type.label}</button>
                          );
                        })}
                      </div>
                      {targetType === 'BRANCH' && (
                        <LiquidSelect
                          value={targetValue}
                          onChange={setTargetValue}
                          options={(branches || []).map((b) => ({ value: b.id, label: b.name }))}
                          placeholder="-- Seleccionar Sucursal --"
                          disabled={isSubmitting}
                          clearable={false}
                        />
                      )}
                      {targetType === 'ROLE' && (
                        <LiquidSelect
                          value={targetValue}
                          onChange={setTargetValue}
                          options={uniqueRoles.map((r) => ({ value: r, label: r }))}
                          placeholder="-- Seleccionar Cargo --"
                          disabled={isSubmitting}
                          clearable={false}
                        />
                      )}
                  {targetType === 'EMPLOYEE' && (
                    <div className="space-y-3">
                      {selectedEmployees.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 p-3 bg-surface-card rounded-2xl border border-border-card shadow-sm">
                          {selectedEmployees.map((id) => (
                            <div key={id} className="flex items-center gap-1.5 bg-brand/10 text-brand-text px-2.5 py-1.5 rounded-lg text-label font-bold border border-brand/20 hover:scale-105">
                              <span>{employeesById.get(String(id))?.name || 'Empleado'}</span>
                              <Button variant="ghost" icon={X} disabled={isSubmitting} iconOnly onClick={() => removeEmployee(id)} />
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="relative">
                        <SearchInput value={empSearch} onChange={setEmpSearch} placeholder="Buscar persona por nombre..." disabled={isSubmitting} />
                        {empSearch.trim() && (
                          <div className="absolute z-content w-full mt-2 bg-surface-card backdrop-blur-xl border border-border-card rounded-2xl shadow-[var(--shadow-elevation-lg)] max-h-60 overflow-y-auto p-1">
                            {filteredEmployeeSearch.length ? filteredEmployeeSearch.map((emp) => (<Button  onClick={() => addEmployee(emp.id)}><p className="text-body font-bold text-content-2">{emp.name}</p><Plus size={14} className="text-brand-text" /></Button>)) : <div className="p-3 text-body-sm text-content-3 font-bold text-center">Sin resultados.</div>}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                    </>
                  )}
                </div>

                <div className="pt-3 border-t border-border-card">
                   <div className="flex items-center justify-between mb-3 pl-1">
                      <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] flex items-center gap-1.5">
                        <CalendarClock size={14} /> ¿Cuándo se publica?
                      </label>
                      <Switch
                        checked={publishImmediately}
                        onChange={setPublishImmediately}
                        variant="success"
                        size="sm"
                        label="Publicar de inmediato"
                      />
                   </div>
                   
                   <div inert={publishImmediately ? true : undefined} className={`transition-all duration-300 overflow-hidden ${publishImmediately ? 'h-0 opacity-0' : 'h-[60px] opacity-100 mt-2'}`}>
                       <div className="bg-surface-card rounded-xl px-3 py-2 border border-border-card shadow-sm flex items-center">
                          <LiquidDatePicker 
                            value={scheduledDate} 
                            onChange={setScheduledDate} 
                            placeholder="Selecciona la fecha..." 
                          />
                       </div>
                   </div>
                   {publishImmediately && (
                      <p className="text-caption text-success font-bold mt-1 ml-1 flex items-center gap-1">
                        <Power size={10} /> Se mostrará en los kioscos inmediatamente
                      </p>
                   )}
                </div>

                <button type="submit" disabled={isSubmitting || !canEdit} className={`w-full py-4 mt-2 active:scale-[0.98] text-white rounded-2xl font-black uppercase tracking-widest text-label transition-all flex items-center justify-center gap-2 border-none shadow-[var(--shadow-glow-brand)] hover:shadow-[var(--shadow-glow-brand)] ${editingAnnId ? 'bg-warning hover:bg-warning-hover shadow-amber-500/30' : 'bg-brand hover:bg-brand-hover'}`}>
                  {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Procesando...</> : editingAnnId ? <><Save size={16} strokeWidth={2.5} /> Guardar Cambios</> : publishImmediately ? <><Send size={16} strokeWidth={2.5} /> Publicar Aviso</> : <><CalendarClock size={16} strokeWidth={2.5} /> Programar Aviso</>}
                </button>
              </form>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-w-0 w-full overflow-y-auto overscroll-contain pb-32 scrollbar-hide lg:h-[100dvh] lg:-mt-[180px] xl:-mt-[200px] lg:pt-[180px] xl:pt-[200px] pointer-events-auto">
            <div className="space-y-5 flex-1 pt-4 px-3 md:px-4">
              {paginatedList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                  <div className="relative group flex flex-col items-center text-center">
                    <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 transition-colors duration-700 ${announcementSearch ? 'bg-brand' : listTab === 'ACTIVE' ? 'bg-success' : listTab === 'SCHEDULED' ? 'bg-chart-3' : 'bg-content-3'}`}></div>
                    
                    <div className={`relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card backdrop-blur-xl border border-border-card shadow-[var(--shadow-elevation-md)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] ${announcementSearch ? 'text-brand-text' : listTab === 'ACTIVE' ? 'text-success' : listTab === 'SCHEDULED' ? 'text-chart-3-text' : 'text-content-3'}`}>
                      {announcementSearch ? <Search size={40} strokeWidth={2} /> : listTab === 'ACTIVE' ? <CheckCircle2 size={40} strokeWidth={2} /> : listTab === 'SCHEDULED' ? <CalendarClock size={40} strokeWidth={2} /> : <Archive size={40} strokeWidth={2} />}
                    </div>
                    
                    <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">
                        {announcementSearch ? 'Sin resultados' : listTab === 'ACTIVE' ? 'Todo está al día' : listTab === 'SCHEDULED' ? 'Sin programaciones' : 'Archivo vacío'}
                    </h3>
                    <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">
                        {announcementSearch ? 'No encontramos avisos con esa búsqueda.' : listTab === 'ACTIVE' ? 'Bandeja limpia. No hay avisos activos pendientes por el momento.' : listTab === 'SCHEDULED' ? 'No tienes avisos esperando para publicarse en el futuro.' : 'Aquí aparecerán los avisos que ya cumplieron su ciclo.'}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                {isAnnFuzzy && debouncedSearchTerm && (
                  <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{debouncedSearchTerm}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
                )}
                {paginatedList.map((ann, i) => (
                  <div key={ann.id} className="animate-stagger-child" style={{ '--stagger-delay': `${Math.min(i, 7) * 45}ms` }}>
                    <AnnouncementCard ann={ann} onArchive={handleArchiveCallback} onDelete={handleDeleteCallback} onViewDetail={handleViewDetailCallback} onEdit={() => editingAnnId === ann.id ? handleCancelEdit() : handleEditClick(ann)} isEditingThis={editingAnnId === ann.id} canEdit={canEdit} />
                  </div>
                ))}
                </>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-6 mt-2 border-t border-divider shrink-0 px-3 md:px-4">
                <span className="text-label font-bold text-content-3 uppercase tracking-widest bg-surface-card backdrop-blur-sm shadow-sm px-3 py-1.5 rounded-lg border border-border-card">Pág {currentPage} de {totalPages}</span>
                <div className="flex gap-2">
                  <Button variant="secondary" icon={ChevronLeft} disabled={currentPage === 1} iconOnly onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} />
                  <Button variant="secondary" icon={ChevronRight} disabled={currentPage === totalPages} iconOnly onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} />
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