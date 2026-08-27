// src/views/AttendanceMonitorView.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Badge from '../components/common/Badge';
import AvatarConEstado from '../components/common/AvatarConEstado';
import Button from '../components/common/Button';
import { EmptyState } from '../components/common/StateViews';
import ViewTabBar from '../components/common/ViewTabBar';
import {
  Clock,
  CheckCircle2,
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
import { shortEmployeeName, employeeInitials } from "../utils/nameUtils";
import { tokenMatch } from '../utils/searchUtils';
import GlassViewLayout from "../components/GlassViewLayout";
import LiquidSelect from "../components/common/LiquidSelect";
import FilterBar from "../components/common/FilterBar";
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
    label: "En pausa",
    match: (status) => status === "LUNCH" || status === "LACTATION" || status === "BUSINESS_OUT",
    tint: "bg-chart-4/10 border-chart-4/30",
    dot: "bg-chart-4",
  },
  {
    id: "pending",
    label: "Sin marcar",
    match: (status) => status === "PENDING",
    tint: "bg-surface-card-hover border-divider",
    dot: "bg-content-3",
  },
  {
    id: "finished",
    label: "Finalizado / libre",
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
    getScope('monitor') !== 'ALL' ? String(user?.branchId || "ALL") : "ALL"
  );
  const [searchTerm, setSearchTerm] = useState("");

  // Filtros visuales
  const [statusTab, setStatusTab] = useState("ALL");

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
    { value: "ALL", label: "Todas las sucursales" },
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
    { id: "WORKING", label: "En turno", count: stats.working, color: "text-success-text", border: "border-success/30", bg: "bg-success/10" },
    { id: "EXTRA", label: "Horas extra", count: stats.extra, color: "text-chart-3-text", border: "border-chart-3/30", bg: "bg-chart-3/10" },
    { id: "PAUSE", label: "En pausa", count: stats.pause, color: "text-chart-4-text", border: "border-chart-4/30", bg: "bg-chart-4/10" },
    { id: "LATE", label: "Con atraso", count: stats.late, color: "text-danger-text", border: "border-danger/30", bg: "bg-danger/10", icon: AlertTriangle },
    { id: "PENDING", label: "Pendientes", count: stats.pending, color: "text-content-2", border: "border-divider", bg: "bg-surface-card-hover/40" },
  ];

  const getStatusBadge = (status, isLate, lateText) => {
    if (isLate && status !== "FINISHED") {
      return (
        <Badge variant="danger" icon={AlertTriangle}>{lateText}</Badge>
      );
    }
    switch (status) {
      case "WORKING":
        return (
          <Badge variant="success" icon={CheckCircle2}>En turno</Badge>
        );
      case "EXTRA_WORKING":
        return (
          <Badge variant="chart-3" icon={PlusCircle}>Turno Extra</Badge>
        );
      case "LUNCH":
        return (
          <Badge variant="chart-4" icon={Utensils}>Almorzando</Badge>
        );
      case "LACTATION":
        return (
          <Badge variant="chart-6" icon={Baby}>Lactancia</Badge>
        );
      case "FINISHED":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-card-hover text-content-2 rounded-xl text-caption font-bold uppercase tracking-widest border border-divider">
            <LogOut size={14} /> Finalizado
          </div>
        );
      case "EARLY_EXIT":
        return (
          <Badge variant="info" icon={DoorOpen}>Permiso / Retiro</Badge>
        );
      case "BUSINESS_OUT":
        return (
          <Badge variant="warning" icon={MapPin}>Gestión externa</Badge>
        );
      case "OFF_DAY":
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-card-hover text-content-3 rounded-xl text-caption font-bold uppercase tracking-widest border border-divider">
            <Clock size={14} /> Día Libre
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-card-hover text-content-2 rounded-xl text-caption font-bold uppercase tracking-widest border border-divider">
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
      data-surface="card" className="p-4 transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] overflow-hidden transform-gpu"
    >
      <button
        type="button"
        onClick={() => goToProfile(emp)}
        className="flex items-center gap-3 text-left group w-full mb-3 transition-transform duration-[var(--dur-fast)] active:scale-[0.99]"
      >
        <div className="relative shrink-0">
          <div
            className={[
              "h-11 w-11 rounded-xl border-2 overflow-hidden flex items-center justify-center font-black text-sm shadow-sm transition-transform group-hover:scale-105",
              isLate && status !== "FINISHED"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-border-card bg-surface-card text-content-3",
            ].join(" ")}
          >
            {emp.photo ? (
              <AvatarConEstado emp={emp} px={40} radio="rounded-full" marco="" />
            ) : (
              employeeInitials(emp)
            )}
          </div>
          {emp.hasLactation && (
            <div
              className="absolute -bottom-1 -right-1 bg-pink-100 p-1 rounded-full border border-pink-200 text-pink-600 shadow-sm"
              role="img" title="Lactancia Activa"
            >
              <Baby size={9} strokeWidth={3} />
            </div>
          )}
        </div>
        <div className="min-w-0">
          {/* Nombre CORTO, no el completo truncado.
              Medido el 2026-08-09: 63 tarjetas de este tablero recortaban el
              nombre a 111px cuando pedía hasta 297 —«DOLORES CONCEPCION TEJADA
              HERNANDEZ» quedaba en «DOLORES CONCEPCION TE…»—. Una columna de
              kanban es angosta por diseño y no va a crecer.
              Truncar en una celda de tabla está bien: la fila tiene un ancho y
              el dato no. Pero acá el nombre ES la identidad de la tarjeta, y una
              tarjeta que no dice de quién es no sirve para nada.
              `shortEmployeeName` es el canónico del portal —primer nombre +
              primer apellido— y ya lo usan los avatares y los listados. El
              `truncate` se queda como red por si un nombre corto igual no entra;
              el completo sigue en el detalle, a un toque.

              Y `line-clamp-2` en vez de `truncate`: con el nombre corto los que
              quedaban se pasaban por **2 a 8px** —«DOLORES TEJADA» pedía 118 en
              una caja de 111— y cortar un apellido por ocho píxeles es lo peor
              de los dos mundos. Envolviendo, la caja crece un renglón sólo
              cuando hace falta y el nombre nunca queda a medias. */}
          <h3 title={emp.name}
            className="font-bold text-content text-body leading-tight line-clamp-2 break-words group-hover:text-brand-text transition-colors">
            {shortEmployeeName(emp)}
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
        <div className="bg-surface-card-hover/50 rounded-lg p-2 border border-divider space-y-1 mb-2">
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

      <div className="flex items-center justify-between text-caption pt-2 border-t border-divider">
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
        <div className="mt-2 pt-2 border-t border-divider flex flex-wrap gap-1.5">
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
                    : "bg-surface-card border-divider text-content-3",
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

  // D3.9 (2026-07-27): barra reescrita a mano → canónico.
  //
  // §17 (v2.99.1): el filtro de sucursal bajó al CUERPO. Vivía en el header
  // por un pedido de cuando ahí estaba el contenedor —"que reemplace al
  // reloj"—, antes de que existiera `FilterBar`; la regla posterior separa las
  // dos píldoras y ésta recorta datos, no navega. Encima era `hidden md:block`:
  // en un teléfono el filtro de sucursal simplemente no existía.
  const filtersContent = (
    <ViewTabBar
      searchValue={searchTerm}
      onSearchChange={setSearchTerm}
      placeholder="Buscar por nombre o código..."
    />
  );

  const filtrosCuerpo = getScope('monitor') === 'ALL' && (
    <FilterBar
      onClear={() => setFilterBranch('ALL')}
      activeCount={filterBranch !== 'ALL' ? 1 : 0}
    >
      {/* El valor "sin filtrar" acá es la cadena 'ALL', no '' */}
      <FilterBar.Section active={filterBranch !== 'ALL'} onClear={() => setFilterBranch('ALL')} label="sucursal">
        <FilterBar.Sucursal value={filterBranch}
          onChange={val => setFilterBranch(val || 'ALL')} options={branchOptions} />
      </FilterBar.Section>
    </FilterBar>
  );

  return (
    <GlassViewLayout icon={Clock} title="Monitor en tiempo real" liveIndicator filtersContent={filtersContent} transparentBody>
      <div className="p-4 md:p-6 lg:p-8 space-y-5">

      {filtrosCuerpo && <div className="flex justify-end">{filtrosCuerpo}</div>}

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        {statCards.map((card) => {
          const isActive = statusTab === card.id;
          const Icon = card.icon;

          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setStatusTab(card.id)}
              className={[
                "text-left p-5 rounded-modal border transition-all duration-[var(--dur-slow)] group relative overflow-hidden",
                // El acuse del toque: las seis tarjetas son el filtro de estado
                // de la vista y en el teléfono se tocan, donde `hover:` no
                // existe. `0.99` porque son tarjetas grandes — y va afuera del
                // ternario para que también acuse la que ya está activa.
                "active:scale-[0.99]",
                card.bg, card.border,
                isActive
                  ? "shadow-[var(--shadow-glow-brand)] ring-2 ring-brand/45 scale-[1.02] -translate-y-0.5"
                  : "hover:shadow-lg hover:scale-[1.02] hover:translate-y-[var(--lift-card)]",
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

              <p className="text-caption font-black text-content-2 uppercase tracking-widest mb-1 relative z-base">
                {card.label}
              </p>
              <p
                className={[
                  "text-display font-black relative z-base leading-none",
                  isActive ? "text-brand-text" : card.color,
                ].join(" ")}
              >
                {card.count}
              </p>

              {isActive && (
                <div className="absolute bottom-3 right-3 animate-in zoom-in duration-[var(--dur-slow)]">
                  <div className="w-2.5 h-2.5 rounded-full bg-brand shadow-[var(--shadow-glow-brand)]" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* TABLERO POR ESTADO */}
      {employeeDataList.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sin empleados en esta categoría"
          subtitle="Intenta cambiar el filtro o seleccionar otra tarjeta."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-5">
          {KANBAN_COLUMNS.map((col) => {
            const rows = employeeDataList.filter((row) => col.match(row.status));
            const groups = groupRowsByBranch(rows);

            return (
              <div key={col.id} className={`rounded-modal border p-4 md:p-5 flex flex-col gap-4 ${col.tint}`}>
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
                            <Button
                                size="sm"
                                variant="ghost"
                                className="w-full"
                                icon={ChevronDown}
                                type="button"
                                onClick={() => toggleSectionCollapsed(sectionKey)}
                            >
                                <span className="text-caption font-black uppercase tracking-wider text-content-3 flex items-center gap-1.5">
                                
                                {group.branchName}
                              </span>
                              <span className="text-caption font-bold text-content-3">{group.rows.length}</span>
                            </Button>
                          )}
                          {!isCollapsed && (
                            <>
                              <div className="flex flex-col gap-3">
                                {shownRows.map((row) => renderEmployeeCard(row))}
                              </div>
                              {remaining > 0 && (
                                <Button  onClick={() => showMoreInSection(sectionKey)}>Ver más ({remaining} restantes)</Button>
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
