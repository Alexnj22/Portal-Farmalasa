import React, { useMemo, useState } from 'react';
import {
  Megaphone, Send, Trash2, Globe, Building2,
  Users, User, Target, X, Search, Plus, CheckCircle2,
  Archive, Eye, AlertCircle
} from 'lucide-react';
import { useStaff } from '../context/StaffContext';

const makeId = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));

const AnnouncementsView = () => {
  const { announcements, setAnnouncements, branches, employees } = useStaff();

  // Estados del formulario
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetType, setTargetType] = useState('GLOBAL');
  const [targetValue, setTargetValue] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState([]); // string ids
  const [empSearch, setEmpSearch] = useState('');

  // Estados de UI
  const [listTab, setListTab] = useState('ACTIVE'); // 'ACTIVE' | 'ARCHIVED'
  const [readersModal, setReadersModal] = useState(null);

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
    return Array.from(new Set((employees || []).map((e) => e.role).filter(Boolean)));
  }, [employees]);

  const targetTypes = useMemo(
    () => [
      { id: 'GLOBAL', label: 'Todos' },
      { id: 'BRANCH', label: 'Sucursal' },
      { id: 'ROLE', label: 'Cargo' },
      { id: 'EMPLOYEE', label: 'Personal' },
    ],
    []
  );

  const getTargetAudience = (type, value) => {
    const list = employees || [];
    if (type === 'GLOBAL') return list;

    if (type === 'BRANCH') {
      return list.filter((e) => String(e.branchId) === String(value));
    }

    if (type === 'ROLE') {
      return list.filter((e) => e.role === value);
    }

    if (type === 'EMPLOYEE') {
      const ids = (value || []).map(String);
      const set = new Set(ids);
      return list.filter((e) => set.has(String(e.id)));
    }

    return [];
  };

  const handlePublish = (e) => {
    e.preventDefault();

    if (!title.trim() || !message.trim()) return alert('Llena el título y el mensaje.');
    if (targetType === 'BRANCH' && !targetValue) return alert('Selecciona una sucursal.');
    if (targetType === 'ROLE' && !targetValue) return alert('Selecciona un cargo.');
    if (targetType === 'EMPLOYEE' && selectedEmployees.length === 0)
      return alert('Selecciona al menos un empleado.');

    const finalTargetValue =
      targetType === 'EMPLOYEE' ? selectedEmployees.map(String) : String(targetValue);

    const newAnnouncement = {
      id: makeId(),
      title: title.trim(),
      message: message.trim(),
      targetType,
      targetValue: finalTargetValue,
      date: new Date().toISOString(),
      readBy: [],
      isArchived: false,
    };

    setAnnouncements((prev) => [newAnnouncement, ...(prev || [])]);

    setTitle('');
    setMessage('');
    setTargetValue('');
    setSelectedEmployees([]);
    setEmpSearch('');
    setListTab('ACTIVE');
  };

  const handleDelete = (id) => {
    const sid = String(id);

    // CANDADO LÓGICO: no borrar si ya tiene lecturas
    const annToDelete = (announcements || []).find((a) => String(a.id) === sid);
    if (annToDelete?.readBy?.length) {
      alert(
        'No puedes eliminar un aviso que ya ha sido leído por al menos un empleado. Por favor, archívalo para mantener el registro.'
      );
      return;
    }

    if (window.confirm('¿Estás seguro de eliminar este aviso permanentemente?')) {
      setAnnouncements((prev) => (prev || []).filter((a) => String(a.id) !== sid));
    }
  };

  const handleManualArchive = (id) => {
    const sid = String(id);
    setAnnouncements((prev) =>
      (prev || []).map((a) => (String(a.id) === sid ? { ...a, isArchived: true } : a))
    );
  };

  const addEmployee = (id) => {
    const sid = String(id);
    setSelectedEmployees((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
    setEmpSearch('');
  };

  const removeEmployee = (id) => {
    const sid = String(id);
    setSelectedEmployees((prev) => prev.filter((empId) => empId !== sid));
  };

  const getTargetBadge = (announcement) => {
    switch (announcement.targetType) {
      case 'GLOBAL':
        return (
          <span className="flex items-center gap-1.5 text-[#007AFF] bg-[#007AFF]/10 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-[#007AFF]/20">
            <Globe size={12} strokeWidth={2} /> Global
          </span>
        );

      case 'BRANCH': {
        const bName = branchNameById.get(String(announcement.targetValue)) || 'Sucursal';
        return (
          <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-emerald-200/50">
            <Building2 size={12} strokeWidth={2} /> {bName}
          </span>
        );
      }

      case 'ROLE':
        return (
          <span className="flex items-center gap-1.5 text-purple-600 bg-purple-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-purple-200/50">
            <Users size={12} strokeWidth={2} /> {announcement.targetValue}
          </span>
        );

      case 'EMPLOYEE':
        return (
          <span className="flex items-center gap-1.5 text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-orange-200/50">
            <User size={12} strokeWidth={2} /> {announcement.targetValue?.length || 0} Personal
          </span>
        );

      default:
        return null;
    }
  };

  const processedAnnouncements = useMemo(() => {
    return (announcements || []).map((ann) => {
      const audience = getTargetAudience(ann.targetType, ann.targetValue);
      const totalExpected = audience.length;

      const readIds = (ann.readBy || []).map((r) =>
        String(typeof r === 'object' ? r.employeeId : r)
      );
      const readSet = new Set(readIds);

      const isFullyRead = totalExpected > 0 && readSet.size >= totalExpected;

      return {
        ...ann,
        audience,
        readIds,
        readSet,
        totalExpected,
        isCompleted: ann.isArchived || isFullyRead,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcements, employees]); // employees afecta audiencias

  const activeAnns = processedAnnouncements.filter((a) => !a.isCompleted);
  const archivedAnns = processedAnnouncements.filter((a) => a.isCompleted);
  const currentList = listTab === 'ACTIVE' ? activeAnns : archivedAnns;

  const filteredEmployeeSearch = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return [];
    return (employees || [])
      .filter((e) => e?.name?.toLowerCase().includes(q))
      .filter((e) => !selectedEmployees.includes(String(e.id)))
      .slice(0, 30);
  }, [empSearch, employees, selectedEmployees]);

  return (
    <div className="p-4 md:p-8 space-y-6 font-sans max-w-7xl mx-auto h-full relative">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold text-slate-900 flex items-center gap-3 tracking-tight">
          <div className="p-2.5 bg-gradient-to-tr from-[#007AFF] to-[#5856D6] rounded-xl shadow-md">
            <Megaphone className="text-white" size={24} strokeWidth={1.5} />
          </div>
          Avisos
        </h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* COLUMNA IZQUIERDA: FORMULARIO */}
        <div className="lg:col-span-5 xl:col-span-4 h-fit sticky top-4">
          <div className="glass-surface p-6 rounded-[2rem]">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-6 text-[15px]">
              <Target className="text-[#007AFF]" size={18} strokeWidth={2} /> Nuevo Aviso
            </h3>

            <form onSubmit={handlePublish} className="space-y-5">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                  Título del Mensaje
                </label>
                <input
                  type="text"
                  placeholder="Describe el titulo..."
                  className="w-full bg-black/[0.04] border border-black/[0.04] rounded-[1rem] p-3.5 text-[14px] text-slate-800 outline-none focus:bg-white focus:border-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] font-semibold transition-all duration-300 placeholder-black/30"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                  Contenido
                </label>
                <textarea
                  placeholder="Describe el aviso aquí..."
                  className="w-full bg-black/[0.04] border border-black/[0.04] rounded-[1rem] p-3.5 text-[14px] text-slate-800 outline-none focus:bg-white focus:border-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] resize-none h-28 font-medium transition-all duration-300 placeholder-black/30 leading-relaxed"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              <div className="pt-3 border-t border-black/[0.05]">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">
                  ¿A quién va dirigido?
                </label>

                <div className="bg-black/[0.05] p-1 rounded-[1rem] relative flex items-center mb-4">
                  <div
                    className="absolute top-1 bottom-1 w-[calc(25%-2px)] bg-white rounded-[0.75rem] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
                    style={{
                      transform: `translateX(${
                        targetTypes.findIndex((t) => t.id === targetType) * 100
                      }%)`,
                    }}
                  />
                  {targetTypes.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => {
                        setTargetType(type.id);
                        setTargetValue('');
                        setSelectedEmployees([]);
                        setEmpSearch('');
                      }}
                      className={`flex-1 py-2 text-[11px] font-semibold tracking-wide transition-colors duration-200 z-10 ${
                        targetType === type.id
                          ? 'text-black'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>

                {targetType === 'BRANCH' && (
                  <select
                    className="w-full bg-black/[0.04] border border-black/[0.04] rounded-[1rem] p-3.5 text-[14px] outline-none font-medium text-slate-800 focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] transition-all"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                  >
                    <option value="" disabled>
                      -- Seleccionar Sucursal --
                    </option>
                    {(branches || []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}

                {targetType === 'ROLE' && (
                  <select
                    className="w-full bg-black/[0.04] border border-black/[0.04] rounded-[1rem] p-3.5 text-[14px] outline-none font-medium text-slate-800 focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] transition-all"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                  >
                    <option value="" disabled>
                      -- Seleccionar Cargo --
                    </option>
                    {uniqueRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )}

                {targetType === 'EMPLOYEE' && (
                  <div className="space-y-3">
                    {selectedEmployees.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 p-3 bg-white/60 rounded-[1rem] border border-white/80 shadow-sm">
                        {selectedEmployees.map((id) => {
                          const emp = employeesById.get(String(id));
                          return (
                            <div
                              key={id}
                              className="flex items-center gap-1.5 bg-[#007AFF]/10 text-[#007AFF] px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[#007AFF]/20"
                            >
                              <span>{emp?.name || 'Empleado'}</span>
                              <button
                                type="button"
                                onClick={() => removeEmployee(id)}
                                className="hover:text-red-500"
                                aria-label="Quitar empleado"
                              >
                                <X size={12} strokeWidth={2} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="relative">
                      <Search
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30"
                        size={18}
                      />
                      <input
                        type="text"
                        placeholder="Buscar persona..."
                        className="w-full pl-10 pr-4 py-3.5 bg-black/[0.04] rounded-[1rem] text-[14px] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] transition-all"
                        value={empSearch}
                        onChange={(e) => setEmpSearch(e.target.value)}
                      />

                      {empSearch.trim() && (
                        <div className="absolute z-20 w-full mt-2 bg-white/90 backdrop-blur-xl border border-white rounded-[1.25rem] shadow-[0_12px_40px_rgba(0,0,0,0.12)] max-h-60 overflow-y-auto p-1">
                          {filteredEmployeeSearch.length ? (
                            filteredEmployeeSearch.map((emp) => (
                              <button
                                type="button"
                                key={emp.id}
                                onClick={() => addEmployee(emp.id)}
                                className="w-full p-3 hover:bg-[#007AFF]/10 text-left flex items-center justify-between rounded-xl mx-0.5"
                              >
                                <p className="text-[13px] font-semibold text-slate-800">
                                  {emp.name}
                                </p>
                                <Plus size={14} className="text-slate-400" />
                              </button>
                            ))
                          ) : (
                            <div className="p-3 text-[12px] text-slate-400 italic">
                              Sin resultados.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-4 mt-2 bg-[#007AFF] hover:bg-[#0066CC] active:scale-[0.98] text-white rounded-[1.25rem] font-semibold text-[15px] transition-all flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(0,122,255,0.3)] border-none"
              >
                Publicar Aviso <Send size={16} strokeWidth={2} />
              </button>
            </form>
          </div>
        </div>

        {/* COLUMNA DERECHA: LISTA DE AVISOS Y PESTAÑAS */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col h-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 px-2">
            <div className="bg-black/[0.05] p-1 rounded-[1.25rem] relative flex items-center w-full sm:w-auto">
              <div
                className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-[1rem] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
                style={{
                  transform: listTab === 'ARCHIVED' ? 'translateX(100%)' : 'translateX(0)',
                }}
              />

              <button
                onClick={() => setListTab('ACTIVE')}
                className={`flex-1 sm:w-36 py-2.5 text-[13px] font-semibold transition-colors duration-200 z-10 flex items-center justify-center gap-2 ${
                  listTab === 'ACTIVE'
                    ? 'text-black'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Megaphone size={16} strokeWidth={2} /> Activos
                <span className="bg-black/5 px-2 py-0.5 rounded-full text-[10px] ml-1">
                  {activeAnns.length}
                </span>
              </button>

              <button
                onClick={() => setListTab('ARCHIVED')}
                className={`flex-1 sm:w-36 py-2.5 text-[13px] font-semibold transition-colors duration-200 z-10 flex items-center justify-center gap-2 ${
                  listTab === 'ARCHIVED'
                    ? 'text-black'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Archive size={16} strokeWidth={2} /> Archivados
                <span className="bg-black/5 px-2 py-0.5 rounded-full text-[10px] ml-1">
                  {archivedAnns.length}
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-4 pb-10">
            {currentList.length === 0 ? (
              <div className="glass-card p-16 text-center text-slate-400 flex flex-col items-center justify-center shadow-sm">
                <div className="w-20 h-20 bg-black/5 rounded-full flex items-center justify-center mb-4">
                  {listTab === 'ACTIVE' ? (
                    <CheckCircle2 size={32} className="text-green-500/50" strokeWidth={1.5} />
                  ) : (
                    <Archive size={32} className="text-slate-300" strokeWidth={1.5} />
                  )}
                </div>
                <p className="font-semibold text-[15px] text-slate-500">
                  {listTab === 'ACTIVE' ? 'No hay avisos pendientes' : 'No hay historial archivado'}
                </p>
              </div>
            ) : (
              currentList.map((ann) => (
                <div
                  key={ann.id}
                  className={`bg-white/60 backdrop-blur-xl p-6 rounded-[2rem] border shadow-[0_4px_20px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,1)] flex flex-col gap-4 transition-all duration-300 group relative ${
                    listTab === 'ARCHIVED'
                      ? 'border-transparent opacity-80 hover:opacity-100'
                      : 'border-white/80 hover:shadow-[0_8px_30px_rgba(0,122,255,0.08)]'
                  }`}
                >
                  <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!ann.isCompleted && (
                      <button
                        onClick={() => handleManualArchive(ann.id)}
                        className="p-2.5 text-slate-400 bg-white/50 border border-white shadow-sm hover:text-slate-800 hover:bg-slate-100 rounded-full transition-all"
                        title="Archivar manualmente"
                      >
                        <Archive size={16} strokeWidth={2} />
                      </button>
                    )}

                    {ann.readIds.length === 0 && (
                      <button
                        onClick={() => handleDelete(ann.id)}
                        className="p-2.5 text-slate-400 bg-white/50 border border-white shadow-sm hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                        title="Eliminar definitivamente"
                      >
                        <Trash2 size={16} strokeWidth={2} />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {getTargetBadge(ann)}
                    <span className="text-[10px] font-medium text-slate-400 font-mono tracking-widest bg-black/5 px-2 py-1 rounded-md">
                      #{String(ann.id).slice(-5)}
                    </span>
                    {ann.isCompleted && listTab === 'ARCHIVED' && (
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-200/50 px-2 py-1 rounded-md flex items-center gap-1">
                        <Archive size={10} /> Archivado
                      </span>
                    )}
                  </div>

                  <div className="pr-16">
                    <h4 className="font-semibold text-slate-900 text-[18px] leading-tight mb-2 tracking-tight">
                      {ann.title}
                    </h4>
                    <p className="text-slate-600 text-[14px] leading-relaxed font-medium">
                      {ann.message}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-black/[0.04] mt-2">
                    <button
                      onClick={() => setReadersModal(ann)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all active:scale-95 ${
                        ann.readIds.length >= ann.totalExpected && ann.totalExpected > 0
                          ? 'bg-green-500/10 text-green-700 border-green-500/20 hover:bg-green-500/20'
                          : 'bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/20 hover:bg-[#007AFF]/20'
                      }`}
                    >
                      {ann.readIds.length >= ann.totalExpected && ann.totalExpected > 0 ? (
                        <CheckCircle2 size={14} strokeWidth={2} />
                      ) : (
                        <Eye size={14} strokeWidth={2} />
                      )}
                      Vistos: {ann.readIds.length} / {ann.totalExpected}
                    </button>

                    <p className="text-[11px] text-slate-400 font-semibold tracking-widest uppercase">
                      {new Date(ann.date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE LECTURAS */}
      {readersModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white/80 backdrop-blur-3xl p-6 md:p-8 rounded-[2.5rem] border border-white shadow-[0_24px_48px_rgba(0,0,0,0.12)] w-full max-w-md flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-[18px] font-bold text-slate-900 tracking-tight">
                  Reporte de Lecturas
                </h3>
                <p className="text-[12px] text-slate-500 font-medium truncate max-w-[250px]">
                  {readersModal.title}
                </p>
              </div>
              <button
                onClick={() => setReadersModal(null)}
                className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-hide">
              <div>
                <h4 className="text-[11px] font-bold text-green-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> Ya lo leyeron ({readersModal.readIds.length})
                </h4>

                {readersModal.audience.filter((emp) => readersModal.readSet?.has(String(emp.id))).length >
                0 ? (
                  <div className="space-y-2">
                    {readersModal.audience
                      .filter((emp) => readersModal.readSet?.has(String(emp.id)))
                      .map((emp) => (
                        <div
                          key={emp.id}
                          className="flex items-center gap-3 p-3 bg-white/60 rounded-2xl border border-white shadow-sm"
                        >
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-[10px]">
                            {emp.name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="text-[13px] font-semibold text-slate-800">
                              {emp.name}
                            </p>
                            <p className="text-[10px] text-slate-400 font-medium">{emp.role}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-400 italic">Nadie ha leído el aviso aún.</p>
                )}
              </div>

              <div className="pt-4 border-t border-black/5">
                <h4 className="text-[11px] font-bold text-orange-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <AlertCircle size={14} /> Pendientes ({readersModal.totalExpected - readersModal.readIds.length})
                </h4>

                {readersModal.audience.filter((emp) => !readersModal.readSet?.has(String(emp.id)))
                  .length > 0 ? (
                  <div className="space-y-2 opacity-70">
                    {readersModal.audience
                      .filter((emp) => !readersModal.readSet?.has(String(emp.id)))
                      .map((emp) => (
                        <div
                          key={emp.id}
                          className="flex items-center gap-3 p-3 bg-black/[0.03] rounded-2xl border border-black/[0.02]"
                        >
                          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-[10px]">
                            {emp.name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="text-[13px] font-semibold text-slate-700">
                              {emp.name}
                            </p>
                            <p className="text-[10px] text-slate-400 font-medium">{emp.role}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-400 italic">¡Todos han leído este aviso!</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnnouncementsView;