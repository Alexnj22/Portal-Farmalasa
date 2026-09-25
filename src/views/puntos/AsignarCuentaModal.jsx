/**
 * Asignar una cuenta del sistema anterior a una ficha.
 *
 * Es el momento del reclamo: un cliente dice que tenía puntos y su cuenta vieja
 * no pasó sola. Quien atiende ve la cuenta, ve fichas que PODRÍAN ser suyas
 * (mismo teléfono o nombre parecido) o busca la correcta, elige, escribe por
 * qué y confirma. La cuenta pasa con todo su historial y los puntos se SUMAN a
 * los que la ficha ya tenga.
 *
 * Nada se elige solo (decisión del usuario, 2026-09-25) y el DUI de la cuenta
 * vieja nunca se copia a la ficha: 280 de esas cuentas tienen un DUI mal
 * escrito, y el de la ficha viaja a los documentos fiscales.
 */
import React, { useState, useEffect } from 'react';
import { UserSearch, Phone, Check, Loader2, History } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import SearchInput from '../../components/common/SearchInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { clickable } from '../../utils/clickable';
import { formatMoney, formatQty } from '../../utils/formatNumber';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchFichasCandidatas, asignarCuentaAnterior, QUE_HACER_POR_MOTIVO } from '../../data/puntos';

const pts = (n) => formatQty(Number(n) || 0);
const dolares = (n) => formatMoney((Number(n) || 0) / 100);

export default function AsignarCuentaModal({ open, cuenta, puedeAsignar, onClose, onAsignada }) {
    if (!cuenta) return null;
    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-2xl"
            ariaLabel={`Asignar la cuenta ${cuenta.id_cliente}`}>
            <Cuerpo key={cuenta.id_cliente} cuenta={cuenta} puedeAsignar={puedeAsignar}
                onClose={onClose} onAsignada={onAsignada} />
        </LiquidModal>
    );
}

function Cuerpo({ cuenta, puedeAsignar, onClose, onAsignada }) {
    const showToast = useToastStore((s) => s.showToast);
    const [termino, setTermino] = useState('');
    const [fichas, setFichas] = useState([]);
    const [buscando, setBuscando] = useState(true);
    const [elegida, setElegida] = useState(null);
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);

    // Sin término: las sugeridas. Con término: lo que se escriba, con una
    // pausa para no preguntar en cada tecla.
    useEffect(() => {
        let vivo = true;
        const t = setTimeout(async () => {
            setBuscando(true);
            try {
                const q = termino.trim();
                const r = await fetchFichasCandidatas(cuenta.id_cliente, q.length >= 3 ? q : null);
                if (vivo) setFichas(r ?? []);
            } catch (e) {
                if (vivo) showToast('No se pudo buscar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setBuscando(false);
            }
        }, termino ? 350 : 0);
        return () => { vivo = false; clearTimeout(t); };
    }, [termino, cuenta.id_cliente, showToast]);

    const ficha = fichas.find((f) => f.id === elegida) ?? null;
    const listo = puedeAsignar && ficha && nota.trim().length >= 5 && !guardando;

    const asignar = async () => {
        setGuardando(true);
        try {
            const r = await asignarCuentaAnterior({
                idCliente: cuenta.id_cliente, customerId: ficha.id, nota: nota.trim(), simular: false,
            });
            if (!r?.ok) throw new Error(r?.error || 'No se pudo asignar');
            useStaff.getState().appendAuditLog?.('ASIGNAR_CUENTA_PUNTOS', String(ficha.id), {
                cuenta_anterior: cuenta.id_cliente, puntos: r.puntos, nota: nota.trim(),
            });
            showToast('Cuenta asignada',
                `${pts(r.puntos)} puntos pasaron a ${ficha.nombre}. Su saldo quedó en ${pts(r.saldo_despues)}.`,
                'success');
            onAsignada(cuenta.id_cliente);
        } catch (e) {
            showToast('No se pudo asignar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                        <History size={18} className="text-brand-text shrink-0" />
                        <h2 className="text-title font-black text-content truncate">
                            Cuenta {cuenta.id_cliente} del sistema anterior
                        </h2>
                    </div>
                    <p className="text-caption text-content-3 mt-1">{cuenta.motivo}</p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="flex flex-col gap-5">
                    <div data-surface="card" className="p-4 grid grid-cols-2 gap-3 text-body">
                        <Dato rotulo="Nombre" valor={cuenta.nombre || 'Sin nombre'} />
                        <Dato rotulo="Puntos" valor={`${pts(cuenta.saldo)} (${dolares(cuenta.saldo)})`} />
                        <Dato rotulo="DUI" valor={cuenta.dui || '—'} />
                        <Dato rotulo="Teléfono" valor={cuenta.telefono || '—'} />
                    </div>

                    {QUE_HACER_POR_MOTIVO[cuenta.motivo] && (
                        <Notice variant="info" bloque>{QUE_HACER_POR_MOTIVO[cuenta.motivo]}</Notice>
                    )}

                    <div className="flex flex-col gap-3">
                        <span className="text-caption font-bold text-content-2">¿A qué ficha van estos puntos?</span>
                        <SearchInput value={termino} onChange={setTermino} loading={buscando}
                            placeholder="Buscar ficha por nombre, DUI o teléfono…"
                            ariaLabel="Buscar ficha" />
                        {!buscando && fichas.length === 0 && (
                            <p className="text-caption text-content-3">
                                {termino.trim()
                                    ? 'Ninguna ficha coincide.'
                                    : 'No hay fichas con el mismo teléfono ni un nombre parecido. Busca la ficha arriba.'}
                            </p>
                        )}
                        <div className="flex flex-col gap-2">
                            {fichas.map((f) => {
                                const activa = f.id === elegida;
                                return (
                                    <div key={f.id} data-surface="card"
                                        {...clickable(() => setElegida(activa ? null : f.id), { label: `Elegir la ficha de ${f.nombre}` })}
                                        className={`p-3 flex items-center gap-3 min-h-[var(--tap-min)] ${activa ? 'ring-2 ring-brand/45' : ''}`}>
                                        <span className={`shrink-0 ${activa ? 'text-brand-text' : 'text-content-3'}`}>
                                            {activa ? <Check size={18} /> : <UserSearch size={18} />}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-content truncate">{f.nombre}</p>
                                            <p className="text-caption text-content-3 tabular-nums">
                                                DUI {f.dui || 'sin cargar'} · {f.telefono || 'sin teléfono'}
                                                {f.saldo_actual != null && ` · ya tiene ${pts(f.saldo_actual)} puntos`}
                                            </p>
                                        </div>
                                        {f.por_telefono && (
                                            <Badge variant="success" tone="soft" uppercase={false} icon={Phone}>Mismo teléfono</Badge>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {puedeAsignar ? (
                        <PortalTextarea label="Por qué se asigna" name="nota_asignacion" rows={2} required
                            value={nota} onChange={(e) => setNota(e.target.value)}
                            placeholder="Ej.: el cliente reclamó en Salud 2 y mostró su DUI"
                            helperText="Queda registrado junto con tu nombre." />
                    ) : (
                        <Notice variant="warning" bloque>No tienes permiso para asignar cuentas de puntos.</Notice>
                    )}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                    <p className="text-caption text-content-3 min-w-0 flex-1">
                        {!ficha
                            ? 'Elige una ficha.'
                            : nota.trim().length < 5
                                ? 'Escribe por qué se asigna.'
                                : `Los ${pts(cuenta.saldo)} puntos se suman a los de ${ficha.nombre}.`}
                    </p>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                        {puedeAsignar && (
                            <Button variant="primary" icon={guardando ? Loader2 : Check}
                                disabled={!listo} onClick={asignar}>
                                Asignar puntos
                            </Button>
                        )}
                    </div>
                </div>
            </LiquidModal.Footer>
        </>
    );
}

function Dato({ rotulo, valor }) {
    return (
        <div className="min-w-0">
            <p className="text-caption text-content-3">{rotulo}</p>
            <p className="font-bold text-content truncate tabular-nums">{valor}</p>
        </div>
    );
}
