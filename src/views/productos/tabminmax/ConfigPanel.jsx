// Extracted from TabMinMax.jsx (Bloque 6.C)
import { useState } from 'react';
import HojaMovil from '../../../components/common/HojaMovil';
import useMediaQuery from '../../../hooks/useMediaQuery';
import Button from '../../../components/common/Button';
import ModalShell from '../../../components/common/ModalShell';
import { Settings2, X, Loader2, CheckCircle2, Save } from 'lucide-react';
import { supabase } from '../../../supabaseClient';
import { updateStockConfig } from '../../../data/stockParams';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import PortalInput from '../../../components/common/PortalInput';

// Definido a nivel de módulo — dentro del componente, React lo recreaba en cada render
// y desmontaba/remontaba el <input>, perdiendo el foco tras cada tecla (M-4).
const Field = ({ form, set, label, k, unit, min = 0, max, step = 1 }) => (
    <div className="flex items-center justify-between gap-3">
        <span className="text-label text-content-2 font-medium flex-1">{label}</span>
        <div className="flex items-center gap-1.5">
            <PortalInput
                aria-label="Valor del parámetro" compact className="w-16"
                type="number" min={min} max={max} step={step}
                value={form[k] ?? 0} onChange={e => set(k, e.target.value)}
                inputClassName="text-right font-bold"
            />
            {unit && <span className="text-caption text-content-3 shrink-0 w-8">{unit}</span>}
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
            // Es una fila sola, pero `cycle_days` y los `reorder_*_days` son el
            // divisor y el multiplicador del MIN·MAX de TODO el catálogo: un
            // cambio acá reescribe 18,364 filas a la vez. Sin registro, un
            // producto cuyo mínimo se movió no tiene explicación ni autor.
            useStaff.getState().appendAuditLog('CAMBIAR_CONFIG_MINMAX', 'stock_config', payload);
            onSave({ ...payload });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) { setErr(e.message); }
        finally { setSaving(false); }
    };

    // En el teléfono el cuerpo es el canónico de hoja; en escritorio, el panel
    // de siempre. `Envoltorio` evita duplicar todo el árbol para cambiar la caja.
    const enTactil = useMediaQuery('(hover: none)');
    // Una FUNCIÓN que devuelve JSX, no un componente definido en el render:
    // definir un componente ahí adentro lo re-crea en cada pasada y React
    // remonta el subárbol entero, perdiendo el estado del formulario. El lint lo
    // marca ("Cannot create components during render") y tiene razón.
    //
    // Recibe cuerpo y pie POR SEPARADO. Iban los dos como `children`, y en la
    // hoja los `children` caen dentro del cuerpo scrolleable: el pie se iba con
    // el scroll en vez de quedar fijo abajo, así que acostado quedaba debajo del
    // pliegue y se veía cortado. `HojaMovil` ya tiene la ranura `pie`, que lo
    // ancla y le pone su área segura.
    const envolver = (cuerpo, pie) => enTactil
        ? <HojaMovil titulo="Configuración Min/Max" icono={Settings2} pie={pie}>{cuerpo}</HojaMovil>
        : <div>{cuerpo}<div className="px-4 py-3 border-t border-divider flex items-center gap-2">{pie}</div></div>;

    // Las acciones, SUELTAS y no dentro de un envoltorio. `HojaMovil` estila
    // `[&>*]` —los hijos DIRECTOS del pie— para repartirlos a ancho completo, y
    // un div en el medio se come esa selección: los botones perdían `flex-1
    // basis-36`, se apilaban en dos filas y el pie se comía el 40% del panel.
    // Un `display: contents` tampoco sirve: no cambia quién es hijo directo
    // para el selector, solo cómo se dibuja.
    const acciones = <>
        <Button disabled={saving} onClick={handleSave}>{saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
            {saved ? 'Guardado' : 'Guardar'}</Button>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
    </>;

    return (
        // `ModalShell` y no un overlay a mano (2026-07-30). Este panel se montaba
        // con `fixed inset-0 … pointer-events-none`: sin scrim, sin `role="dialog"`,
        // sin Escape y sin atrapar el foco — o sea que para un lector de pantalla
        // no era un diálogo y con el teclado se seguía tabulando por la tabla de
        // atrás. Y su `rounded-2xl` era un radio fijo contra el token del tema.
        // Sin `align`: el default. Estaba en `"top"`, que `ModalShell` respeta
        // siempre por ser el gesto del ⌘K — y en un teléfono eso deja el panel
        // flotando a 10vh del borde de arriba, que es exactamente el
        // antipatrón que el paso a hojas vino a quitar. Este no es una paleta
        // de comandos, es un formulario.
        <ModalShell open onClose={onClose} maxWidthClass="max-w-sm"
            zClass="z-modal" ariaLabel="Configuración de Min/Max"
            surface={enTactil ? null : undefined}
            // SIN `animacionPropia`. La tenía, y `animacionPropia` significa "el
            // hijo se anima solo" — pero este panel no se animaba: solo apagaba
            // la de `ModalShell`. Resultado: aparecía de golpe, sin la gota, y
            // como `useGotaApertura` es quien cuelga `__gota`, el asa tampoco
            // arrastraba. Reportado como "no tienen la animación".
            panelClassName="overflow-hidden">
            {envolver(<>
                {/* Header — solo en escritorio: en el teléfono el título y el asa
                    los pone `HojaMovil`, y dos encabezados apilados se leen como
                    un error de maquetado. */}
                {!enTactil && (
                <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
                    <div className="flex items-center gap-2">
                        <Settings2 size={14} className="text-brand-text" />
                        <span className="text-body-sm font-black text-content">Configuración Min/Max</span>
                    </div>
                    <Button variant="ghost" size="xs" icon={X} iconOnly onClick={onClose} />
                </div>
                )}

                {/* En táctil SIN `max-h`/`overflow` propios: `HojaMovil` ya da
                    un cuerpo que scrollea, y dos contenedores scrolleables
                    anidados es lo que se sentía como "el scroll es malo" — el
                    dedo movía el de adentro o el de afuera según dónde cayera.
                    En escritorio el panel no tiene alto propio, así que ahí el
                    tope sigue haciendo falta. */}
                <div className={`px-4 py-3 flex flex-col gap-4 ${enTactil ? '' : 'max-h-[70vh] overflow-y-auto'}`}>
                    {/* Ciclo */}
                    <section className="flex flex-col gap-2">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Ciclo de reposición</span>
                        <Field form={form} set={set} label="MAX — días de cobertura objetivo" k="cycle_days" unit="días" min={1} />
                        <Field form={form} set={set} label="Ventana histórica de ventas"       k="analysis_days" unit="días" min={30} />
                    </section>

                    <div className="h-px bg-divider" />

                    {/* Reorden por XYZ */}
                    <section className="flex flex-col gap-2">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">MIN — días de reorden por clase XYZ</span>
                        <Field form={form} set={set} label="Clase X — demanda estable"   k="reorder_x_days" unit="días" min={1} />
                        <Field form={form} set={set} label="Clase Y — demanda moderada"  k="reorder_y_days" unit="días" min={1} />
                        <Field form={form} set={set} label="Clase Z — demanda errática"  k="reorder_z_days" unit="días" min={1} />
                    </section>

                    <div className="h-px bg-divider" />

                    {/* Umbrales XYZ */}
                    <section className="flex flex-col gap-2">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Umbrales XYZ (percentil de CV, relativo a cada sucursal)</span>
                        <Field form={form} set={set} label="X = percentil ≤" k="xyz_x_percentile" unit="%" min={1} max={99} step={1} />
                        <Field form={form} set={set} label="Y = percentil ≤" k="xyz_y_percentile" unit="%" min={1} max={100} step={1} />
                        <p className="text-micro text-content-3 leading-snug">
                            Z = el resto. Relativo: compara cada producto contra sus propios vecinos DENTRO de la misma sucursal, no contra un % de CV fijo — así sucursales de bajo volumen (todo CV alto) también obtienen diferenciación real.
                        </p>
                    </section>

                    <div className="h-px bg-divider" />

                    {/* Umbrales ABC */}
                    <section className="flex flex-col gap-2">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Umbrales ABC (% revenue acumulado)</span>
                        <Field form={form} set={set} label="A = top" k="abc_a_pct" unit="%" min={1} step={1} />
                        <Field form={form} set={set} label="B = hasta" k="abc_b_pct" unit="%" min={1} step={1} />
                        <p className="text-micro text-content-3">C y D = resto. Recalcula para aplicar.</p>
                    </section>

                    <div className="h-px bg-divider" />

                    {/* Alerta próximo mínimo */}
                    <section className="flex flex-col gap-2">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Alerta "próximo a mínimo"</span>
                        <Field form={form} set={set} label="Umbral (stock &lt; MIN × (1 + X%))" k="approaching_pct" unit="%" min={1} max={100} step={1} />
                        <p className="text-micro text-content-3">Ej: 25% → alerta si stock &lt; MIN × 1.25</p>
                    </section>

                    <div className="h-px bg-divider" />

                    {/* Buffer de seguridad */}
                    <section className="flex flex-col gap-2">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Buffer de seguridad (días extra al MIN)</span>
                        <Field form={form} set={set} label="Clase X — demanda estable"  k="buffer_x_days" unit="días" min={0} />
                        <Field form={form} set={set} label="Clase Y — demanda moderada" k="buffer_y_days" unit="días" min={0} />
                        <Field form={form} set={set} label="Clase Z — demanda errática" k="buffer_z_days" unit="días" min={0} />
                        <p className="text-micro text-content-3">MIN = velocidad × (reorden + buffer). Recalcula para aplicar.</p>
                    </section>

                    <div className="h-px bg-divider" />

                    {/* Filtrado de demanda mayorista */}
                    <section className="flex flex-col gap-2">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Filtrado de outliers (winsorización)</span>
                        <Field form={form} set={set} label="Percentil de corte" k="outlier_percentile" unit="%" min={50} max={100} step={1} />
                        <p className="text-micro text-content-3 leading-snug">
                            Capea ventas diarias al percentil indicado antes de calcular velocidad y CV. P95 = estándar industria. P100 = sin filtro. Recalculá para aplicar.
                        </p>
                    </section>

                    {err && <p className="text-label text-danger-text font-semibold">{err}</p>}
                </div>
            </>,
            // El pie, como ranura y no como parte del cuerpo. En escritorio
            // conserva su borde y su relleno; en la hoja los pone `HojaMovil`.
            acciones)}
        </ModalShell>
    );
}
