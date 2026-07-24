// Extracted from TabMinMax.jsx (Bloque 6.C)
import { useState } from 'react';
import { Settings2, X, Loader2, CheckCircle2, Save } from 'lucide-react';
import { supabase } from '../../../supabaseClient';
import { updateStockConfig } from '../../../data/stockParams';

// Definido a nivel de módulo — dentro del componente, React lo recreaba en cada render
// y desmontaba/remontaba el <input>, perdiendo el foco tras cada tecla (M-4).
const Field = ({ form, set, label, k, unit, min = 0, max, step = 1 }) => (
    <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-content-2 font-medium flex-1">{label}</span>
        <div className="flex items-center gap-1.5">
            <input type="number" min={min} max={max} step={step} value={form[k] ?? 0}
                onChange={e => set(k, e.target.value)}
                className="w-16 text-right text-[16px] font-bold text-content bg-surface-card border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            {unit && <span className="text-[10px] text-content-3 shrink-0 w-8">{unit}</span>}
        </div>
    </div>
);

export default function ConfigPanel({ config, onSave, onClose }) {
    const [form,   setForm]   = useState({ ...config });
    const [saving, setSaving] = useState(false);
    const [saved,  setSaved]  = useState(false);
    const [err,    setErr]    = useState('');

    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

    const handleSave = async () => {
        if (Number(form.cycle_days) < 1) { setErr('El ciclo debe ser ≥ 1 día'); return; }
        if (Number(form.abc_a_pct) >= Number(form.abc_b_pct)) { setErr('El umbral A debe ser menor que el B'); return; }
        if (Number(form.xyz_x_percentile) >= Number(form.xyz_y_percentile)) { setErr('El percentil de X debe ser menor que el de Y'); return; }
        if (Number(form.xyz_y_percentile) > 100) { setErr('El percentil de Y no puede superar 100'); return; }
        if (Number(form.approaching_pct) < 1 || Number(form.approaching_pct) > 100) { setErr('Alerta próximo debe estar entre 1 y 100%'); return; }
        setSaving(true); setErr('');
        const { data: { user } } = await supabase.auth.getUser();
        const payload = {
            cycle_days:          Number(form.cycle_days),
            reorder_x_days:      Number(form.reorder_x_days),
            reorder_y_days:      Number(form.reorder_y_days),
            reorder_z_days:      Number(form.reorder_z_days),
            xyz_x_percentile:    Number(form.xyz_x_percentile),
            xyz_y_percentile:    Number(form.xyz_y_percentile),
            abc_a_pct:           Number(form.abc_a_pct),
            abc_b_pct:           Number(form.abc_b_pct),
            analysis_days:       Number(form.analysis_days),
            approaching_pct:     Number(form.approaching_pct),
            buffer_x_days:       Number(form.buffer_x_days),
            buffer_y_days:       Number(form.buffer_y_days),
            buffer_z_days:       Number(form.buffer_z_days),
            outlier_percentile:  Number(form.outlier_percentile ?? 95),
            updated_at:          new Date().toISOString(),
            updated_by:          user?.email ?? null,
        };
        try {
            const { error } = await updateStockConfig(payload);
            if (error) throw error;
            onSave({ ...payload });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) { setErr(e.message); }
        finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pt-20 pointer-events-none">
            <div className="pointer-events-auto w-80 rounded-2xl border border-border-card shadow-[0_20px_60px_rgba(0,0,0,0.12)] overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(24px)' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <Settings2 size={14} className="text-brand" />
                        <span className="text-[12px] font-black text-content">Configuración Min/Max</span>
                    </div>
                    <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-full text-content-3 hover:text-content-2 hover:bg-surface-card-hover transition-colors">
                        <X size={12} />
                    </button>
                </div>

                <div className="px-4 py-3 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
                    {/* Ciclo */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-content-2">Ciclo de reposición</span>
                        <Field form={form} set={set} label="MAX — días de cobertura objetivo" k="cycle_days" unit="días" min={1} />
                        <Field form={form} set={set} label="Ventana histórica de ventas"       k="analysis_days" unit="días" min={30} />
                    </section>

                    <div className="h-px bg-surface-card-hover" />

                    {/* Reorden por XYZ */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-content-2">MIN — días de reorden por clase XYZ</span>
                        <Field form={form} set={set} label="Clase X — demanda estable"   k="reorder_x_days" unit="días" min={1} />
                        <Field form={form} set={set} label="Clase Y — demanda moderada"  k="reorder_y_days" unit="días" min={1} />
                        <Field form={form} set={set} label="Clase Z — demanda errática"  k="reorder_z_days" unit="días" min={1} />
                    </section>

                    <div className="h-px bg-surface-card-hover" />

                    {/* Umbrales XYZ */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-content-2">Umbrales XYZ (percentil de CV, relativo a cada sucursal)</span>
                        <Field form={form} set={set} label="X = percentil ≤" k="xyz_x_percentile" unit="%" min={1} max={99} step={1} />
                        <Field form={form} set={set} label="Y = percentil ≤" k="xyz_y_percentile" unit="%" min={1} max={100} step={1} />
                        <p className="text-[9px] text-content-3 leading-snug">
                            Z = el resto. Relativo: compara cada producto contra sus propios vecinos DENTRO de la misma sucursal, no contra un % de CV fijo — así sucursales de bajo volumen (todo CV alto) también obtienen diferenciación real.
                        </p>
                    </section>

                    <div className="h-px bg-surface-card-hover" />

                    {/* Umbrales ABC */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-content-2">Umbrales ABC (% revenue acumulado)</span>
                        <Field form={form} set={set} label="A = top" k="abc_a_pct" unit="%" min={1} step={1} />
                        <Field form={form} set={set} label="B = hasta" k="abc_b_pct" unit="%" min={1} step={1} />
                        <p className="text-[9px] text-content-3">C y D = resto. Recalcula para aplicar.</p>
                    </section>

                    <div className="h-px bg-surface-card-hover" />

                    {/* Alerta próximo mínimo */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-content-2">Alerta "próximo a mínimo"</span>
                        <Field form={form} set={set} label="Umbral (stock &lt; MIN × (1 + X%))" k="approaching_pct" unit="%" min={1} max={100} step={1} />
                        <p className="text-[9px] text-content-3">Ej: 25% → alerta si stock &lt; MIN × 1.25</p>
                    </section>

                    <div className="h-px bg-surface-card-hover" />

                    {/* Buffer de seguridad */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-content-2">Buffer de seguridad (días extra al MIN)</span>
                        <Field form={form} set={set} label="Clase X — demanda estable"  k="buffer_x_days" unit="días" min={0} />
                        <Field form={form} set={set} label="Clase Y — demanda moderada" k="buffer_y_days" unit="días" min={0} />
                        <Field form={form} set={set} label="Clase Z — demanda errática" k="buffer_z_days" unit="días" min={0} />
                        <p className="text-[9px] text-content-3">MIN = velocidad × (reorden + buffer). Recalcula para aplicar.</p>
                    </section>

                    <div className="h-px bg-surface-card-hover" />

                    {/* Filtrado de demanda mayorista */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-content-2">Filtrado de outliers (winsorización)</span>
                        <Field form={form} set={set} label="Percentil de corte" k="outlier_percentile" unit="%" min={50} max={100} step={1} />
                        <p className="text-[9px] text-content-3 leading-snug">
                            Capea ventas diarias al percentil indicado antes de calcular velocidad y CV. P95 = estándar industria. P100 = sin filtro. Recalculá para aplicar.
                        </p>
                    </section>

                    {err && <p className="text-[11px] text-danger font-semibold">{err}</p>}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2">
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-bold text-white bg-brand hover:bg-blue-700 transition-colors disabled:opacity-60">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
                        {saved ? '¡Guardado!' : 'Guardar configuración'}
                    </button>
                    <button onClick={onClose} className="px-3 py-2 rounded-xl text-[12px] font-bold text-content-3 hover:bg-surface-card-hover transition-colors">Cerrar</button>
                </div>
            </div>
        </div>
    );
}
