import React from 'react';
import {
  X, Shield, User, MapPin, Briefcase,
  Calendar, Paperclip, Upload,
  CheckCircle, CreditCard, Camera, Building2, Phone, Smartphone, Clock
} from 'lucide-react';
import TimePicker12 from './TimePicker12';
import { EVENT_TYPES, WEEK_DAYS } from '../../data/constants';
import { formatDuiMask } from '../../utils/helpers';
import { useStaff } from '../../context/StaffContext';
import ModalShell from "./ModalShell";

// -------------------------
// Helpers UI
// -------------------------
const clampInt = (v, min, max) => {
  const n = parseInt(String(v ?? ''), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
};

const isValidISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ✅ Switch compacto reusable
const Switch = ({ on, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className={[
      "relative inline-flex items-center flex-shrink-0",
      "w-11 h-6 rounded-full border",
      "transition-colors duration-200",
      on ? "bg-[#007AFF] border-[#007AFF]/40" : "bg-black/10 border-black/10",
    ].join(" ")}
    aria-pressed={on}
  >
    <span
      className={[
        "absolute top-0.5 left-0.5",
        "w-5 h-5 rounded-full bg-white shadow-sm",
        "transition-transform duration-200",
        on ? "translate-x-5" : "translate-x-0",
      ].join(" ")}
    />
  </button>
);

// -------------------------
// SUB-FORMS
// -------------------------

const FormNovedad = ({ formData, setFormData, branches, activeEmployee }) => {
  const requiresTarget = ['TRANSFER', 'SUPPORT'].includes(formData.type);
  const requiresNewRole = formData.type === 'PROMOTION';
  const isTemporal = ['VACATION', 'DISABILITY', 'SUPPORT', 'PERMISSION'].includes(formData.type);

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
      <div>
        <label className="text-[10px] font-black uppercase text-slate-400">Tipo de Acción</label>
        <select
          className="w-full border-2 border-slate-100 p-2.5 rounded-xl text-sm font-bold bg-slate-50 outline-none focus:border-blue-500 transition-all"
          value={formData.type || ''}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
        >
          <option value="">-- Seleccionar Acción --</option>
          {Object.keys(EVENT_TYPES).map(key => (
            <option key={key} value={key}>{EVENT_TYPES[key].label}</option>
          ))}
        </select>
      </div>

      {requiresTarget && (
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
          <label className="text-[10px] font-black uppercase text-blue-400">Sucursal Destino</label>
          <select
            className="w-full border-none bg-transparent text-sm font-bold outline-none"
            value={formData.targetBranchId || ''}
            onChange={(e) => setFormData({ ...formData, targetBranchId: e.target.value })}
          >
            <option value="">Seleccionar Farmacia</option>
            {branches.filter(b => b.id !== activeEmployee?.branchId).map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {requiresNewRole && (
        <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
          <label className="text-[10px] font-black uppercase text-purple-400">Nuevo Cargo / Puesto</label>
          <input
            type="text"
            placeholder="Escriba el nuevo cargo"
            className="w-full border-none bg-transparent text-sm font-bold outline-none mt-1"
            value={formData.newRole || ''}
            onChange={(e) => setFormData({ ...formData, newRole: e.target.value })}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400">{isTemporal ? 'Desde' : 'Fecha'}</label>
          <input
            type="date"
            className="w-full border p-2 rounded-lg text-sm"
            value={formData.date || ''}
            onChange={e => setFormData({ ...formData, date: e.target.value })}
          />
        </div>
        {isTemporal && (
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400">Hasta</label>
            <input
              type="date"
              className="w-full border p-2 rounded-lg text-sm"
              value={formData.endDate || ''}
              onChange={e => setFormData({ ...formData, endDate: e.target.value })}
            />
          </div>
        )}
      </div>

      <div>
        <label className="text-[10px] font-black uppercase text-slate-400">Observaciones</label>
        <textarea
          rows="2"
          className="w-full border p-3 rounded-xl text-sm outline-none focus:border-blue-500"
          placeholder="Detalles de la acción..."
          value={formData.note || ''}
          onChange={e => setFormData({ ...formData, note: e.target.value })}
        />
      </div>

      <div className="pt-4 border-t border-dashed">
        <div className="flex items-center gap-2 cursor-pointer group relative">
          <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-blue-100 transition-colors">
            <Paperclip size={16} className="text-slate-500 group-hover:text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-700">Adjuntar Soporte Digital</p>
            {formData.file ? (
              <p className="text-[10px] text-blue-600 font-bold">✅ {formData.file.name}</p>
            ) : (
              <p className="text-[10px] text-slate-400">PDF o Imágenes (Opcional)</p>
            )}
          </div>
          <input
            type="file"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] })}
          />
        </div>
      </div>
    </div>
  );
};

const FormUploadOnly = ({ formData, setFormData }) => (
  <div className="space-y-4 text-center py-6">
    <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 group hover:border-blue-400 transition-all">
      <input
        type="file"
        id="filePost"
        className="hidden"
        onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] })}
      />
      <label htmlFor="filePost" className="cursor-pointer block">
        {formData.file ? (
          <div className="text-blue-600 animate-bounce">
            <CheckCircle size={48} className="mx-auto mb-2" />
            <span className="font-bold text-sm">{formData.file.name}</span>
          </div>
        ) : (
          <div className="text-slate-400">
            <Upload size={48} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm font-bold text-slate-600">Haz clic para subir soporte</p>
            <p className="text-[10px] mt-1 italic">Vincular a acción seleccionada</p>
          </div>
        )}
      </label>
    </div>
  </div>
);

const FormSucursal = ({ formData, setFormData }) => {
  const schedule = formData.branchSchedule || {};

  // ✅ propiedad/alquiler
  const propertyType = formData.propertyType || 'OWNED';
  const isRented = propertyType === 'RENTED';

  // ✅ rent block (todo dentro de formData.rent)
  const rent = formData.rent || {};
  const rentContract = rent.contract || {};

  const safeDay = (dayId) => {
    const v = schedule?.[dayId] || {};
    return {
      isOpen: typeof v.isOpen === "boolean" ? v.isOpen : true,
      start: typeof v.start === "string" ? v.start : "",
      end: typeof v.end === "string" ? v.end : "",
    };
  };

  const setDay = (dayId, patch) => {
    const prev = safeDay(dayId);
    const next = { ...prev, ...patch };

    if (next.isOpen === false) {
      next.start = "";
      next.end = "";
    }

    setFormData({
      ...formData,
      branchSchedule: {
        ...schedule,
        [dayId]: next,
      },
    });
  };

  const defaultEndByDay = (dayId) => {
    if (dayId === 6) return "12:00"; // Sábado
    return "17:00"; // resto
  };

  return (
    <div className="space-y-4">
      {/* Datos (compacto) */}
      <div className="rounded-[1.5rem] border border-black/[0.06] bg-white/70 backdrop-blur-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-[#007AFF]/10 border border-[#007AFF]/15 flex items-center justify-center">
            <Building2 size={18} className="text-[#007AFF]" />
          </div>
          <p className="text-[12px] font-black text-slate-900 uppercase tracking-widest">
            Datos de sucursal
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nombre</label>
            <input
              className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-black/[0.03] border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)]"
              placeholder="Ej: Salud 3"
              value={formData.branchName || ""}
              onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
            />
          </div>

          <div className="lg:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <MapPin size={12} className="text-[#007AFF]" /> Dirección
            </label>
            <input
              className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-black/[0.03] border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)]"
              placeholder="Av. Principal #123"
              value={formData.address || ""}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <Phone size={12} className="text-[#007AFF]" /> Teléfono fijo
            </label>
            <input
              className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-black/[0.03] border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)]"
              placeholder="2222-0001"
              value={formData.phone || ""}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <Smartphone size={12} className="text-[#007AFF]" /> Celular
            </label>
            <input
              className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-black/[0.03] border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)]"
              placeholder="7000-0001"
              value={formData.cell || ""}
              onChange={(e) => setFormData({ ...formData, cell: e.target.value })}
            />
          </div>

          {/* ✅ fecha apertura */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <Calendar size={12} className="text-[#007AFF]" /> Fecha de apertura
            </label>
            <input
              type="date"
              className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-black/[0.03] border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)]"
              value={formData.openingDate || ""}
              onChange={(e) => setFormData({ ...formData, openingDate: e.target.value })}
            />
            <p className="mt-1 text-[10px] text-slate-400 font-semibold">
              Recomendado para historial y contratos.
            </p>
          </div>
        </div>

        {/* ✅ Propiedad / Alquiler */}
        <div className="mt-4 pt-4 border-t border-black/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Propiedad del local
              </p>
              <p className="text-[13px] font-semibold text-slate-900">
                {isRented ? "Alquilado" : "Propio"}
              </p>
            </div>

            <Switch
              on={isRented}
              onToggle={() => {
                const next = isRented ? "OWNED" : "RENTED";
                // si cambia a RENTED, inicializamos rent (sin romper)
                if (next === "RENTED") {
                  setFormData({
                    ...formData,
                    propertyType: "RENTED",
                    rent: {
                      ...(formData.rent || {}),
                      contract: { ...(formData?.rent?.contract || {}) },
                    },
                  });
                } else {
                  // OWNED: limpiamos rent (opcional)
                  setFormData({ ...formData, propertyType: "OWNED", rent: null });
                }
              }}
            />
          </div>

          {isRented && (
            <div className="mt-4 rounded-[1.25rem] bg-[#007AFF]/[0.04] border border-[#007AFF]/15 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-[#0A2A5E]">
                  Datos de alquiler
                </p>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#007AFF] bg-[#007AFF]/10 border border-[#007AFF]/15 px-2.5 py-1 rounded-full">
                  RENT
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Monto mensual
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-white/80 border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.12)]"
                    placeholder="Ej: 850"
                    value={rent.amount ?? ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        rent: { ...(formData.rent || {}), amount: e.target.value === "" ? null : Number(e.target.value) },
                      })
                    }
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Día de pago
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-white/80 border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.12)]"
                    placeholder="Ej: 5"
                    value={rent.dueDay ?? ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        rent: { ...(formData.rent || {}), dueDay: clampInt(e.target.value, 1, 31) },
                      })
                    }
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Pagado hasta
                  </label>
                  <input
                    type="date"
                    className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-white/80 border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.12)]"
                    value={rent.paidThrough ?? ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        rent: { ...(formData.rent || {}), paidThrough: isValidISODate(e.target.value) ? e.target.value : "" },
                      })
                    }
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Arrendador / Contacto
                  </label>
                  <input
                    className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-white/80 border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.12)]"
                    placeholder="Nombre del arrendador"
                    value={rent.landlordName ?? ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        rent: { ...(formData.rent || {}), landlordName: e.target.value },
                      })
                    }
                  />
                </div>
              </div>

              {/* Contrato */}
              <div className="mt-4 pt-4 border-t border-[#007AFF]/15">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                  Contrato de alquiler
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Inicio
                    </label>
                    <input
                      type="date"
                      className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-white/80 border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.12)]"
                      value={rentContract.startDate ?? ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          rent: {
                            ...(formData.rent || {}),
                            contract: { ...(rentContract || {}), startDate: e.target.value || null },
                          },
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Fin
                    </label>
                    <input
                      type="date"
                      className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-white/80 border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.12)]"
                      value={rentContract.endDate ?? ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          rent: {
                            ...(formData.rent || {}),
                            contract: { ...(rentContract || {}), endDate: e.target.value || null },
                          },
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Duración (meses)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="mt-2 w-full px-4 py-2.5 rounded-[1.1rem] bg-white/80 border border-black/[0.06] outline-none focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.12)]"
                      placeholder="Ej: 12"
                      value={rentContract.termMonths ?? ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          rent: {
                            ...(formData.rent || {}),
                            contract: {
                              ...(rentContract || {}),
                              termMonths: e.target.value === "" ? null : clampInt(e.target.value, 1, 240),
                            },
                          },
                        })
                      }
                    />
                  </div>
                </div>

                {/* Upload contrato */}
                <div className="mt-3">
                  <div className="flex items-center gap-2 cursor-pointer group relative rounded-[1.1rem] border border-black/[0.06] bg-white/70 px-4 py-3">
                    <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-blue-100 transition-colors">
                      <Paperclip size={16} className="text-slate-500 group-hover:text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-bold text-slate-700">
                        Adjuntar contrato (PDF)
                      </p>
                      {rentContract.documentFile ? (
                        <p className="text-[10px] text-blue-600 font-bold truncate">
                          ✅ {rentContract.documentFile.name}
                        </p>
                      ) : (
                        <p className="text-[10px] text-slate-400">
                          Opcional (recomendado)
                        </p>
                      )}
                    </div>

                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setFormData({
                          ...formData,
                          rent: {
                            ...(formData.rent || {}),
                            contract: { ...(rentContract || {}), documentFile: file },
                          },
                        });
                      }}
                    />
                  </div>

                  <p className="mt-1 text-[10px] text-slate-400 font-semibold">
                    Luego lo conectamos a documentos de sucursal y guardamos el ID.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Horario (compacto) */}
      <div className="rounded-[1.5rem] border border-[#007AFF]/15 bg-[#007AFF]/[0.04] p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-[#007AFF]/10 border border-[#007AFF]/15 flex items-center justify-center">
            <Clock size={18} className="text-[#007AFF]" />
          </div>
          <p className="text-[12px] font-black text-[#0A2A5E] uppercase tracking-widest">
            Horario de atención (Lun–Dom)
          </p>
        </div>

        <div className="max-h-[52vh] overflow-y-auto pr-2 scrollbar-hide">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {WEEK_DAYS.map((day) => {
              const d = safeDay(day.id);
              const open = d.isOpen !== false;

              return (
                <div
                  key={day.id}
                  className="rounded-[1.25rem] bg-white/80 border border-black/[0.06] p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {day.name}
                      </p>
                      <p className="text-[12px] font-semibold text-slate-900">
                        {open ? "Abierto" : "Cerrado"}
                      </p>
                    </div>

                    <div className="pt-0.5 flex-shrink-0">
                      <Switch
                        on={open}
                        onToggle={() => {
                          // ✅ Abrir: si no hay horas, set defaults para evitar "Horario no definido"
                          if (!open) {
                            const cur = safeDay(day.id);
                            const hasHours = !!cur.start && !!cur.end;

                            setDay(day.id, {
                              isOpen: true,
                              start: hasHours ? cur.start : "08:00",
                              end: hasHours ? cur.end : defaultEndByDay(day.id),
                            });
                            return;
                          }

                          // Cerrar: limpia horas
                          setDay(day.id, { isOpen: false });
                        }}
                      />
                    </div>
                  </div>

                  {open && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                          Apertura
                        </p>
                        <TimePicker12
                          value={d.start || "08:00"}
                          onChange={(v) => setDay(day.id, { start: v, isOpen: true })}
                        />
                      </div>

                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                          Cierre
                        </p>
                        <TimePicker12
                          value={d.end || defaultEndByDay(day.id)}
                          onChange={(v) => setDay(day.id, { end: v, isOpen: true })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p className="mt-2 text-[11px] text-[#0A2A5E]/70 font-semibold">
          Tip: apaga el switch para marcar el día como <b>Cerrado</b>.
        </p>
      </div>
    </div>
  );
};

const FormEmpleado = ({ formData, setFormData, branches, roles }) => {
  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData({ ...formData, photo: reader.result });
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-slate-200">
      {/* FOTO Y ADMIN TOGGLE */}
      <div className="flex flex-col md:flex-row gap-6 items-center bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="relative group">
          <div className="h-28 w-28 rounded-full bg-slate-100 border-4 border-white shadow-lg overflow-hidden flex items-center justify-center">
            {formData.photo ? (
              <img src={formData.photo} className="w-full h-full object-cover" alt="Perfil" />
            ) : (
              <User size={40} className="text-slate-300" />
            )}
          </div>
          <label className="absolute bottom-0 right-0 p-2 bg-blue-600 text-white rounded-full shadow-lg cursor-pointer hover:bg-blue-700 transition-all border-2 border-white">
            <Camera size={14} />
            <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
          </label>
        </div>
        <div className="flex-1 w-full">
          <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div>
              <span className="block text-xs font-black text-slate-700 uppercase">Privilegios Admin</span>
              <span className="block text-[10px] text-slate-400 font-medium">Gestión de personal</span>
            </div>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, isAdmin: !formData.isAdmin })}
              className={`w-12 h-6 rounded-full transition-colors relative ${formData.isAdmin ? 'bg-blue-600' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${formData.isAdmin ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* SEGURIDAD */}
      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800">
        <h4 className="text-[10px] font-black text-blue-400 uppercase mb-4 flex items-center gap-2">
          <Shield size={14} /> Credenciales
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Código</label>
            <input
              placeholder="Ex: EMP001"
              className="w-full bg-slate-800 text-white p-3 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.code || ''}
              onChange={e => setFormData({ ...formData, code: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Usuario</label>
            <input
              placeholder="usuario"
              className="w-full bg-slate-800 text-white p-3 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.username || ''}
              onChange={e => setFormData({ ...formData, username: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Contraseña</label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full bg-slate-800 text-white p-3 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.password || ''}
              onChange={e => setFormData({ ...formData, password: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* PERSONAL */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200">
        <h4 className="text-[10px] font-black text-slate-400 uppercase mb-4 flex items-center gap-2">
          <User size={14} /> Identificación
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            placeholder="Nombre Completo"
            className="border-2 border-slate-100 p-3 rounded-2xl text-sm focus:border-blue-500 outline-none"
            value={formData.name || ''}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
          />
          <input
            placeholder="DUI"
            className="border-2 border-slate-100 p-3 rounded-2xl text-sm focus:border-blue-500 outline-none"
            value={formData.dui || ''}
            onChange={e => setFormData({ ...formData, dui: formatDuiMask(e.target.value) })}
            maxLength={10}
          />
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Nacimiento</label>
            <input
              type="date"
              className="w-full border-2 border-slate-100 p-3 rounded-2xl text-sm"
              value={formData.birthDate || ''}
              onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Teléfono</label>
            <input
              placeholder="7777-7777"
              className="w-full border-2 border-slate-100 p-3 rounded-2xl text-sm"
              value={formData.phone || ''}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* LABORAL Y FINANZAS */}
      <div className="bg-blue-50 p-5 rounded-3xl border border-blue-100">
        <h4 className="text-[10px] font-black text-blue-800 uppercase mb-4 flex items-center gap-2">
          <Briefcase size={14} /> Ubicación Laboral
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select
            className="border-2 border-white p-3 rounded-2xl text-sm bg-white"
            value={formData.branchId || ''}
            onChange={e => setFormData({ ...formData, branchId: e.target.value })}
          >
            <option value="">Sucursal</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select
            className="border-2 border-white p-3 rounded-2xl text-sm bg-white"
            value={formData.role || ''}
            onChange={e => setFormData({ ...formData, role: e.target.value })}
          >
            <option value="">Cargo</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200">
        <h4 className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2">
          <CreditCard size={14} /> Finanzas y Nómina
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            placeholder="AFP"
            className="border-2 border-white p-3 rounded-2xl text-sm"
            value={formData.afpName || ''}
            onChange={e => setFormData({ ...formData, afpName: e.target.value })}
          />
          <input
            placeholder="NUP"
            className="border-2 border-white p-3 rounded-2xl text-sm"
            value={formData.afpNumber || ''}
            onChange={e => setFormData({ ...formData, afpNumber: e.target.value })}
          />
          <input
            placeholder="ISSS"
            className="border-2 border-white p-3 rounded-2xl text-sm"
            value={formData.isssNumber || ''}
            onChange={e => setFormData({ ...formData, isssNumber: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <input
            placeholder="Banco"
            className="border-2 border-white p-3 rounded-2xl text-sm"
            value={formData.bankName || ''}
            onChange={e => setFormData({ ...formData, bankName: e.target.value })}
          />
          <input
            placeholder="Cuenta"
            className="border-2 border-white p-3 rounded-2xl text-sm"
            value={formData.accountNumber || ''}
            onChange={e => setFormData({ ...formData, accountNumber: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
};

// -------------------------
// MAIN MODAL
// -------------------------
const UnifiedModal = ({ isOpen, onClose, type, formData, setFormData, handleSubmit, activeEmployee }) => {
  const { branches, roles } = useStaff();
  const isBranchModal = type === "newBranch" || type === "editBranch";

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      maxWidthClass={isBranchModal ? "max-w-6xl" : "max-w-lg"}
      zClass="z-[100]"
    >
      <div className="bg-slate-50 px-8 py-5 border-b flex justify-between items-center">
        <h3 className="font-black text-slate-800 uppercase tracking-tighter">
          {type === "newEmployee" ? "Nuevo Colaborador" :
            type === "editEmployee" ? "Editar Colaborador" :
              type === "editBranch" ? "Editar Sucursal" :
                type === "newBranch" ? "Nueva Sucursal" :
                  type === "newEvent" ? "Registrar Acción" :
                    type === "uploadDocument" ? "Subir Soporte" : "Gestión"}
        </h3>

        <button
          type="button"
          onClick={onClose}
          className="p-2 hover:bg-slate-200 rounded-full transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* ✅ Scroll + márgenes arriba/abajo SOLO dentro del modal */}
      <div className="max-h-[82vh] overflow-y-auto overscroll-contain">
        <form
          onSubmit={handleSubmit}
          className={[
            "py-6",
            isBranchModal ? "px-6" : "px-8",
          ].join(" ")}
        >
          {(type === "newEmployee" || type === "editEmployee") && (
            <FormEmpleado
              formData={formData}
              setFormData={setFormData}
              branches={branches}
              roles={roles}
            />
          )}

          {(type === "newBranch" || type === "editBranch") && (
            <FormSucursal
              formData={formData}
              setFormData={setFormData}
            />
          )}

          {type === "newEvent" && (
            <FormNovedad
              formData={formData}
              setFormData={setFormData}
              branches={branches}
              activeEmployee={activeEmployee}
            />
          )}

          {type === "uploadDocument" && (
            <FormUploadOnly
              formData={formData}
              setFormData={setFormData}
            />
          )}

          {/* ✅ Footer sticky */}
          <div className="mt-6 flex justify-end gap-3 pt-6 border-t border-slate-100 sticky bottom-0 bg-white/80 backdrop-blur-md">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-slate-400 font-bold text-[10px] uppercase tracking-widest"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-10 py-3 bg-blue-600 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl shadow-xl shadow-blue-500/20 hover:bg-blue-700 transition-all"
            >
              {type === "uploadDocument" ? "Subir Archivo" : "Confirmar"}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
};

export default UnifiedModal;