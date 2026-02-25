import React, { createContext, useContext, useMemo, useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { INITIAL_ROLES, INITIAL_SHIFTS } from "../data/constants";

const StaffContext = createContext(null);

export const useStaff = () => {
  const context = useContext(StaffContext);
  if (!context) throw new Error("useStaff debe usarse dentro de un StaffProvider");
  return context;
};

const makeId = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));

// -------------------------
// Cache keys
// -------------------------
const CACHE_BRANCHES_KEY = "sb_cache_branches_v1";
const CACHE_EMPLOYEES_KEY = "sb_cache_employees_v1";
const CACHE_AT = "sb_cache_staff_at_v1"; // timestamp ISO

const safeJsonParse = (s, fallback = null) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

// -------------------------
// Normalizers
// -------------------------
const normalizeWeeklyHours = (weeklyHours) => {
  const src = weeklyHours || {};
  const out = {};
  [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
    const v = src?.[d] || {};
    const start = typeof v.start === "string" ? v.start : "";
    const end = typeof v.end === "string" ? v.end : "";
    const isOpen = typeof v.isOpen === "boolean" ? v.isOpen : true;
    out[d] = { isOpen, start: isOpen ? start : "", end: isOpen ? end : "" };
  });
  return out;
};

const normalizeBranchPayloadFromModal = (data = {}) => {
  const out = { ...(data || {}) };

  if (!out.id && out.branchId) out.id = out.branchId;
  delete out.branchId;

  if (typeof out.branchName === "string") {
    out.name = out.branchName;
    delete out.branchName;
  }

  if (out.branchSchedule) {
    out.weeklyHours = normalizeWeeklyHours(out.branchSchedule);
    delete out.branchSchedule;
  } else if (out.weeklyHours) {
    out.weeklyHours = normalizeWeeklyHours(out.weeklyHours);
  }

  if (out.phoneFixed && !out.phone) out.phone = out.phoneFixed;
  delete out.phoneFixed;

  ["name", "address", "phone", "cell", "openingDate"].forEach((k) => {
    if (out[k] === "") out[k] = null;
  });

  return out;
};

// -------------------------
// Provider
// -------------------------
export const StaffProvider = ({ children }) => {
  const [branches, setBranches] = useState(() => safeJsonParse(localStorage.getItem(CACHE_BRANCHES_KEY), []) || []);
  const [employees, setEmployees] = useState(() => safeJsonParse(localStorage.getItem(CACHE_EMPLOYEES_KEY), []) || []);

  const [shifts, setShifts] = useState(INITIAL_SHIFTS);
  const [roles, setRoles] = useState(INITIAL_ROLES);
  const [announcements, setAnnouncements] = useState([]);
  const [auditLog, setAuditLog] = useState([]);

  // ✅ flags para rendimiento
  const didFetchRef = useRef(false);
  const [isBootSyncing, setIsBootSyncing] = useState(false);
  const [attendanceLoaded, setAttendanceLoaded] = useState(false);

  // -------------------------
  // Boot sync (FAST)
  // - No trae attendance aquí
  // - Evita doble fetch (StrictMode)
  // -------------------------
  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;

    const fetchBoot = async () => {
      setIsBootSyncing(true);
      console.log("📡 Boot Sync (rápido) con Supabase...");

      try {
        // A) branches
        const { data: branchData, error: branchError } = await supabase
          .from("branches")
          .select("*")
          .order("id", { ascending: true });

        if (branchError) {
          console.error("Error Sucursales:", branchError);
        } else if (branchData) {
          const mappedBranches = branchData.map((b) => ({
            ...b,
            weeklyHours: b.weekly_hours,
          }));
          setBranches(mappedBranches);
          localStorage.setItem(CACHE_BRANCHES_KEY, JSON.stringify(mappedBranches));
        }

        // B) employees (SIN attendance)
        const { data: empData, error: empError } = await supabase.from("employees").select("*");

        if (empError) {
          console.error("Error Empleados:", empError);
        } else if (empData) {
          const mappedEmployees = empData.map((e) => ({
            ...e,
            branchId: e.branch_id,
            hireDate: e.hire_date,
            birthDate: e.birth_date,
            photo: e.photo_url,
            attendance: Array.isArray(e.attendance) ? e.attendance : [], // por si en cache ya viene
            history: [],
            documents: [],
          }));

          setEmployees(mappedEmployees);
          localStorage.setItem(CACHE_EMPLOYEES_KEY, JSON.stringify(mappedEmployees));
          console.log(`✅ Boot: ${mappedEmployees.length} empleados cargados.`);
        }

        localStorage.setItem(CACHE_AT, new Date().toISOString());
      } catch (e) {
        console.error("Boot sync error:", e);
      } finally {
        setIsBootSyncing(false);
      }
    };

    fetchBoot();
  }, []);

  // -------------------------
  // Lazy attendance loader
  // -------------------------
  const loadAttendanceLastDays = async (days = 15) => {
    try {
      if (attendanceLoaded) return true;

      const sinceISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      console.log(`📥 Cargando attendance últimos ${days} días...`);
      const { data: attData, error: attError } = await supabase
        .from("attendance")
        .select("*")
        .gte("timestamp", sinceISO);

      if (attError) {
        console.error("Error Attendance:", attError);
        return false;
      }

      const byEmp = new Map();
      (attData || []).forEach((a) => {
        const k = String(a.employee_id);
        if (!byEmp.has(k)) byEmp.set(k, []);
        byEmp.get(k).push(a);
      });

      // ordenar cada lista
      for (const [_k, arr] of byEmp.entries()) {
        arr.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      }

      setEmployees((prev) => {
        const next = prev.map((e) => ({
          ...e,
          attendance: byEmp.get(String(e.id)) || e.attendance || [],
        }));

        // opcional: cache también attendance (puede crecer; si te preocupa, quítalo)
        localStorage.setItem(CACHE_EMPLOYEES_KEY, JSON.stringify(next));
        return next;
      });

      setAttendanceLoaded(true);
      console.log("✅ Attendance cargada.");
      return true;
    } catch (e) {
      console.error("loadAttendanceLastDays error:", e);
      return false;
    }
  };

  const appendAuditLog = (_action, _payload = {}, _meta = {}) => {
    // por ahora vacío
  };

  // -------------------------
  // Storage upload
  // -------------------------
  const uploadPhotoToStorage = async (file, folder = "avatars") => {
    if (!file) return null;

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${folder}/${fileName}`;

      const { error: uploadError } = await supabase.storage.from("photos").upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("photos").getPublicUrl(filePath);
      return data.publicUrl;
    } catch (error) {
      console.error("Error subiendo foto:", error.message);
      return null;
    }
  };

  // -------------------------
  // CRUD Branches
  // -------------------------
  const addBranch = async (data) => {
    try {
      const payload = normalizeBranchPayloadFromModal(data);

      const dbPayload = {
        name: payload.name,
        address: payload.address,
        phone: payload.phone,
        cell: payload.cell,
        weekly_hours: payload.weeklyHours,
      };

      const { data: newBranch, error } = await supabase.from("branches").insert([dbPayload]).select().single();
      if (error) throw error;

      const appBranch = { ...newBranch, weeklyHours: newBranch.weekly_hours };
      setBranches((prev) => {
        const next = [...prev, appBranch];
        localStorage.setItem(CACHE_BRANCHES_KEY, JSON.stringify(next));
        return next;
      });

      return appBranch.id;
    } catch (err) {
      alert("Error al guardar sucursal: " + err.message);
      return null;
    }
  };

  const updateBranch = async (id, data) => {
    try {
      const payload = normalizeBranchPayloadFromModal(data);

      const dbPayload = {
        name: payload.name,
        address: payload.address,
        phone: payload.phone,
        cell: payload.cell,
        weekly_hours: payload.weeklyHours,
      };

      const { data: updated, error } = await supabase
        .from("branches")
        .update(dbPayload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      const appBranch = { ...updated, weeklyHours: updated.weekly_hours };

      setBranches((prev) => {
        const next = prev.map((b) => (String(b.id) === String(id) ? appBranch : b));
        localStorage.setItem(CACHE_BRANCHES_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      alert("Error al actualizar: " + err.message);
    }
  };

  const deleteBranch = async (id) => {
    if (employees.some((e) => String(e.branchId) === String(id))) {
      alert("No se puede borrar: Hay empleados asignados.");
      return false;
    }

    try {
      const { error } = await supabase.from("branches").delete().eq("id", id);
      if (error) throw error;

      setBranches((prev) => {
        const next = prev.filter((b) => String(b.id) !== String(id));
        localStorage.setItem(CACHE_BRANCHES_KEY, JSON.stringify(next));
        return next;
      });

      return true;
    } catch (err) {
      alert("Error al borrar: " + err.message);
      return false;
    }
  };

  // -------------------------
  // CRUD Employees
  // -------------------------
  const addEmployee = async (formData) => {
    try {
      let publicPhotoUrl = null;

      if (formData.photo && typeof formData.photo !== "string") {
        publicPhotoUrl = await uploadPhotoToStorage(formData.photo);
      } else if (typeof formData.photo === "string") {
        publicPhotoUrl = formData.photo;
      }

      const dbPayload = {
        name: formData.name,
        code: formData.code,
        role: formData.role,
        branch_id: formData.branchId ? parseInt(formData.branchId, 10) : null,
        phone: formData.phone,
        dui: formData.dui,
        address: formData.address || null,
        is_admin: formData.isAdmin || false,
        birth_date: formData.birthDate || null,
        hire_date: formData.hireDate || null,
        photo_url: publicPhotoUrl || null,
      };

      const { data: newEmp, error } = await supabase.from("employees").insert([dbPayload]).select().single();
      if (error) throw error;

      const appEmp = {
        ...newEmp,
        branchId: newEmp.branch_id,
        hireDate: newEmp.hire_date,
        birthDate: newEmp.birth_date,
        photo: newEmp.photo_url,
        attendance: [],
        history: [],
        documents: [],
      };

      setEmployees((prev) => {
        const next = [...prev, appEmp];
        localStorage.setItem(CACHE_EMPLOYEES_KEY, JSON.stringify(next));
        return next;
      });

      return appEmp.id;
    } catch (err) {
      alert("Error creando empleado: " + err.message);
      return null;
    }
  };

  const updateEmployee = async (id, updatedData) => {
    try {
      const dbPayload = {};

      if (updatedData.name) dbPayload.name = updatedData.name;
      if (updatedData.code) dbPayload.code = updatedData.code;
      if (updatedData.role) dbPayload.role = updatedData.role;
      if (updatedData.branchId) dbPayload.branch_id = parseInt(updatedData.branchId, 10);
      if (updatedData.phone) dbPayload.phone = updatedData.phone;
      if (updatedData.dui) dbPayload.dui = updatedData.dui;
      if (updatedData.address) dbPayload.address = updatedData.address;
      if (updatedData.isAdmin !== undefined) dbPayload.is_admin = updatedData.isAdmin;
      if (updatedData.hireDate) dbPayload.hire_date = updatedData.hireDate;
      if (updatedData.birthDate) dbPayload.birth_date = updatedData.birthDate;

      if (updatedData.photo && typeof updatedData.photo !== "string") {
        const newUrl = await uploadPhotoToStorage(updatedData.photo);
        if (newUrl) dbPayload.photo_url = newUrl;
      }

      if (Object.keys(dbPayload).length === 0) return;

      const { data: updated, error } = await supabase.from("employees").update(dbPayload).eq("id", id).select();
      if (error) throw error;

      if (!updated || updated.length === 0) return;
      const updatedRow = updated[0];

      setEmployees((prev) => {
        const next = prev.map((emp) => {
          if (String(emp.id) !== String(id)) return emp;
          return {
            ...emp,
            ...updatedRow,
            branchId: updatedRow.branch_id,
            hireDate: updatedRow.hire_date,
            birthDate: updatedRow.birth_date,
            photo: updatedRow.photo_url,
          };
        });

        localStorage.setItem(CACHE_EMPLOYEES_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.error("❌ Error actualizando:", err);
      alert("Error al guardar cambios: " + err.message);
    }
  };

  const deleteEmployee = async (id) => {
    try {
      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw error;

      setEmployees((prev) => {
        const next = prev.filter((emp) => String(emp.id) !== String(id));
        localStorage.setItem(CACHE_EMPLOYEES_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      alert("Error borrando empleado: " + err.message);
    }
  };

  // -------------------------
  // Attendance (optimista)
  // -------------------------
  const registerAttendance = async (employeeId, type, metadata = null) => {
    const timestamp = new Date().toISOString();

    // Optimistic UI update
    setEmployees((prev) => {
      const next = prev.map((emp) => {
        if (String(emp.id) !== String(employeeId)) return emp;
        const newPunch = { timestamp, type, ...(metadata ? { details: metadata } : {}) };
        return { ...emp, attendance: [...(emp.attendance || []), newPunch] };
      });
      localStorage.setItem(CACHE_EMPLOYEES_KEY, JSON.stringify(next));
      return next;
    });

    // Persist
    try {
      await supabase.from("attendance").insert([
        {
          employee_id: employeeId,
          timestamp,
          type,
          details: metadata || {},
        },
      ]);
    } catch (err) {
      console.error("Error guardando marcaje en BD:", err);
    }

    return timestamp;
  };

  // Placeholders
  const addBranchDocument = () => makeId();
  const registerBranchEvent = () => makeId();
  const registerEmployeeEvent = () => makeId();
  const addDocumentToEvent = () => makeId();
  const markAnnouncementAsRead = () => {};

  const getAllAttendance = () =>
    (employees || []).flatMap((emp) =>
      (emp.attendance || []).map((att) => ({
        ...att,
        employeeId: emp.id,
        id: `${emp.id}-${att.timestamp}`,
      }))
    );

  const value = useMemo(
    () => ({
      employees,
      branches,
      shifts,
      roles,
      announcements,
      setAnnouncements,

      auditLog,
      appendAuditLog,

      // flags
      isBootSyncing,
      attendanceLoaded,

      // CRUD
      addEmployee,
      updateEmployee,
      deleteEmployee,

      addBranch,
      updateBranch,
      deleteBranch,

      // attendance
      registerAttendance,
      loadAttendanceLastDays,

      // placeholders
      addBranchDocument,
      registerBranchEvent,
      registerEmployeeEvent,
      addDocumentToEvent,

      addShift: (s) => setShifts((prev) => [...prev, { ...s, id: makeId() }]),
      markAnnouncementAsRead,
      getAllAttendance,

      // debug
      setEmployees,
      setBranches,
      setRoles,
      setShifts,
      setAuditLog,
    }),
    [employees, branches, shifts, roles, announcements, auditLog, isBootSyncing, attendanceLoaded]
  );

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
};