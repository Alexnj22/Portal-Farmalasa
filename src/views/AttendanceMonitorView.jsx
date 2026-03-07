// src/views/AttendanceMonitorView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock,
  CheckCircle,
  AlertTriangle,
  Utensils,
  LogOut,
  MapPin,
  Building2,
  Baby,
  Search,
  PlusCircle,
  DoorOpen,
  BadgeCheck,
  CircleDashed,
  Timer,
  Coffee,
  Zap,
  X,
  Users,
} from "lucide-react";

import { useStaffStore as useStaff } from '../store/staffStore';
import { getTodayScheduleConfig, normalizeText } from "../utils/helpers";
import BranchChips from "../components/common/BranchChips";

const AttendanceMonitorView = ({ setView, setActiveEmployee }) => {
  const { employees = [], branches = [], shifts = [], loadAttendanceLastDays } = useStaff();

  const [currentTime, setCurrentTime] = useState(new Date());
  const [filterBranch, setFilterBranch] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  // Filtros visuales
  const [statusTab, setStatusTab] = useState("ALL");
  const [searchOpen, setSearchOpen] = useState(false);

  const searchInputRef = useRef(null);

  // ✅ Cargar asistencia últimos N días (si existe la función en tu StaffContext)
  useEffect(() => {
    if (typeof loadAttendanceLastDays === "function") {
      loadAttendanceLastDays(15);
    }
  }, [loadAttendanceLastDays]);

  // Reloj
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-focus al buscador
  useEffect(() => {
    if (searchOpen) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    } else {
      setSearchTerm("");
    }
  }, [searchOpen]);

  const todayStr = useMemo(() => currentTime.toISOString().split("T")[0], [currentTime]);

  const branchNameById = useMemo(() => {
    const m = new Map();
    (branches || []).forEach((b) => m.set(String(b.id), b.name));
    return m;
  }, [branches]);

  // --- HELPERS DE TIEMPO ---
  const formatTime12h = (time24) => {
    if (!time24) return "";
    let [hours, minutes] = String(time24).split(":");
    hours = parseInt(hours, 10);
    const ampm = hours >= 12 ? "p.m." : "a.m.";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours.toString().padStart(2, "0")}:${minutes} ${ampm}`;
  };

  const buildDateFromTime = (timeStr, baseDate) => {
    if (!timeStr) return null;
    const d = new Date(baseDate);
    const [h, m] = String(timeStr).split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  };

  // --- EVALUACIÓN DE ESTADO ---
  const evaluateEmployeeStatus = (emp) => {
    const punches = (emp.attendance || []).filter((a) =>
      String(a.timestamp || "").startsWith(todayStr)
    );

    const config = getTodayScheduleConfig(emp, shifts);

    let status = config?.isOffDay ? "OFF_DAY" : "PENDING";
    let isLate = false;
    let lateText = "";
    let lastActionTime = null;

    const checkLateness = (punchDateObj, expectedDateObj) => {
      if (!expectedDateObj || !punchDateObj) return false;
      const diffMins = Math.floor((punchDateObj - expectedDateObj) / 60000);
      if (diffMins > 0) {
        const h = Math.floor(diffMins / 60);
        const m = diffMins % 60;
        lateText = h > 0 ? `${h}h ${m}m tarde` : `${m} min tarde`;
        return true;
      }
      return false;
    };

    const shiftStartD = config?.shift ? buildDateFromTime(config.shift.start, currentTime) : null;

    const lunchStartD = config?.lunchTime ? buildDateFromTime(config.lunchTime, currentTime) : null;
    const lunchEndD = lunchStartD ? new Date(lunchStartD.getTime() + 60 * 60000) : null;

    const lactStartD = config?.lactationTime ? buildDateFromTime(config.lactationTime, currentTime) : null;
    const lactEndD = lactStartD ? new Date(lactStartD.getTime() + 60 * 60000) : null;

    const lastPunch = punches.length > 0 ? punches[punches.length - 1] : null;

    if (lastPunch) {
      lastActionTime = new Date(lastPunch.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const lastType = lastPunch.type;

      if (["IN", "IN_LUNCH", "IN_LACTATION", "IN_RETURN"].includes(lastType)) {
        status = "WORKING";

        if (lastType === "IN" || lastType === "IN_RETURN") {
          let expectedIn = shiftStartD;

          // lactancia pegada al IN: inicio real después de lactancia
          const isGluedToIn =
            lactStartD && shiftStartD && lactStartD.getTime() === shiftStartD.getTime();

          if (isGluedToIn) expectedIn = lactEndD;

          if (lastType === "IN") isLate = checkLateness(new Date(lastPunch.timestamp), expectedIn);
        }

        if (lastType === "IN_LUNCH") {
          const punchOutLunch = [...punches].reverse().find((p) => p.type === "OUT_LUNCH");
          if (punchOutLunch) {
            const isGluedToLunch =
              lactStartD && lunchEndD && lactStartD.getTime() === lunchEndD.getTime();
            const minsAllowed = isGluedToLunch ? 120 : 60;
            const expectedReturn = new Date(new Date(punchOutLunch.timestamp).getTime() + minsAllowed * 60000);
            isLate = checkLateness(new Date(lastPunch.timestamp), expectedReturn);
          }
        }

        if (lastType === "IN_LACTATION") {
          const punchOutLact = [...punches].reverse().find((p) => p.type === "OUT_LACTATION");
          if (punchOutLact) {
            const expectedReturn = new Date(new Date(punchOutLact.timestamp).getTime() + 60 * 60000);
            isLate = checkLateness(new Date(lastPunch.timestamp), expectedReturn);
          }
        }
      } else if (lastType === "OUT_LUNCH") status = "LUNCH";
      else if (lastType === "OUT_LACTATION") status = "LACTATION";
      else if (lastType === "OUT" || lastType === "OUT_EXTRA") status = "FINISHED";
      else if (lastType === "OUT_EARLY") status = "EARLY_EXIT";
      else if (lastType === "IN_EXTRA") status = "EXTRA_WORKING";
    }

    return {
      status,
      isLate,
      lateText,
      punches,
      lastActionTime,
      shiftName: config?.shift?.name || "Libre",
      role: emp?.role || "",
      scheduleDetails: {
        start: config?.shift?.start,
        end: config?.shift?.end,
        lunch: config?.lunchTime,
        lactation: config?.lactationTime,
      },
    };
  };

  // --- PROCESAMIENTO DE DATOS CON BÚSQUEDA NORMALIZADA ---
  const { employeeDataList, stats } = useMemo(() => {
    const st = {
      total: 0,
      working: 0,
      pause: 0,
      late: 0,
      pending: 0,
      extra: 0,
      finished: 0,
      off: 0,
    };

    const q = normalizeText(searchTerm);

    const processed = (employees || [])
      .map((emp) => {
        const data = evaluateEmployeeStatus(emp);

        const matchesBranch =
          filterBranch === "ALL" || String(emp.branchId) === String(filterBranch);

        const matchesSearch =
          !q ||
          normalizeText(emp.name).includes(q) ||
          normalizeText(emp.code).includes(q) ||
          normalizeText(emp.role).includes(q);

        if (!matchesBranch || !matchesSearch) return null;

        st.total++;
        if (data.status === "WORKING") st.working++;
        if (data.status === "LUNCH" || data.status === "LACTATION") st.pause++;
        if (data.status === "PENDING") st.pending++;
        if (data.status === "EXTRA_WORKING") st.extra++;
        if (data.status === "FINISHED") st.finished++;
        if (data.status === "OFF_DAY") st.off++;
        if (data.isLate && data.status !== "FINISHED") st.late++;

        return { emp, ...data };
      })
      .filter(Boolean);

    const finalFiltered = processed.filter((row) => {
      if (statusTab === "ALL") return true;
      if (statusTab === "LATE") return row.isLate && row.status !== "FINISHED";
      if (statusTab === "PENDING") return row.status === "PENDING";
      if (statusTab === "WORKING") return row.status === "WORKING";
      if (statusTab === "PAUSE") return row.status === "LUNCH" || row.status === "LACTATION";
      if (statusTab === "EXTRA") return row.status === "EXTRA_WORKING";
      if (statusTab === "FINISHED") return row.status === "FINISHED";
      return true;
    });

    const order = {
      LATE: 0,
      PENDING: 1,
      WORKING: 2,
      LUNCH: 3,
      LACTATION: 3,
      EXTRA_WORKING: 4,
      EARLY_EXIT: 5,
      FINISHED: 6,
      OFF_DAY: 7,
    };

    finalFiltered.sort((a, b) => {
      const aKey = a.isLate && a.status !== "FINISHED" ? -1 : order[a.status] ?? 99;
      const bKey = b.isLate && b.status !== "FINISHED" ? -1 : order[b.status] ?? 99;
      if (aKey !== bKey) return aKey - bKey;
      return String(a.emp.name).localeCompare(String(b.emp.name));
    });

    return { employeeDataList: finalFiltered, stats: st };
  }, [employees, filterBranch, searchTerm, statusTab, currentTime, todayStr, shifts]);

  const statCards = [
    { id: "ALL", label: "Total", count: stats.total, color: "text-slate-900", border: "border-white/70", bg: "bg-white/40" },
    { id: "WORKING", label: "En Turno", count: stats.working, color: "text-emerald-700", border: "border-emerald-200/60", bg: "bg-emerald-50/40" },
    { id: "EXTRA", label: "Horas Extra", count: stats.extra, color: "text-purple-700", border: "border-purple-200/60", bg: "bg-purple-50/40" },
    { id: "PAUSE", label: "En Pausa", count: stats.pause, color: "text-orange-700", border: "border-orange-200/60", bg: "bg-orange-50/40" },
    { id: "LATE", label: "Con Atraso", count: stats.late, color: "text-red-700", border: "border-red-200/60", bg: "bg-red-50/40", icon: AlertTriangle },
    { id: "PENDING", label: "Pendientes", count: stats.pending, color: "text-slate-600", border: "border-slate-200/60", bg: "bg-slate-50/40" },
  ];

  const getStatusCardStyle = (status, isLate) => {
    if (isLate && status !== "FINISHED")
      return "border-red-200 bg-white/70 shadow-[0_10px_30px_rgba(255,59,48,0.10)]";
    switch (status) {
      case "WORKING":
        return "border-emerald-200 bg-white/70 shadow-[0_10px_30px_rgba(52,199,89,0.10)]";
      case "EXTRA_WORKING":
        return "border-purple-200 bg-white/70 shadow-[0_10px_30px_rgba(88,86,214,0.10)]";
      case "LUNCH":
        return "border-orange-200 bg-white/70 shadow-[0_10px_30px_rgba(255,149,0,0.10)]";
      case "LACTATION":
        return "border-pink-200 bg-white/70 shadow-[0_10px_30px_rgba(255,45,85,0.10)]";
      case "FINISHED":
        return "border-black/[0.08] bg-white/40 opacity-70 hover:opacity-100 transition-opacity";
      case "EARLY_EXIT":
        return "border-[#007AFF]/20 bg-white/60 shadow-[0_10px_30px_rgba(0,122,255,0.08)]";
      case "OFF_DAY":
        return "border-black/[0.08] bg-white/35 border-dashed opacity-60";
      default:
        return "border-black/[0.08] bg-white/45 border-dashed";
    }
  };

  const getStatusBadge = (status, isLate, lateText) => {
    if (isLate && status !== "FINISHED") {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 text-red-700 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-red-500/20">
          <AlertTriangle size={14} /> {lateText}
        </div>
      );
    }
    switch (status) {
      case "WORKING":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-700 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-emerald-500/20">
            <CheckCircle size={14} /> En Turno
          </div>
        );
      case "EXTRA_WORKING":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-purple-500/10 text-purple-700 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-purple-500/20">
            <PlusCircle size={14} /> Turno Extra
          </div>
        );
      case "LUNCH":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-orange-500/10 text-orange-700 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-orange-500/20">
            <Utensils size={14} /> Almorzando
          </div>
        );
      case "LACTATION":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-pink-500/10 text-pink-700 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-pink-500/20">
            <Baby size={14} /> Lactancia
          </div>
        );
      case "FINISHED":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/[0.06] text-slate-600 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-black/[0.06]">
            <LogOut size={14} /> Finalizado
          </div>
        );
      case "EARLY_EXIT":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#007AFF]/10 text-[#007AFF] rounded-xl text-[10px] font-bold uppercase tracking-widest border border-[#007AFF]/20">
            <DoorOpen size={14} /> Permiso / Retiro
          </div>
        );
      case "OFF_DAY":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/[0.06] text-slate-500 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-black/[0.06]">
            <Clock size={14} /> Día Libre
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/[0.06] text-slate-600 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-black/[0.06]">
            <CircleDashed size={14} /> Sin Marcar
          </div>
        );
    }
  };

  const punchIcon = (type) => {
    if (!type) return Timer;
    if (type === "IN" || type === "IN_RETURN") return BadgeCheck;
    if (type === "OUT_LUNCH" || type === "IN_LUNCH") return Coffee;
    if (type === "OUT_LACTATION" || type === "IN_LACTATION") return Baby;
    if (String(type).includes("EXTRA")) return Zap;
    if (String(type).startsWith("OUT")) return LogOut;
    return Timer;
  };

  const goToProfile = (emp) => {
    setActiveEmployee?.(emp);
    setView?.("employee-detail");
  };

  return (
    <div className="p-4 md:p-8 space-y-6 font-sans animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* HEADER */}
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <div>
          <h1 className="text-[28px] font-semibold text-slate-900 flex items-center gap-3 tracking-tight">
            <div className="p-2.5 bg-gradient-to-tr from-[#007AFF] to-[#5856D6] rounded-xl shadow-[0_10px_20px_rgba(0,122,255,0.25)]">
              <Clock className="text-white" size={22} strokeWidth={1.5} />
            </div>
            Monitor en Tiempo Real
          </h1>
          <p className="text-slate-500 text-[13px] font-medium mt-2">
            Control de asistencia, atrasos y extras en vivo.
          </p>
        </div>

        <div className="glass-surface px-5 py-3 rounded-[1.5rem] border border-white/70 shadow-[0_14px_30px_rgba(0,0,0,0.08)] flex items-center gap-3">
          <Clock size={18} className="text-[#007AFF]" />
          <span className="text-[18px] font-black tracking-[0.15em] font-mono text-slate-900">
            {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
      </header>

      {/* FILTROS */}
      <div className="flex items-center gap-3 relative z-20">
        <div className="flex-1 min-w-0">
          <BranchChips
            branches={branches || []}
            selectedBranch={filterBranch}
            onSelect={setFilterBranch}
            allowAll
          />
        </div>

        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          className={[
            "w-12 h-12 flex-shrink-0",
            "rounded-[1.2rem] border border-white/60 bg-white/40 backdrop-blur-md shadow-sm",
            "flex items-center justify-center",
            "transition-all duration-300 ease-out",
            "hover:bg-white hover:shadow-md active:scale-95",
            searchOpen ? "ring-2 ring-[#007AFF] bg-white text-[#007AFF]" : "text-slate-500 hover:text-[#007AFF]",
          ].join(" ")}
          title="Buscar empleado"
        >
          {searchOpen ? <X size={20} strokeWidth={2.5} /> : <Search size={20} strokeWidth={2.5} />}
        </button>
      </div>

      {/* BUSCADOR */}
      <div
        className={[
          "overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] relative z-10",
          searchOpen ? "max-h-24 opacity-100 mb-4" : "max-h-0 opacity-0 mb-0",
        ].join(" ")}
      >
        <div className="glass-surface p-2 rounded-[1.5rem] border border-white/70 shadow-sm flex items-center bg-white/60">
          <Search className="ml-4 text-slate-400" size={18} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Escribe nombre o código..."
            className="w-full bg-transparent border-none outline-none p-3 text-sm font-bold text-slate-700 placeholder-slate-400"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="mr-4 text-xs font-black text-slate-300 hover:text-red-500 uppercase transition-colors"
            >
              Borrar
            </button>
          )}
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 relative z-0">
        {statCards.map((card) => {
          const isActive = statusTab === card.id;
          const Icon = card.icon;

          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setStatusTab(card.id)}
              className={[
                "text-left p-5 rounded-[2rem] border transition-all duration-300 group relative overflow-hidden",
                isActive
                  ? "bg-white border-[#007AFF] shadow-[0_12px_24px_rgba(0,122,255,0.15)] scale-[1.02] ring-1 ring-[#007AFF]"
                  : `${card.bg} ${card.border} hover:bg-white hover:border-white hover:shadow-lg hover:scale-[1.02] hover:-translate-y-1`,
              ].join(" ")}
            >
              {Icon && (
                <div
                  className={[
                    "absolute -right-3 -top-3 opacity-10 transition-transform group-hover:scale-110 group-hover:rotate-12",
                    card.id === "LATE" ? "text-red-500" : "",
                  ].join(" ")}
                >
                  <Icon size={70} />
                </div>
              )}

              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 relative z-10">
                {card.label}
              </p>
              <p
                className={[
                  "text-[28px] font-black relative z-10 leading-none",
                  isActive ? "text-[#007AFF]" : card.color,
                ].join(" ")}
              >
                {card.count}
              </p>

              {isActive && (
                <div className="absolute bottom-3 right-3 animate-in zoom-in duration-300">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#007AFF] shadow-[0_0_10px_#007AFF]" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* GRID DE EMPLEADOS */}
      {employeeDataList.length === 0 ? (
        <div className="glass-surface rounded-[2rem] p-20 text-center border border-white/70 shadow-sm flex flex-col items-center gap-4 mt-8">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center animate-pulse">
            <Users size={32} className="text-slate-300" />
          </div>
          <div>
            <p className="text-[14px] font-black uppercase tracking-widest text-slate-400">
              No hay empleados en esta categoría
            </p>
            <p className="text-[12px] text-slate-400 mt-1 font-medium">
              Intenta cambiar el filtro o seleccionar otra tarjeta.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 pb-10">
          {employeeDataList.map(({ emp, status, isLate, lateText, punches, lastActionTime, shiftName, scheduleDetails }) => {
            const bName = branchNameById.get(String(emp.branchId)) || "N/A";

            return (
              <div
                key={emp.id}
                className={[
                  "p-5 rounded-[2.5rem] border bg-white/60 backdrop-blur-xl shadow-[0_10px_28px_rgba(0,0,0,0.06)] transition-all duration-300",
                  "hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,0,0,0.10)]",
                  getStatusCardStyle(status, isLate),
                ].join(" ")}
              >
                {/* Header Card */}
                <div className="flex justify-between items-start mb-5">
                  <button
                    type="button"
                    onClick={() => goToProfile(emp)}
                    className="flex items-center gap-4 text-left group w-full"
                  >
                    <div className="relative">
                      <div
                        className={[
                          "h-14 w-14 rounded-2xl border-2 overflow-hidden flex items-center justify-center font-black text-lg shadow-sm transition-transform group-hover:scale-105",
                          isLate && status !== "FINISHED"
                            ? "border-red-200 bg-red-50 text-red-500"
                            : "border-white bg-white text-slate-400",
                        ].join(" ")}
                      >
                        {emp.photo ? (
                          <img src={emp.photo} className="w-full h-full object-cover" alt="Foto" />
                        ) : (
                          String(emp?.name || "?").charAt(0)
                        )}
                      </div>

                      {emp.hasLactation && (
                        <div
                          className="absolute -bottom-1 -right-1 bg-pink-100 p-1.5 rounded-full border border-pink-200 text-pink-600 shadow-sm"
                          title="Lactancia Activa"
                        >
                          <Baby size={10} strokeWidth={3} />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 text-[15px] leading-tight truncate group-hover:text-[#007AFF] transition-colors">
                        {emp.name}
                      </h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate mt-0.5">
                        {emp.role || "Colaborador"}
                      </p>
                    </div>
                  </button>
                </div>

                {/* Status Badge */}
                <div className="mb-5">{getStatusBadge(status, isLate, lateText)}</div>

                {/* Detalles Info */}
                <div className="space-y-2.5 pt-4 border-t border-black/[0.04]">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 size={12} /> Sucursal
                    </span>
                    <span className="font-semibold text-slate-900">{bName}</span>
                  </div>

                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin size={12} /> Turno
                    </span>
                    <span className="font-semibold text-slate-900">{shiftName}</span>
                  </div>

                  {scheduleDetails?.start && (
                    <div className="bg-white/50 rounded-xl p-2.5 border border-black/[0.04] space-y-1.5">
                      <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-600">
                        <Clock size={12} className="text-[#007AFF]" />
                        <span>
                          {formatTime12h(scheduleDetails.start)} - {formatTime12h(scheduleDetails.end)}
                        </span>
                      </div>

                      {scheduleDetails.lunch && (
                        <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500">
                          <Utensils size={12} className="text-orange-500" />
                          <span>{formatTime12h(scheduleDetails.lunch)} (Almuerzo)</span>
                        </div>
                      )}

                      {scheduleDetails.lactation && (
                        <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500">
                          <Baby size={12} className="text-pink-500" />
                          <span>{formatTime12h(scheduleDetails.lactation)} (Lactancia)</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between items-center text-[11px] pt-1">
                    <span className="text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <Timer size={12} /> Último Reg.
                    </span>
                    <span
                      className={[
                        "font-black text-[13px]",
                        isLate && status !== "FINISHED" ? "text-red-600" : "text-slate-900",
                      ].join(" ")}
                    >
                      {lastActionTime || "--:--"}
                    </span>
                  </div>
                </div>

                {/* Chips de Marcajes Recientes */}
                {punches?.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-black/[0.04] flex flex-wrap gap-2">
                    {punches
                      .slice(-4)
                      .reverse()
                      .map((p, idx) => {
                        const Icon = punchIcon(p.type);
                        const t = new Date(p.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                        const isLatest = idx === 0;

                        return (
                          <div
                            key={`${p.timestamp}-${idx}`}
                            className={[
                              "flex items-center gap-1 px-2 py-1 rounded-lg border text-[9px] font-bold uppercase tracking-wider",
                              isLatest
                                ? "bg-white border-blue-200 text-blue-700 shadow-sm"
                                : "bg-white/40 border-black/5 text-slate-500",
                            ].join(" ")}
                          >
                            <Icon size={10} strokeWidth={2.5} />
                            {t}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AttendanceMonitorView;