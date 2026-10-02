import React, { useState } from 'react';
import { Plus, Check, Star } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import Switch from '../../components/common/Switch';
import Campo from '../promociones/Campo';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { NOMBRES_DE_MES, fechaTexto } from '@nucleo/utils/fecha';
import { fechaEspecialEn } from '@nucleo/utils/marketing';
import { guardarMarca, activarRed, guardarAjustes, guardarFechaEspecial } from '@nucleo/data/marketing';
import { COLORES_MARCA, puntoDeMarca } from './iconos';

const DIAS_LIMITE = Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: `Día ${i + 1}` }));
const MESES = NOMBRES_DE_MES.map((m, i) => ({ value: i + 1, label: m }));

/**
 * Los ajustes del planificador. Quien edita maneja marcas y redes; quien
 * aprueba, el día límite y los recordatorios (es un compromiso con gerencia).
 * Las fechas especiales las cuidan los dos. Apagar algo lo saca de los
 * formularios sin tocar lo ya planificado.
 */
export default function AjustesModal({ open, onClose, marcas, redes, ajustes, fechas, puedeEditar, puedeAprobar, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [nueva, setNueva] = useState('');
    const [fecha, setFecha] = useState({ nombre: '', mes: '', dia: '', idea: '' });
    const [guardando, setGuardando] = useState(false);
    const [metas, setMetas] = useState({});   // lo que se está escribiendo; se guarda al salir del campo

    if (!open) return null;

    const usados = new Set(marcas.map((m) => m.color));
    const libre = COLORES_MARCA.find((c) => !usados.has(c)) || COLORES_MARCA[marcas.length % COLORES_MARCA.length];
    const anio = new Date().getFullYear();

    const intentar = async (fn) => {
        setGuardando(true);
        try {
            await fn();
            onCambio?.();
        } catch (err) {
            showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    const agregarMarca = () => intentar(async () => {
        await guardarMarca({ nombre: nueva, color: libre, activo: true, orden: marcas.length + 1 });
        setNueva('');
    });

    const diaValido = Number(fecha.dia) >= 1 && Number(fecha.dia) <= 31;
    const agregarFecha = () => intentar(async () => {
        await guardarFechaEspecial({ nombre: fecha.nombre, mes: Number(fecha.mes), dia: Number(fecha.dia), idea: fecha.idea });
        setFecha({ nombre: '', mes: '', dia: '', idea: '' });
    });

    const titulo = 'text-label uppercase tracking-wide font-semibold text-content-2';

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel="Ajustes del planificador">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Ajustes del planificador</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-6">
                    <section className="space-y-3">
                        <h3 className={titulo}>Calendario</h3>
                        <Campo rotulo="Fecha límite para enviar el mes siguiente">
                            <LiquidSelect value={ajustes?.dia_limite_envio ?? 20} options={DIAS_LIMITE} clearable={false}
                                disabled={!puedeAprobar || guardando}
                                onChange={(v) => intentar(() => guardarAjustes({ dia_limite_envio: Number(v) }))} />
                        </Campo>
                        <div className="flex items-center gap-3 min-h-[var(--tap-min)]">
                            <span className="flex-1 text-body-sm text-content">
                                Recordatorio de las 8:00 (lo de hoy, lo vencido y la fecha límite)
                            </span>
                            <Switch checked={ajustes?.recordatorios_activos ?? true} label="Recordatorios activos"
                                disabled={!puedeAprobar || guardando}
                                onChange={(on) => intentar(() => guardarAjustes({ recordatorios_activos: on }))} />
                        </div>
                        {!puedeAprobar && (
                            <p className="text-caption text-content-3">Los cambia quien aprueba el calendario.</p>
                        )}
                    </section>

                    <section className="space-y-3">
                        <h3 className={titulo}>Metas del servicio (contrato)</h3>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                ['meta_publicaciones', 'Publicaciones al mes'],
                                ['meta_videos', 'Videos o reels al mes'],
                                ['meta_visitas', 'Visitas al mes'],
                                ['dias_anticipacion', 'Días de anticipación'],
                            ].map(([k, rotulo]) => (
                                <PortalInput key={k} label={rotulo} name={k} type="number" inputMode="numeric" min={0}
                                    value={metas[k] ?? String(ajustes?.[k] ?? '')} readOnly={!puedeAprobar}
                                    onChange={(e) => setMetas((m) => ({ ...m, [k]: e.target.value }))}
                                    onBlur={() => {
                                        const n = Number(metas[k]);
                                        if (metas[k] != null && metas[k] !== '' && n >= 0 && n !== Number(ajustes?.[k])) {
                                            intentar(() => guardarAjustes({ [k]: n }));
                                        }
                                    }} />
                            ))}
                        </div>
                        <p className="text-caption text-content-3">
                            Se miden en la pestaña Servicio. Cambian cuando se ajuste el contrato (por ejemplo, al terminar los 6 meses de prueba).
                        </p>
                    </section>

                    <section className="space-y-2">
                        <h3 className={titulo}>Fechas especiales</h3>
                        <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
                            {fechas.map((f) => {
                                const d = fechaEspecialEn(f, anio);
                                return (
                                    <li key={f.id} className="flex items-center gap-3 min-h-[var(--tap-min)]">
                                        <Star size={13} className="text-chart-8-text shrink-0" aria-hidden />
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-body-sm text-content truncate">{f.nombre}</span>
                                            <span className="block text-micro text-content-3">
                                                {d ? fechaTexto(d, { day: 'numeric', month: 'long' }) : '—'}{f.regla ? ' (cambia cada año)' : ''}
                                            </span>
                                        </span>
                                        <Switch checked={f.activo} label={`${f.nombre} activa`} disabled={guardando}
                                            onChange={(on) => intentar(() => guardarFechaEspecial({ ...f, activo: on }))} />
                                    </li>
                                );
                            })}
                        </ul>
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
                            <PortalInput label="Nueva fecha" name="fecha_nombre" value={fecha.nombre}
                                onChange={(e) => setFecha((x) => ({ ...x, nombre: e.target.value }))} placeholder="Ej. Aniversario" />
                            <Campo rotulo="Mes">
                                <LiquidSelect value={fecha.mes} options={MESES} placeholder="Mes"
                                    onChange={(v) => setFecha((x) => ({ ...x, mes: v }))} />
                            </Campo>
                            <PortalInput label="Día" name="fecha_dia" type="number" inputMode="numeric" min={1} max={31}
                                value={fecha.dia} onChange={(e) => setFecha((x) => ({ ...x, dia: e.target.value }))} />
                        </div>
                        <PortalInput label="Idea (opcional)" name="fecha_idea" value={fecha.idea}
                            onChange={(e) => setFecha((x) => ({ ...x, idea: e.target.value }))} placeholder="Qué publicar ese día" />
                        <div className="flex justify-end">
                            <Button variant="secondary" icon={Plus} loading={guardando}
                                disabled={!fecha.nombre.trim() || !fecha.mes || !diaValido} onClick={agregarFecha}>
                                Agregar fecha
                            </Button>
                        </div>
                    </section>

                    <section className="space-y-2">
                        <h3 className={titulo}>Marcas</h3>
                        {marcas.map((m) => (
                            <div key={m.id} className="flex items-center gap-3 min-h-[var(--tap-min)]">
                                <span className={`w-3 h-3 rounded-full shrink-0 ${puntoDeMarca(m.color)}`} aria-hidden />
                                <span className="flex-1 text-body-sm text-content truncate">{m.nombre}</span>
                                <Switch checked={m.activo} label={`${m.nombre} activa`} disabled={!puedeEditar || guardando}
                                    onChange={(on) => intentar(() => guardarMarca({ ...m, activo: on }))} />
                            </div>
                        ))}
                        {puedeEditar && (
                            <div className="flex items-end gap-2">
                                <div className="flex-1 min-w-0">
                                    <PortalInput label="Nueva marca" name="nueva_marca" value={nueva}
                                        onChange={(e) => setNueva(e.target.value)} placeholder="Nombre de la página" />
                                </div>
                                <Button variant="secondary" icon={Plus} disabled={!nueva.trim()} loading={guardando} onClick={agregarMarca}>
                                    Agregar
                                </Button>
                            </div>
                        )}
                    </section>

                    <section className="space-y-2">
                        <h3 className={titulo}>Redes</h3>
                        {redes.map((r) => (
                            <div key={r.clave} className="flex items-center gap-3 min-h-[var(--tap-min)]">
                                <span className="flex-1 text-body-sm text-content">{r.nombre}</span>
                                <Switch checked={r.activo} label={`${r.nombre} activa`} disabled={!puedeEditar || guardando}
                                    onChange={(on) => intentar(() => activarRed(r.clave, on))} />
                            </div>
                        ))}
                    </section>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button icon={Check} onClick={onClose}>Listo</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
