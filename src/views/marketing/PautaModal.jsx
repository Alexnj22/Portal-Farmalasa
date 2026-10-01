import React, { useCallback, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import Checkbox from '../../components/common/Checkbox';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import Campo from '../promociones/Campo';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { OBJETIVOS_PAUTA } from '@nucleo/utils/marketing';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { guardarPauta, quitarPauta } from '@nucleo/data/marketing';

const CAMPOS = ['redes', 'objetivo', 'publico', 'presupuesto', 'fecha_inicio', 'fecha_fin',
    'gastado', 'alcance', 'impresiones', 'interacciones', 'mensajes', 'clics', 'notas'];
const RESULTADOS = [
    ['gastado', 'Gastado'], ['alcance', 'Alcance'], ['impresiones', 'Impresiones'],
    ['interacciones', 'Interacciones'], ['mensajes', 'Mensajes'], ['clics', 'Clics'],
];

const desde = (pauta, pieza) => Object.fromEntries(CAMPOS.map((k) => {
    const v = pauta?.[k];
    if (k === 'redes') return [k, v?.length ? v : (pieza?.redes || [])];
    if (k === 'fecha_inicio' && !v) return [k, pieza?.fecha || ''];
    return [k, v == null ? '' : String(v)];
}));

/**
 * Lo que se invierte en una pieza y lo que trajo. El plan se escribe antes de
 * publicar; los resultados, cuando la campaña cierra. Un resultado vacío es
 * «todavía no se anotó», no cero.
 */
export default function PautaModal({ open, onClose, pieza, redes, limite = 0, otros = 0, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [form, setForm] = useState(() => desde(pieza?.pauta, pieza));
    const [guardando, setGuardando] = useState(false);
    const nueva = !pieza?.pauta;

    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(
        nueva && pieza?.id ? `marketing_pauta_${pieza.id}` : null, form, { activo: open && nueva });
    const reponer = useCallback(() => {
        if (!recuperado) return;
        setForm((f) => ({ ...f, ...recuperado }));
        descartar();
    }, [recuperado, descartar]);

    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
    // El tope del mes lo fija gerencia; la base tampoco deja pasarse.
    const libre = limite - otros - (Number(form.presupuesto) || 0);
    const pasado = libre < 0 && Number(form.presupuesto) > 0;

    const guardar = async () => {
        setGuardando(true);
        try {
            await guardarPauta(pieza.id, form);
            descartar();
            showToast('Pauta guardada', pieza.titulo, 'success');
            onCambio?.();
            onClose();
        } catch (err) {
            showToast('No se pudo guardar la pauta', mensajeAmigable(err, 'Revisa los montos e intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    const quitar = async () => {
        setGuardando(true);
        try {
            await quitarPauta(pieza.id);
            onCambio?.();
            onClose();
        } catch (err) {
            showToast('No se pudo quitar la pauta', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    if (!open || !pieza) return null;

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-2xl" ariaLabel={`Pauta de ${pieza.titulo}`}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content truncate">Pauta · {pieza.titulo}</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-5">
                    {hayBorrador && <AvisoDeBorrador cuando={cuando} onRecuperar={reponer} onDescartar={descartar} />}
                    <section className="space-y-3">
                        <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">El plan</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <PortalInput label="Presupuesto" name="presupuesto" inputMode="decimal" maskType="DECIMAL" prefix="$"
                                value={form.presupuesto} onChange={set('presupuesto')} placeholder="0.00"
                                hasError={pasado}
                                helperText={limite > 0
                                    ? (pasado ? `Te pasas por ${formatMoney(-libre)}` : `Quedan ${formatMoney(libre)} de ${formatMoney(limite)} del mes`)
                                    : 'Gerencia todavía no fija el presupuesto del mes'} />
                            <Campo rotulo="Objetivo">
                                <LiquidSelect value={form.objetivo} onChange={set('objetivo')} placeholder="Qué se busca"
                                    options={OBJETIVOS_PAUTA.map((o) => ({ value: o.value, label: o.label }))} />
                            </Campo>
                            <Campo rotulo="Desde">
                                <LiquidDatePicker value={form.fecha_inicio} onChange={set('fecha_inicio')} />
                            </Campo>
                            <Campo rotulo="Hasta">
                                <LiquidDatePicker value={form.fecha_fin} onChange={set('fecha_fin')} min={form.fecha_inicio || undefined} />
                            </Campo>
                        </div>
                        <Campo rotulo="Dónde se pauta">
                            <div className="flex flex-wrap gap-x-4 gap-y-2">
                                {redes.filter((r) => r.activo || form.redes.includes(r.clave)).map((r) => (
                                    <Checkbox key={r.clave} label={r.nombre} checked={form.redes.includes(r.clave)}
                                        onChange={(on) => setForm((f) => ({
                                            ...f,
                                            redes: on ? [...new Set([...f.redes, r.clave])] : f.redes.filter((x) => x !== r.clave),
                                        }))} />
                                ))}
                            </div>
                        </Campo>
                        <PortalInput label="Público" name="publico" value={form.publico} onChange={set('publico')}
                            placeholder="Ej. Chalatenango, 25–55 años, interés en salud" />
                    </section>
                    <section className="space-y-3">
                        <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Resultados</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {RESULTADOS.map(([k, label]) => (
                                <PortalInput key={k} label={label} name={k}
                                    {...(k === 'gastado'
                                        ? { inputMode: 'decimal', maskType: 'DECIMAL', prefix: '$' }
                                        : { type: 'number', inputMode: 'numeric', min: 0 })}
                                    value={form[k]} onChange={set(k)} placeholder="—" />
                            ))}
                        </div>
                        <PortalTextarea label="Notas" name="notas" value={form.notas} onChange={set('notas')} rows={2}
                            placeholder="Qué funcionó, qué no, qué repetir" />
                    </section>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                {!nueva && <Button variant="ghost" icon={Trash2} onClick={quitar} className="mr-auto">Quitar pauta</Button>}
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Check} loading={guardando} disabled={pasado} onClick={guardar}>Guardar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
