import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, ScanSearch, Plus, CheckCircle2, AlertTriangle, Clock, RotateCcw, Scale, Ban } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import PromptModal from '../../components/common/PromptModal';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { SkeletonText } from '../../components/common/StateViews';
import NuevaConsultaExistencia from '../../components/inventario/NuevaConsultaExistencia';
import ContarExistencia from '../../components/inventario/ContarExistencia';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { formatQty } from '@nucleo/utils/formatNumber';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';
import { aplicarMovimientoInventarioEnErp } from '@nucleo/data/requests';
import {
    crearConsultaExistencia, fetchAjusteDeConsulta, fetchConsultasExistencia,
    pedirAjusteDeConsulta, resolverConsulta, textoDeDiferencia,
} from '@nucleo/data/consultasExistencia';

/**
 * Conteo de inventario → Consultas de existencia.
 *
 * Arriba lo que le toca contar a quien mira; abajo cada consulta con el
 * resultado sala por sala. Un descuadre confirmado (no cuadró dos veces) lo
 * ajusta SÓLO quien aprueba inventario: la sala que contó no se ajusta a sí
 * misma. Lo que dice el sistema no aparece hasta que la sala terminó.
 */
const ESTADO = {
    PENDIENTE:  { texto: 'Por contar',  variant: 'neutral', icon: Clock },
    RECONTAR:   { texto: 'Recontando',  variant: 'warning', icon: RotateCcw },
    CUADRA:     { texto: 'Cuadra',      variant: 'success', icon: CheckCircle2 },
    DESCUADRE:  { texto: 'Descuadre',   variant: 'danger',  icon: AlertTriangle },
    AJUSTADA:   { texto: 'Ajustada',    variant: 'success', icon: Scale },
    SIN_AJUSTE: { texto: 'Sin ajuste',  variant: 'neutral', icon: Ban },
};

export default function TabConsultasExistencia() {
    const { user, hasPermission } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const puedePedir = hasPermission('conteo_inventario', 'can_edit');
    const puedeAjustar = hasPermission('requests_inventario', 'can_approve');

    const [consultas, setConsultas] = useState(null);
    const [nueva, setNueva] = useState(false);
    const [contando, setContando] = useState(null);
    const [ajuste, setAjuste] = useState(null);     // { consulta, sala, datos }
    const [sinAjuste, setSinAjuste] = useState(null); // { consulta, sala }
    const [trabajando, setTrabajando] = useState(false);

    const cargar = useCallback(async () => {
        const { data, error } = await fetchConsultasExistencia();
        if (error) useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error');
        setConsultas(data);
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    // Una tarjeta por producto con sus salas adentro: quien ve toda la red
    // tenía siete tarjetas iguales por consulta.
    const porContar = useMemo(() => (consultas ?? [])
        .map(c => ({ consulta: c, salas: (c.salas ?? []).filter(s => s.puedo_contar) }))
        .filter(g => g.salas.length > 0), [consultas]);
    const empleado = useCallback((id) => (employees ?? []).find(e => e.id === id), [employees]);

    const abrirAjuste = async (consulta, sala) => {
        setTrabajando(true);
        const { data, error } = await fetchAjusteDeConsulta(sala.id);
        setTrabajando(false);
        if (error) { useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error'); return; }
        setAjuste({ consulta, sala, datos: data });
    };

    const ajustar = async () => {
        const { consulta, sala, datos } = ajuste;
        setTrabajando(true);
        try {
            const { ids, error } = await pedirAjusteDeConsulta({
                consulta, sala, ajuste: datos, usuarioId: user?.id, aprobador: supervisorQueResuelve(employees),
            });
            if (error) throw error;
            const fallos = [];
            for (const id of ids) {
                const r = await aplicarMovimientoInventarioEnErp(id, 'Ajuste por consulta de existencia');
                if (!r?.ok) fallos.push(r?.error ?? 'sin respuesta');
            }
            const { error: e2 } = await resolverConsulta(sala.id, { estado: 'AJUSTADA', solicitudes: ids });
            if (e2) throw e2;
            useToastStore.getState().showToast(fallos.length ? 'Ajuste pedido' : 'Existencia ajustada',
                fallos.length
                    ? `No se pudo aplicar todavía: ${fallos[0]}. Queda en Solicitudes para reintentar.`
                    : `${consulta.nombre} en ${sala.sala}: ${textoDeDiferencia(sala)}, ya corregido.`,
                fallos.length ? 'warning' : 'success');
            setAjuste(null);
            cargar();
        } catch (e) {
            useToastStore.getState().showToast('Error', mensajeAmigable(e), 'error');
        } finally {
            setTrabajando(false);
        }
    };

    // La existencia cambió desde el conteo: se descarta este resultado y se
    // pide otro conteo a la misma sala.
    const recontar = async () => {
        const { consulta, sala } = ajuste;
        setTrabajando(true);
        const { error } = await resolverConsulta(sala.id, {
            estado: 'SIN_AJUSTE', nota: 'La existencia cambió después del conteo; se pidió otro conteo.',
        });
        const r = error ? { error } : await crearConsultaExistencia({
            producto: consulta.erp_product_id, salas: [sala.erp_sucursal_id],
            motivo: 'La existencia cambió después del conteo anterior', origen: consulta.origen,
        });
        setTrabajando(false);
        if (r.error) { useToastStore.getState().showToast('Error', mensajeAmigable(r.error), 'error'); return; }
        useToastStore.getState().showToast('Conteo pedido', `${sala.sala} recibió el aviso para volver a contar.`, 'success');
        setAjuste(null);
        cargar();
    };

    const cerrarSinAjuste = async (nota) => {
        setTrabajando(true);
        const { error } = await resolverConsulta(sinAjuste.sala.id, { estado: 'SIN_AJUSTE', nota });
        setTrabajando(false);
        if (error) { useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error'); return; }
        setSinAjuste(null);
        cargar();
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-body-sm text-content-2 max-w-2xl">
                    Pregúntale a una o varias salas cuánto tienen de un producto. Cuentan sin ver el sistema;
                    si no cuadra vuelven a contar una vez, y un descuadre lo ajusta quien aprueba inventario.
                </p>
                {puedePedir && (
                    <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Pedir conteo</Button>
                )}
            </div>

            {porContar.length > 0 && (
                <section className="space-y-2">
                    <h3 className="text-label font-black uppercase tracking-widest text-content-3">
                        Te toca contar <span className="tabular-nums">· {formatQty(porContar.length)}</span>
                    </h3>
                    <ul className="grid gap-2 lg:grid-cols-2">
                        {porContar.map(({ consulta, salas }) => (
                            <li key={consulta.id} data-surface="card" className="px-3.5 py-3 space-y-2.5">
                                <div className="min-w-0">
                                    <p className="text-body-sm font-black text-content truncate" title={consulta.nombre}>{consulta.nombre}</p>
                                    {consulta.motivo && (
                                        <p className="text-label font-bold text-content-3 truncate" title={consulta.motivo}>{consulta.motivo}</p>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {salas.map(s => {
                                        const recontar = s.estado === 'RECONTAR';
                                        return (
                                            <Button key={s.id} size="sm" variant={recontar ? 'secondary' : 'primary'}
                                                icon={recontar ? RotateCcw : ClipboardCheck} onClick={() => setContando(s.id)}
                                                title={recontar ? `${s.sala}: no cuadró, hay que volver a contar` : `Contar en ${s.sala}`}>
                                                {salas.length === 1 && !recontar ? 'Contar' : s.sala}
                                                {recontar && salas.length > 1 ? ' · recontar' : ''}
                                                {recontar && salas.length === 1 ? 'Volver a contar' : ''}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="space-y-2">
                <h3 className="text-label font-black uppercase tracking-widest text-content-3">Consultas</h3>
                {consultas == null ? (
                    <div data-surface="card" className="p-4"><SkeletonText lines={4} /></div>
                ) : consultas.length === 0 ? (
                    <div data-surface="card" className="p-8 text-center">
                        <ScanSearch size={28} className="mx-auto text-content-3 mb-2" />
                        <p className="text-body-sm font-bold text-content-3">Todavía no se pidió ningún conteo</p>
                    </div>
                ) : (
                    <ul className="grid gap-2 lg:grid-cols-2">
                        {consultas.map(c => {
                            const quien = empleado(c.pedido_por);
                            const salas = c.salas ?? [];
                            const contestaron = salas.filter(s => !['PENDIENTE', 'RECONTAR'].includes(s.estado)).length;
                            const descuadres = salas.filter(s => s.estado === 'DESCUADRE').length;
                            return (
                                <li key={c.id} data-surface="card" className="px-3.5 py-3 space-y-2.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-body-sm font-black text-content truncate" title={c.nombre}>{c.nombre}</p>
                                            <p className="text-label font-bold text-content-3 flex items-center gap-1.5 min-w-0">
                                                {quien && <AvatarConEstado emp={quien} px={18} radio="rounded-full" marco="" />}
                                                <span className="truncate">
                                                    {quien ? shortEmployeeName(quien) : 'Sistema'}
                                                    {c.pedido_desde ? ` · ${c.pedido_desde}` : ''} · {fechaNumerica(c.created_at)}
                                                </span>
                                            </p>
                                        </div>
                                        <Badge size="sm" uppercase={false}
                                            variant={descuadres ? 'danger' : contestaron === salas.length ? 'success' : 'neutral'}
                                            icon={descuadres ? AlertTriangle : contestaron === salas.length ? CheckCircle2 : Clock}>
                                            {descuadres
                                                ? `${formatQty(descuadres)} con descuadre`
                                                : `${formatQty(contestaron)} de ${formatQty(salas.length)} contaron`}
                                        </Badge>
                                    </div>
                                    {c.motivo && <p className="text-label font-bold text-content-2">{c.motivo}</p>}
                                    <ul className="grid gap-x-4 sm:grid-cols-2 border-t border-divider">
                                        {salas.map(s => (
                                            <FilaDeSala key={s.id} sala={s} puedeAjustar={puedeAjustar} trabajando={trabajando}
                                                onAjustar={() => abrirAjuste(c, s)}
                                                onSinAjuste={() => setSinAjuste({ consulta: c, sala: s })} />
                                        ))}
                                    </ul>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            {nueva && <NuevaConsultaExistencia onCerrar={() => setNueva(false)} onCreada={cargar} />}
            {contando && <ContarExistencia salaId={contando} onCerrar={() => setContando(null)} onContada={cargar} />}

            {ajuste && (ajuste.datos?.cambio || !ajuste.datos?.exacto) ? (
                <ConfirmModal isOpen onClose={() => setAjuste(null)} isDestructive={false} isProcessing={trabajando}
                    title={ajuste.datos.cambio ? 'La existencia cambió' : 'No se puede ajustar exacto'}
                    message={ajuste.datos.cambio
                        ? `Desde que ${ajuste.sala.sala} contó, la existencia de ${ajuste.consulta.nombre} se movió (una venta o una entrada). Ajustar con ese conteo descuadraría lo que ya estaba bien. ¿Pedimos que vuelvan a contar?`
                        : `La diferencia no se puede escribir en las presentaciones activas de ${ajuste.consulta.nombre}. Hazlo desde Solicitudes de inventario.`}
                    confirmText={ajuste.datos.cambio ? 'Pedir otro conteo' : 'Entendido'}
                    onConfirm={ajuste.datos.cambio ? recontar : () => setAjuste(null)} />
            ) : ajuste && (
                <ConfirmModal isOpen onClose={() => setAjuste(null)} isDestructive={false} isProcessing={trabajando}
                    title={`Ajustar ${ajuste.sala.sala}`}
                    message={`${ajuste.consulta.nombre}: la sala contó ${formatQty(ajuste.datos.contado)} unidades `
                        + `y el sistema dice ${formatQty(ajuste.datos.sistema)}. Se `
                        + (ajuste.datos.lineas ?? []).map(l => `${l.sentido === 'carga' ? 'cargan' : 'descartan'} `
                            + `${formatQty(l.cantidad)} ${String(l.tipo).toLowerCase()}${l.lote ? ` del lote ${l.lote}` : ''}`).join(' y se ')
                        + '.'}
                    confirmText="Ajustar" onConfirm={ajustar} />
            )}

            <PromptModal isOpen={!!sinAjuste} onClose={() => setSinAjuste(null)} onConfirm={cerrarSinAjuste}
                title="Cerrar sin ajustar" required isProcessing={trabajando}
                message={sinAjuste ? `${sinAjuste.consulta.nombre} en ${sinAjuste.sala.sala}: ¿por qué no se ajusta?` : ''}
                placeholder="Ej.: se encontró el producto en otro estante" confirmText="Cerrar" />
        </div>
    );
}

function FilaDeSala({ sala: s, puedeAjustar, trabajando, onAjustar, onSinAjuste }) {
    const est = ESTADO[s.estado] ?? ESTADO.PENDIENTE;
    const final = s.final;
    return (
        <li className={`py-2 border-b border-divider flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 ${s.estado === 'DESCUADRE' ? 'sm:col-span-2' : ''}`}>
            <div className="min-w-0">
                <p className="text-body-sm font-bold text-content truncate">{s.sala}</p>
                {final && (
                    <p className="text-label text-content-3 tabular-nums">
                        Contó {formatQty(final.contado)} · sistema {formatQty(final.sistema)}
                        {s.diferencia ? ` · ${textoDeDiferencia(s)}` : ''}
                        {s.recontada ? ' · contado dos veces' : ''}
                    </p>
                )}
                {s.nota && <p className="text-label text-content-3">{s.nota}</p>}
            </div>
            <div className="flex items-center gap-2">
                <Badge size="sm" uppercase={false} variant={est.variant} icon={est.icon}>{est.texto}</Badge>
                {s.estado === 'DESCUADRE' && puedeAjustar && (
                    <>
                        <Button variant="primary" size="sm" icon={Scale} disabled={trabajando} onClick={onAjustar}>Ajustar</Button>
                        <Button variant="ghost" size="sm" disabled={trabajando} onClick={onSinAjuste}>Sin ajuste</Button>
                    </>
                )}
            </div>
        </li>
    );
}
