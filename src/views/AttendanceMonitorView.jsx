// src/views/AttendanceMonitorView.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ChevronRight,
  ChevronDown,
} from "lucide-react";

import { useStaffStore as useStaff } from '../store/staffStore';
import { getTodayScheduleConfig, normalizeText } from "../utils/helpers";
import { tokenMatch } from '../utils/searchUtils';
import { useSearchToggle } from '../hooks/useSearchToggle';
import GlassViewLayout from "../components/GlassViewLayout";
import LiquidSelect from "../components/common/LiquidSelect";
import { toLocalISODate } from "../utils/timeClock.helpers";
import { useAuth } from '../context/AuthContext';

const EMPTY_ARRAY = [];

// Las 4 columnas del tablero cubren, entre todas, los 9 estados posibles de
// evaluateEmployeeStatus (WORKING/EXTRA_WORKING/LUNCH/LACTATION/BUSINESS_OUT/
// EARLY_EXIT/FINISHED/OFF_DAY/PENDING) — ningún empleado queda sin columna.
const KANBAN_COLUMNS = [
  {
    id: "working",
    label: "Trabajando",
    match: (status) => status === "WORKING" || status === "EXTRA_WORKING",
    tint: "bg-success/10 border-success/30",
    dot: "bg-success",
  },
  {
    id: "pause",
    label: "En Pausa",
    match: (status) => status === "LUNCH" || status === "LACTATION" || status === "BUSINESS_OUT",
    tint: "bg-chart-4/10 border-chart-4/30",
    dot: "bg-chart-4",
  },
  {
    id: "pending",
    label: "Sin Marcar",
    match: (status) => status === "PENDING",
    tint: "bg-surface-card-hover border-divider",
    dot: "bg-content-3",
  },
  {
    id: "finished",
    label: "Finalizado / Libre",
    match: (status) => status === "FINISHED" || status === "EARLY_EXIT" || status === "OFF_DAY",
    tint: "bg-surface-card/60 border-border-card",
    dot: "bg-content-3",
  },
];

const AttendanceMonitorView = ({ setView, setActiveEmployee }) => {
  const employees = useStaff(s => s.employees) || EMPTY_ARRAY;
  const branches = useStaff(s => s.branches) || EMPTY_ARRAY;
  const shifts = useStaff(s => s.shifts) || EMPTY_ARRAY;
  const loadAttendanceLastDays = useStaff(s => s.loadAttendanceLastDays);
  const { user, getScope } = useAuth();

  const [currentTime, setCurrentTime] = useState(new Date());
  const [filterBranch, setFilterBranch] = useState(
    getScope('monitor') === 'BRANCH' ? String(user?.branchId || "ALL") : "ALL"
  );
  const [searchTerm, setSearchTerm] = useState("");

  // Filtros visuales
  const [statusTab, setStatusTab] = useState("ALL");
  const [searchOpen, setSearchOpen] = useState(false);

  // Sub-secciones de sucursal dentro de cada columna: colapsables + paginadas
  const PAGE_SIZE = 6;
  const [collapsedSections, setCollapsedSections] = useState(() => new Set());
  const [visibleCounts, setVisibleCounts] = useState({});

  useEffect(() => {
    setVisibleCounts({}); // eslint-disable-line react-hooks/set-state-in-effect -- reinicia la paginación al cambiar de filtro/búsqueda, no tiene sentido arrastrar "ver más" de un resultado distinto
  }, [filterBranch, searchTerm, statusTab]);

  const toggleSectionCollapsed = (key) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const showMoreInSection = (key) => {
    setVisibleCounts((prev) => ({ ...prev, [key]: (prev[key] ?? PAGE_SIZE) + PAGE_SIZE }));
  };

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
      setSearchTerm(""); // eslint-disable-line react-hooks/set-state-in-effect -- limpia el buscador al cerrarlo
    }
  }, [searchOpen]);

  // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
  // cierra Y limpia; click afuera cierra SOLO si está vacío.
  const { containerProps: searchContainerRef } = useSearchToggle({
    active: searchOpen,
    value: searchTerm,
    onClear: () => setSearchTerm(""),
    onClose: () => setSearchOpen(false),
  });

  const todayStr = useMemo(() => toLocalISODate(currentTime), [currentTime]);

  const branchNameById = useMemo(() => {
    const m = new Map();
    (branches || []).forEach((b) => m.set(String(b.id), b.name));
    return m;
  }, [branches]);

  const branchOrder = useMemo(() => {
    const m = new Map();
    (branches || []).forEach((b, idx) => m.set(String(b.id), idx));
    return m;
  }, [branches]);

  const branchOptions = useMemo(() => [
    { value: "ALL", label: "Todas las Sucursales" },
    ...(branches || []).map((b) => ({ value: String(b.id), label: b.name })),
  ], [branches]);

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
  const evaluateEmployeeStatus = useCallback((emp) => {
    const punches = (emp.attendance || []).filter((a) =>
      a.timestamp && toLocalISODate(new Date(a.timestamp)) === todayStr
    );

    const config = getTodayScheduleConfig(emp, shifts);

    let status = config?.isOffDay ? "OFF_DAY" : "PENDING";
    let isLate = false;
    let lateText = "";
    let lastActionTime = null;

    const checkLateness = (punchDateObj, expectedDateObj) => {
      if (!expectedDateObj || !punchDateObj) return false;
      const diffMins = Math.floor((punchDateObj - expectedDateObj) / 60000);
      if (diffMins > 5) {
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
      else if (lastType === "OUT_BUSINESS") status = "BUSINESS_OUT";
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
  }, [todayStr, shifts, currentTime]);

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
          tokenMatch(searchTerm, emp.name, emp.code, emp.role);

        if (!matchesBranch || !matchesSearch) return null;

        st.total++;
        if (data.status === "WORKING") st.working++;
        if (data.status === "LUNCH" || data.status === "LACTATION" || data.status === "BUSINESS_OUT") st.pause++;
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
      if (statusTab === "PAUSE") return row.status === "LUNCH" || row.status === "LACTATION" || row.status === "BUSINESS_OUT";
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
      BUSINESS_OUT: 5,
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
  }, [employees, filterBranch, searchTerm, statusTab, evaluateEmployeeStatus]);

  const statCards = [
    { id: "ALL", label: "Total", count: stats.total, color: "text-content", border: "border-border-card", bg: "bg-surface-card" },
    { id: "WORKING", label: "En Turno", count: stats.working, color: "text-success-text", border: "border-success/30", bg: "bg-success/10" },
    { id: "EXTRA", label: "Horas Extra", count: stats.extra, color: "text-chart-3-text", border: "border-chart-3/30", bg: "bg-chart-3/10" },
    { id: "PAUSE", label: "En Pausa", count: stats.pause, color: "text-chart-4-text", border: "border-chart-4/30", bg: "bg-chart-4/10" },
    { id: "LATE", label: "Con Atraso", count: stats.late, color: "text-danger-text", border: "border-danger/30", bg: "bg-danger/10", icon: AlertTriangle },
    { id: "PENDING", label: "Pendientes", count: stats.pending, color: "text-content-2", border: "border-divider", bg: "bg-surface-card-hover/40" },
  ];

  const getStatusBadge = (status, isLate, lateText) => {
    if (isLate && status !== "FINISHED") {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-danger/10 text-danger-text rounded-xl text-caption font-bold uppercase tracking-widest border border-danger/30">
          <AlertTriangle size={14} /> {lateText}
        </div>
      );
    }
    switch (status) {
      case "WORKING":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-success/10 text-success-text rounded-xl text-caption font-bold uppercase tracking-widest border border-success/30">
            <CheckCircle size={14} /> En Turno
          </div>
        );
      case "EXTRA_WORKING":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-chart-3/10 text-chart-3-text rounded-xl text-caption font-bold uppercase tracking-widest border border-chart-3/30">
            <PlusCircle size={14} /> Turno Extra
          </div>
        );
      case "LUNCH":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-chart-4/10 text-chart-4-text rounded-xl text-caption font-bold uppercase tracking-widest border border-chart-4/30">
            <Utensils size={14} /> Almorzando
          </div>
        );
      case "LACTATION":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-chart-6/10 text-chart-6-text rounded-xl text-caption font-bold uppercase tracking-widest border border-chart-6/20">
            <Baby size={14} /> Lactancia
          </div>
        );
      case "FINISHED":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/[0.06] text-content-2 rounded-xl text-caption font-bold uppercase tracking-widest border border-black/[0.06]">
            <LogOut size={14} /> Finalizado
          </div>
        );
      case "EARLY_EXIT":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-brand/10 text-brand-text rounded-xl text-caption font-bold uppercase tracking-widest border border-brand/20">
            <DoorOpen size={14} /> Permiso / Retiro
          </div>
        );
      case "BUSINESS_OUT":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-chart-7/10 text-chart-7-text rounded-xl text-caption font-bold uppercase tracking-widest border border-chart-7/20">
            <MapPin size={14} /> Gestión Externa
          </div>
        );
      case "OFF_DAY":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/[0.06] text-content-3 rounded-xl text-caption font-bold uppercase tracking-widest border border-black/[0.06]">
            <Clock size={14} /> Día Libre
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/[0.06] text-content-2 rounded-xl text-caption font-bold uppercase tracking-widest border border-black/[0.06]">
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

  // Agrupa las filas de una columna por sucursal cuando el filtro está en
  // "Todas" — cada sucursal se muestra como sub-sección dentro de la
  // columna. Con una sucursal específica seleccionada no hay nada que
  // agrupar (todas las filas ya son de esa sucursal).
  const groupRowsByBranch = (rows) => {
    if (filterBranch !== "ALL") return [{ branchId: null, branchName: null, rows }];
    const groups = new Map();
    rows.forEach((row) => {
      const bId = String(row.emp.branchId);
      if (!groups.has(bId)) groups.set(bId, []);
      groups.get(bId).push(row);
    });
    return Array.from(groups.entries())
      .map(([branchId, groupRows]) => ({
        branchId,
        branchName: branchNameById.get(branchId) || "Sin Sucursal",
        rows: groupRows,
      }))
      .sort((a, b) => (branchOrder.get(a.branchId) ?? 99) - (branchOrder.get(b.branchId) ?? 99));
  };

  const renderEmployeeCard = ({ emp, status, isLate, lateText, punches, lastActionTime, shiftName, scheduleDetails }) => (
    <div
      key={emp.id}
      className="p-4 rounded-[2rem] border border-border-card bg-surface-card backdrop-blur-2xl shadow-[var(--shadow-elevation-sm)] hover:-translate-y-1 hover:shadow-[var(--shadow-elevation-md)] transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden transform-gpu"
    >
      <button
        type="button"
        onClick={() => goToProfile(emp)}
        className="flex items-center gap-3 text-left group w-full mb-3"
      >
        <div className="relative shrink-0">
          <div
            className={[
              "h-11 w-11 rounded-xl border-2 overflow-hidden flex items-center justify-center font-black text-sm shadow-sm transition-transform group-hover:scale-105",
              isLate && status !== "FINISHED"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-white bg-surface-card text-content-3",
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
              className="absolute -bottom-1 -right-1 bg-pink-100 p-1 rounded-full border border-pink-200 text-pink-600 shadow-sm"
              title="Lactancia Activa"
            >
              <Baby size={9} strokeWidth={3} />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-content text-body leading-tight truncate group-hover:text-brand-text transition-colors">
            {emp.name}
          </h3>
          <p className="text-micro font-bold text-content-2 uppercase tracking-widest truncate mt-0.5">
            {emp.role || "Empleado"}
          </p>
        </div>
      </button>

      <div className="mb-2.5">{getStatusBadge(status, isLate, lateText)}</div>

      <div className="flex items-center gap-1.5 text-caption font-semibold text-content-3 mb-2 px-0.5">
        <MapPin size={11} className="shrink-0" />
        <span className="truncate">{shiftName}</span>
      </div>

      {scheduleDetails?.start && (
        <div className="bg-surface-card-hover/50 rounded-lg p-2 border border-black/[0.04] space-y-1 mb-2">
          <div className="flex items-center gap-1.5 text-micro font-semibold text-content-2">
            <Clock size={11} className="text-brand-text shrink-0" />
            <span className="truncate">
              {formatTime12h(scheduleDetails.start)} - {formatTime12h(scheduleDetails.end)}
            </span>
          </div>
          {scheduleDetails.lunch && (
            <div className="flex items-center gap-1.5 text-micro font-semibold text-content-3">
              <Utensils size={11} className="text-chart-4-text shrink-0" />
              <span className="truncate">{formatTime12h(scheduleDetails.lunch)} Almuerzo</span>
            </div>
          )}
          {scheduleDetails.lactation && (
            <div className="flex items-center gap-1.5 text-micro font-semibold text-content-3">
              <Baby size={11} className="text-chart-6-text shrink-0" />
              <span className="truncate">{formatTime12h(scheduleDetails.lactation)} Lactancia</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-caption pt-2 border-t border-black/[0.04]">
        <span className="text-content-3 font-bold uppercase tracking-wider flex items-center gap-1">
          <Timer size={11} /> Último
        </span>
        <span
          className={[
            "font-black text-body-sm",
            isLate && status !== "FINISHED" ? "text-danger" : "text-content",
          ].join(" ")}
        >
          {lastActionTime || "--:--"}
        </span>
      </div>

      {punches?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-black/[0.04] flex flex-wrap gap-1.5">
          {punches.slice(-3).reverse().map((p, idx) => {
            const Icon = punchIcon(p.type);
            const t = new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const isLatest = idx === 0;
            return (
              <div
                key={`${p.timestamp}-${idx}`}
                className={[
                  "flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-micro font-bold uppercase tracking-wider",
                  isLatest
                    ? "bg-surface-card border-chart-1/30 text-chart-1-text shadow-sm"
                    : "bg-surface-card border-black/5 text-content-3",
                ].join(" ")}
              >
                <Icon size={9} strokeWidth={2.5} />
                {t}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // Header Estándar "Floating Header Search" (mismo patrón que StaffManagementView/
  // RequestsView: un solo pill que alterna entre [buscador expandido + cierre]
  // y [controles inactivos]) — el filtro de sucursal vive acá (pedido explícito
  // del usuario, reemplaza al reloj) en vez de un botón chip a medida.
  const filtersContent = (
    <div
      {...searchContainerRef}
      className="flex items-center bg-surface-card backdrop-blur-2xl backdrop-saturate-[200%] border border-border-card shadow-[var(--shadow-glass-sm)] hover:shadow-[var(--shadow-glass-md)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden"
    >
      {/* Buscador activo */}
      <div
        className={[
          "flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left",
          searchOpen ? "max-w-[800px] opacity-100 px-4 md:px-5 gap-3" : "max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0",
        ].join(" ")}
      >
        <Search size={18} className="text-brand-text shrink-0" strokeWidth={2.5} />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Buscar por nombre o código..."
          className="flex-1 bg-transparent border-none outline-none text-body-xl font-bold text-content-2 w-[180px] sm:w-[280px] md:w-[380px] placeholder:text-content-3 focus:ring-0"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="p-1 text-content-3 hover:text-danger transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-[0.97] transform-gpu shrink-0"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setSearchOpen(false)}
          className="w-11 h-11 rounded-full bg-surface-card hover:bg-surface-card-hover text-content-3 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-brand-text hover:-translate-y-0.5 ml-2 border border-white"
        >
          <ChevronRight size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* Controles inactivos: filtro de sucursal + botón de buscar */}
      <div
        className={[
          "flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right",
          searchOpen ? "max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0" : "max-w-[520px] opacity-100 pl-2 pr-2 gap-3",
        ].join(" ")}
      >
        {getScope('monitor') !== 'BRANCH' && (
          <div className="hidden md:block md:w-[190px] shrink-0">
            <LiquidSelect
              value={filterBranch}
              onChange={setFilterBranch}
              options={branchOptions}
              placeholder="Todas"
              icon={Building2}
              compact
              bare
              clearable={false}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="relative w-11 h-11 bg-brand text-white rounded-full flex items-center justify-center shrink-0 shadow-[var(--shadow-glow-brand)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[var(--shadow-glow-brand)] hover:-translate-y-0.5 active:scale-[0.97] transform-gpu"
          title="Buscar empleado"
        >
          <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
          {searchTerm && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-danger border-2 border-surface-card rounded-full" />}
        </button>
      </div>
    </div>
  );

  return (
    <GlassViewLayout icon={Clock} title="Monitor en Tiempo Real" liveIndicator filtersContent={filtersContent} transparentBody>
      <div className="p-4 md:p-6 lg:p-8 space-y-5">

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
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
                card.bg, card.border,
                isActive
                  ? "shadow-[var(--shadow-glow-brand)] ring-2 ring-brand scale-[1.02] -translate-y-0.5"
                  : "hover:shadow-lg hover:scale-[1.02] hover:-translate-y-1",
              ].join(" ")}
            >
              {Icon && (
                <div
                  className={[
                    "absolute -right-3 -top-3 opacity-10 transition-transform group-hover:scale-110 group-hover:rotate-12",
                    card.id === "LATE" ? "text-danger" : "",
                  ].join(" ")}
                >
                  <Icon size={70} />
                </div>
              )}

              <p className="text-caption font-black text-content-2 uppercase tracking-widest mb-1 relative z-10">
                {card.label}
              </p>
              <p
                className={[
                  "text-display font-black relative z-10 leading-none",
                  isActive ? "text-brand-text" : card.color,
                ].join(" ")}
              >
                {card.count}
              </p>

              {isActive && (
                <div className="absolute bottom-3 right-3 animate-in zoom-in duration-300">
                  <div className="w-2.5 h-2.5 rounded-full bg-brand shadow-[var(--shadow-glow-brand)]" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* TABLERO POR ESTADO */}
      {employeeDataList.length === 0 ? (
        <div className="rounded-[2rem] p-20 text-center border border-border-card bg-surface-card backdrop-blur-2xl shadow-[var(--shadow-elevation-sm)] flex flex-col items-center gap-4 mt-8">
          <div className="w-20 h-20 bg-surface-card-hover rounded-full flex items-center justify-center animate-pulse">
            <Users size={32} className="text-content-3" />
          </div>
          <div>
            <p className="text-body-lg font-black uppercase tracking-widest text-content-2">
              No hay empleados en esta categoría
            </p>
            <p className="text-body-sm text-content-3 mt-1 font-medium">
              Intenta cambiar el filtro o seleccionar otra tarjeta.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-5">
          {KANBAN_COLUMNS.map((col) => {
            const rows = employeeDataList.filter((row) => col.match(row.status));
            const groups = groupRowsByBranch(rows);

            return (
              <div key={col.id} className={`rounded-[2rem] border backdrop-blur-xl p-4 md:p-5 flex flex-col gap-4 ${col.tint}`}>
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <h3 className="text-label font-black uppercase tracking-widest text-content-2">{col.label}</h3>
                  </div>
                  <span className="text-label font-bold text-content-3">{rows.length}</span>
                </div>

                {rows.length === 0 ? (
                  <p className="text-label text-content-3 italic px-1 pb-2">Sin empleados</p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {groups.map((group) => {
                      const sectionKey = `${col.id}:${group.branchId ?? "flat"}`;
                      const isCollapsed = group.branchName && collapsedSections.has(sectionKey);
                      const visible = visibleCounts[sectionKey] ?? PAGE_SIZE;
                      const shownRows = group.rows.slice(0, visible);
                      const remaining = group.rows.length - shownRows.length;

                      return (
                        <div key={sectionKey} className="flex flex-col gap-3">
                          {group.branchName && (
                            <button
                              type="button"
                              onClick={() => toggleSectionCollapsed(sectionKey)}
                              className="w-full flex items-center justify-between px-1 py-1 -my-1 rounded-lg hover:bg-black/[0.03] transition-colors"
                            >
                              <span className="text-caption font-black uppercase tracking-wider text-content-3 flex items-center gap-1.5">
                                <ChevronDown size={12} className={`transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`} />
                                {group.branchName}
                              </span>
                              <span className="text-caption font-bold text-content-3">{group.rows.length}</span>
                            </button>
                          )}
                          {!isCollapsed && (
                            <>
                              <div className="flex flex-col gap-3">
                                {shownRows.map((row) => renderEmployeeCard(row))}
                              </div>
                              {remaining > 0 && (
                                <button
                                  type="button"
                                  onClick={() => showMoreInSection(sectionKey)}
                                  className="text-caption font-black uppercase tracking-widest text-brand-text hover:text-brand-hover text-center py-2 rounded-xl hover:bg-brand/5 transition-colors"
                                >
                                  Ver más ({remaining} restantes)
                                </button>
                              )}
                            </>
                          )}
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
    </GlassViewLayout>
  );
};

export default AttendanceMonitorView;
