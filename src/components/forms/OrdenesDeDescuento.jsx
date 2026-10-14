/**
 * Órdenes de descuento del empleado — en Nómina, junto a la cuenta de planilla.
 *
 * Pedido del usuario (2026-10-14): «cuando un empleado saca préstamos y la
 * empresa paga la cuota, se subirá una/unas fotos del documento, y ahí que
 * tome los datos como confirmar empleado, fecha de inicio, fin, tasa, cuota,
 * monto, etc. (pero que sean editables)… e identifica el banco. Así sabemos
 * cuánto tiempo queda de pagar».
 *
 * La lectura NO se dispara sola al elegir cada foto: un documento de dos
 * páginas serían dos llamadas. Se eligen las fotos y se lee UNA vez — es lo
 * que pidió con «la menor cantidad de tokens posibles».
 *
 * El nombre que trae el papel se compara con la ficha y se DICE si no es el
 * mismo: una orden en el expediente equivocado descuenta del salario de otra
 * persona.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Plus, Pencil, Trash2, ScanText, Check, X, AlertTriangle, FileText, UserCheck } from 'lucide-react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import FileField from '../common/FileField';
import ConfirmModal from '../common/ConfirmModal';
import { BANCOS } from '@nucleo/constants/bancos';
import { fetchOrdenes, leerOrden, subirFotoDeOrden, guardarOrden, borrarOrden } from '@nucleo/data/ordenesDeDescuento';
import { loQueFalta, camposDesdeLectura, finDesdePlazo } from '@nucleo/utils/ordenDeDescuento';
import { cruzarConElPadron } from '@nucleo/data/documentosCompartidos';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';

const dinero = (n) => formatMoney(n === '' ? null : n);
const fecha = (iso) => fechaTexto(iso, { day: '2-digit', month: 'short', year: 'numeric' }, '—');

const PERIODICIDAD = [{ value: 'MENSUAL', label: 'Mensual' }, { value: 'QUINCENAL', label: 'Quincenal' }];
const ESTADOS = [
    { value: 'VIGENTE', label: 'Vigente' },
    { value: 'FINALIZADA', label: 'Finalizada (pagada)' },
    { value: 'CANCELADA', label: 'Cancelada' },
];
const VACIA = { banco: '', referencia: '', monto_prestamo: '', tasa_interes: '', cuota: '', periodicidad: 'MENSUAL',
    plazo_cuotas: '', fecha_inicio: '', fecha_fin: '', estado: 'VIGENTE', archivos: [], nombre_en_documento: '', notas: '' };

export default function OrdenesDeDescuento({ empleado, canEdit }) {
    const [ordenes, setOrdenes] = useState(null);
    const [fallo, setFallo] = useState(null);
    const [editando, setEditando] = useState(null);   // null | orden (nueva o existente)
    const [aBorrar, setABorrar] = useState(null);
    const [borrando, setBorrando] = useState(false);
    const appendAuditLog = useStaff(s => s.appendAuditLog);
    const toast = useToastStore(s => s.showToast);

    const cargar = useCallback(async () => {
        try { const o = await fetchOrdenes(empleado.id); setFallo(null); setOrdenes(o); }
        catch (e) { setFallo(mensajeAmigable(e) || 'No se pudieron cargar las órdenes.'); setOrdenes([]); }
    }, [empleado.id]);
    useEffect(() => { cargar(); }, [cargar]);

    const vigentes = (ordenes || []).filter(o => o.estado === 'VIGENTE');
    const cuotaMensual = vigentes.reduce((s, o) => s + (Number(o.cuota) || 0) * (o.periodicidad === 'QUINCENAL' ? 2 : 1), 0);

    const confirmarBorrar = async () => {
        setBorrando(true);
        try {
            await borrarOrden(aBorrar.id);
            appendAuditLog?.('ORDEN_DESCUENTO_BORRAR', String(empleado.id), { orden: aBorrar.id, banco: aBorrar.banco });
            setABorrar(null);
            await cargar();
        } catch (e) { toast('No se pudo borrar', mensajeAmigable(e) || e?.message, 'error'); }
        finally { setBorrando(false); }
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
                <div className="p-2 bg-chart-4/10 text-chart-4-text rounded-xl border border-chart-4/30 shadow-[var(--shadow-shine)]">
                    <Landmark size={16} strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                    <h4 className="text-body-sm font-black uppercase tracking-widest text-content">Órdenes de descuento</h4>
                    <p className="text-micro text-content-3 font-medium">
                        Préstamos que la empresa descuenta de planilla y paga al banco.
                        {vigentes.length > 0 && ` ${vigentes.length} vigente${vigentes.length === 1 ? '' : 's'} · ${dinero(cuotaMensual)} al mes.`}
                    </p>
                </div>
                {canEdit && !editando && (
                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditando({ ...VACIA })}>Agregar orden</Button>
                )}
            </div>

            {fallo && <Notice variant="danger" compact>{fallo}</Notice>}

            {editando && (
                <EditorDeOrden
                    inicial={editando}
                    empleado={empleado}
                    onCancelar={() => setEditando(null)}
                    onGuardar={async (orden) => {
                        const nueva = !orden.id;
                        const g = await guardarOrden(empleado.id, orden);
                        appendAuditLog?.(nueva ? 'ORDEN_DESCUENTO_CREAR' : 'ORDEN_DESCUENTO_EDITAR', String(empleado.id),
                            { orden: g.id, banco: g.banco, cuota: g.cuota });
                        setEditando(null);
                        await cargar();
                    }}
                />
            )}

            {ordenes === null ? (
                <p className="text-label text-content-3">Cargando…</p>
            ) : ordenes.length === 0 && !editando ? (
                <p className="text-label text-content-3 font-medium">Sin órdenes de descuento.</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {ordenes.map(o => {
                        const f = loQueFalta(o);
                        return (
                            <div key={o.id} data-surface="card" className="p-3 flex flex-col gap-2">
                                <div className="flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-label font-black text-content truncate">{o.banco || 'Banco sin indicar'}</p>
                                        <p className="text-micro text-content-3 font-medium truncate">
                                            {o.referencia ? `Préstamo ${o.referencia} · ` : ''}{fecha(o.fecha_inicio)} → {fecha(o.fecha_fin)}
                                        </p>
                                    </div>
                                    <Badge size="sm" variant={o.estado === 'VIGENTE' ? (f.terminada ? 'warning' : 'info') : 'neutral'}>
                                        {o.estado === 'VIGENTE' ? (f.terminada ? 'Ya debió terminar' : 'Vigente') : o.estado === 'FINALIZADA' ? 'Finalizada' : 'Cancelada'}
                                    </Badge>
                                    {canEdit && (
                                        <>
                                            <Button variant="ghost" size="sm" icon={Pencil} iconOnly title="Editar" onClick={() => setEditando({ ...VACIA, ...o })} />
                                            <Button variant="ghost" size="sm" icon={Trash2} iconOnly title="Borrar" onClick={() => setABorrar(o)} />
                                        </>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <Dato rotulo={`Cuota ${o.periodicidad === 'QUINCENAL' ? 'quincenal' : 'mensual'}`} valor={dinero(o.cuota)} />
                                    <Dato rotulo="Préstamo" valor={dinero(o.monto_prestamo)} />
                                    <Dato rotulo="Tasa anual" valor={o.tasa_interes != null ? `${Number(o.tasa_interes)}%` : '—'} />
                                    <Dato rotulo="Falta" valor={f.cuotasRestantes == null ? '—'
                                        : f.cuotasRestantes === 0 ? 'Nada'
                                            : `${f.cuotasRestantes} cuota${f.cuotasRestantes === 1 ? '' : 's'}${f.saldo != null ? ` · ${dinero(f.saldo)}` : ''}`} />
                                </div>
                                {f.avance != null && o.estado === 'VIGENTE' && (
                                    <div className="h-1.5 rounded-full bg-surface-card-hover overflow-hidden" data-medida="dato"
                                        role="progressbar" aria-valuenow={Math.round(f.avance * 100)} aria-valuemin={0} aria-valuemax={100}
                                        aria-label="Avance del préstamo">
                                        <div className="h-full bg-success" style={{ width: `${Math.round(f.avance * 100)}%` }} />
                                    </div>
                                )}
                                {(o.archivos || []).length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {o.archivos.map((a, i) => (
                                            <Button key={a.url || i} variant="ghost" size="sm" icon={FileText}
                                                onClick={() => openStoredFile(a.url)}>
                                                {o.archivos.length > 1 ? `Hoja ${i + 1}` : 'Ver documento'}
                                            </Button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <ConfirmModal isOpen={!!aBorrar} onClose={() => setABorrar(null)} onConfirm={confirmarBorrar}
                title="Borrar orden de descuento"
                message={`¿Borrar la orden de ${aBorrar?.banco || 'este banco'}? Si ya terminó de pagarse, mejor márcala como finalizada para que quede el historial.`}
                confirmText="Borrar" cancelText="Cancelar" isProcessing={borrando} isDestructive />
        </div>
    );
}

function Dato({ rotulo, valor }) {
    return (
        <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-widest text-content-3 truncate">{rotulo}</p>
            <p className="text-label font-bold text-content truncate">{valor}</p>
        </div>
    );
}

function EditorDeOrden({ inicial, empleado, onCancelar, onGuardar }) {
    // Borrador por ficha y por orden: la sesión de sala se cierra sola y esto
    // se teclea mirando el papel (gate:borradores).
    const claveBorrador = `orden-descuento-${empleado.id}-${inicial.id || 'nueva'}`;
    const [f, setF] = useState(() => ({ ...inicial, ...(loadDraft(claveBorrador) || {}) }));
    useEffect(() => { saveDraft(claveBorrador, f); }, [claveBorrador, f]);
    // Fotos nuevas elegidas en esta edición (todavía sin subir).
    const [fotos, setFotos] = useState([null]);
    const [leyendo, setLeyendo] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);
    const [aviso, setAviso] = useState(null);
    const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

    const elegidas = fotos.filter(Boolean);

    const leer = async () => {
        setLeyendo(true); setFallo(null); setAviso(null);
        try {
            const campos = camposDesdeLectura(await leerOrden(elegidas));
            // Lo leído llena; lo que ya estaba escrito y el papel no trae, se queda.
            setF(prev => {
                const n = { ...prev };
                for (const [k, v] of Object.entries(campos)) if (k !== 'banco_leido' && v !== '' && v != null) n[k] = v;
                return n;
            });
            if (campos.banco_leido && !campos.banco) {
                setAviso(`El documento dice «${campos.banco_leido}» y no está en la lista de bancos: elígelo a mano o usa «Otro».`);
            }
        } catch (e) {
            setFallo(mensajeAmigable(e) || e?.message || 'No se pudo leer el documento. Llena los datos a mano.');
        } finally { setLeyendo(false); }
    };

    // ¿El papel nombra a esta persona?
    const cruce = useMemo(() => {
        if (!f.nombre_en_documento) return null;
        const [r] = cruzarConElPadron([f.nombre_en_documento], [empleado]);
        return r ? (r.empleado || r.posible ? 'coincide' : 'distinto') : null;
    }, [f.nombre_en_documento, empleado]);

    const fechasMal = f.fecha_inicio && f.fecha_fin && f.fecha_fin < f.fecha_inicio;
    const guardar = async () => {
        setGuardando(true); setFallo(null);
        try {
            const subidas = [];
            for (const a of elegidas) subidas.push(await subirFotoDeOrden(empleado.id, a));
            await onGuardar({ ...f, archivos: [...(f.archivos || []), ...subidas] });
            clearDraft(claveBorrador);
        } catch (e) {
            setFallo(mensajeAmigable(e) || e?.message || 'No se pudo guardar.');
            setGuardando(false);
        }
    };

    return (
        <div data-surface="card" className="p-3 flex flex-col gap-3 ring-2 ring-brand/45">
            <p className="text-label font-black text-content">{f.id ? 'Editar orden de descuento' : 'Nueva orden de descuento'}</p>

            <div className="flex flex-col gap-2">
                {fotos.map((foto, i) => (
                    <FileField key={i} label={fotos.length > 1 ? `Hoja ${i + 1} del documento` : 'Foto del documento'}
                        accept=".pdf,image/*" file={foto} density="sm"
                        onChange={(a) => setFotos(prev => prev.map((x, j) => j === i ? a : x))} />
                ))}
                <div className="flex flex-wrap gap-2">
                    {fotos.length < 4 && fotos[fotos.length - 1] && (
                        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setFotos(prev => [...prev, null])}>Otra hoja</Button>
                    )}
                    {elegidas.length > 0 && (
                        <Button variant="secondary" size="sm" icon={ScanText} onClick={leer} loading={leyendo} disabled={leyendo}>
                            {leyendo ? 'Leyendo…' : 'Leer los datos del documento'}
                        </Button>
                    )}
                </div>
                {(f.archivos || []).length > 0 && (
                    <p className="text-micro text-content-3 font-medium">Ya guardadas: {f.archivos.length} hoja{f.archivos.length === 1 ? '' : 's'}. Las nuevas se agregan.</p>
                )}
            </div>

            {f.nombre_en_documento && (
                <Notice variant={cruce === 'distinto' ? 'warning' : 'success'} compact icon={cruce === 'distinto' ? AlertTriangle : UserCheck}>
                    {cruce === 'distinto'
                        ? <>El documento nombra a <strong>{f.nombre_en_documento}</strong>, que no parece ser esta persona. Revísalo antes de guardar.</>
                        : <>El documento es de <strong>{f.nombre_en_documento}</strong> — coincide con la ficha.</>}
                </Notice>
            )}
            {aviso && <Notice variant="info" compact>{aviso}</Notice>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="relative z-tabs">
                    <label className={rotuloCampo('text-content-3')}>Banco</label>
                    <LiquidSelect value={f.banco || ''} onChange={(v) => set('banco', v || '')} options={BANCOS}
                        placeholder="¿Qué banco?" icon={Landmark} clearable />
                </div>
                <PortalInput label="N° de préstamo" value={f.referencia || ''} placeholder="Opcional"
                    onChange={e => set('referencia', e.target.value)} />
                <PortalInput label="Monto del préstamo" prefix="$" inputMode="decimal" maskType="DECIMAL"
                    value={f.monto_prestamo ?? ''} onChange={e => set('monto_prestamo', e.target.value)} />
                <PortalInput label="Tasa de interés (% anual)" inputMode="decimal" maskType="DECIMAL"
                    value={f.tasa_interes ?? ''} onChange={e => set('tasa_interes', e.target.value)} />
                <PortalInput label="Cuota a descontar" prefix="$" inputMode="decimal" maskType="DECIMAL"
                    value={f.cuota ?? ''} onChange={e => set('cuota', e.target.value)} />
                <div className="relative z-content">
                    <label className={rotuloCampo('text-content-3')}>Cada cuánto</label>
                    <LiquidSelect value={f.periodicidad} onChange={(v) => set('periodicidad', v || 'MENSUAL')}
                        options={PERIODICIDAD} clearable={false} />
                </div>
                <PortalInput label="Plazo (n° de cuotas)" inputMode="numeric"
                    value={f.plazo_cuotas ?? ''} onChange={e => set('plazo_cuotas', e.target.value.replace(/\D/g, ''))} />
                <div className="relative z-content">
                    <label className={rotuloCampo('text-content-3')}>Estado</label>
                    <LiquidSelect value={f.estado} onChange={(v) => set('estado', v || 'VIGENTE')} options={ESTADOS} clearable={false} />
                </div>
                <div>
                    <label className={rotuloCampo('text-content-3')}>Primera cuota</label>
                    <LiquidDatePicker value={f.fecha_inicio || ''} onChange={(v) => set('fecha_inicio', v || '')} />
                </div>
                <div>
                    <label className={rotuloCampo('text-content-3')}>Última cuota</label>
                    <LiquidDatePicker value={f.fecha_fin || ''} onChange={(v) => set('fecha_fin', v || '')} />
                    {!f.fecha_fin && f.fecha_inicio && f.plazo_cuotas && (
                        <Button variant="ghost" size="sm" className="mt-1"
                            onClick={() => set('fecha_fin', finDesdePlazo(f.fecha_inicio, Number(f.plazo_cuotas), f.periodicidad))}>
                            Calcular con el plazo
                        </Button>
                    )}
                </div>
            </div>
            {fechasMal && <Notice variant="danger" compact>La última cuota no puede ser antes de la primera.</Notice>}
            {fallo && <Notice variant="danger" compact>{fallo}</Notice>}

            <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" icon={X} onClick={() => { clearDraft(claveBorrador); onCancelar(); }} disabled={guardando}>Cancelar</Button>
                <Button variant="primary" size="sm" icon={Check} onClick={guardar} loading={guardando}
                    disabled={guardando || leyendo || fechasMal}>
                    Guardar orden
                </Button>
            </div>
        </div>
    );
}
