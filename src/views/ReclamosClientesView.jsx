/**
 * Reclamos de clientes (2026-10-24).
 *
 * Los tres reglamentos —Puntos Salud §12, Reservas §10 y Cliente Mayorista §7—
 * dicen que el reclamo se presenta en cualquier sala de ventas, que ahí «queda
 * registrado» y que la Empresa responde en diez días hábiles. No había dónde
 * registrarlo, así que el plazo no se podía contar ni probar.
 *
 *   · La sala registra (quien edita el módulo): sobre qué es, quién reclama y
 *     de qué se trata. Quien es de una sala sólo registra en la suya (lo frena
 *     la base); quien es de toda la red elige la sala.
 *   · Quien aprueba el módulo responde, con la vía por la que se le contestó.
 *   · La base avisa al registrarse, un día hábil antes de vencer y al vencer.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquareWarning, Inbox, CheckCircle2, Plus, Check } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import LiquidModal from '../components/common/LiquidModal';
import LiquidSelect from '../components/common/LiquidSelect';
import PortalInput from '../components/common/PortalInput';
import PortalTextarea from '../components/common/PortalTextarea';
import SegmentedControl from '../components/common/SegmentedControl';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import PersonaConFoto from '../components/caja/PersonaConFoto';
import usePestanaEnUrl from '../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import {
    PROGRAMAS, ROTULO_PROGRAMA, VIAS, ROTULO_VIA, plazoDeReclamo, respondidoATiempo,
    fetchReclamos, registrarReclamo, responderReclamo,
} from '@nucleo/data/reclamos';

const PESTANAS = [
    { key: 'abiertos', label: 'Por responder', icon: Inbox },
    { key: 'respondidos', label: 'Respondidos', icon: CheckCircle2 },
];

const COLUMNAS = [
    { key: 'folio', label: 'N.º' },
    { key: 'cliente', label: 'Cliente' },
    { key: 'tema', label: 'Reclamo' },
    { key: 'sala', label: 'Sala', hideBelow: 'md' },
    { key: 'recibido', label: 'Recibido', hideBelow: 'sm' },
    { key: 'plazo', label: 'Plazo' },
];

const dia = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function EstadoDelPlazo({ r }) {
    if (r.respondido_at) {
        const a = respondidoATiempo(r);
        return <Badge variant={a ? 'success' : 'warning'} uppercase={false}>{a ? 'A tiempo' : 'Fuera de plazo'}</Badge>;
    }
    const p = plazoDeReclamo(r);
    return (
        <Badge variant={p.vencido ? 'danger' : p.apremia ? 'warning' : 'neutral'} uppercase={false}>
            {p.vencido ? `Vencido hace ${Math.abs(p.restan)} d.h.` : `${p.restan} d. hábiles`}
        </Badge>
    );
}

export default function ReclamosClientesView() {
    const { user, hasPermission, getScope } = useAuth();
    const puedeRegistrar = hasPermission('reclamos_clientes', 'can_edit');
    const puedeResponder = hasPermission('reclamos_clientes', 'can_approve');
    const deTodaLaRed = getScope('reclamos_clientes') === 'ALL';
    const showToast = useToastStore((s) => s.showToast);
    const [pestana, setPestana] = usePestanaEnUrl(PESTANAS, 'abiertos');
    const [busqueda, setBusqueda] = useState('');
    const [filas, setFilas] = useState(null);
    const [nuevo, setNuevo] = useState(false);
    const [abierto, setAbierto] = useState(null);

    useEffect(() => {
        let vivo = true;
        fetchReclamos()
            .then((d) => { if (vivo) setFilas(d); })
            .catch((e) => { if (vivo) { setFilas([]); showToast('No se pudo cargar', mensajeAmigable(e), 'error'); } });
        return () => { vivo = false; };
    }, [showToast]);

    const visibles = useMemo(() => (filas ?? []).filter((r) => {
        if (pestana === 'abiertos' ? r.respondido_at : !r.respondido_at) return false;
        const q = busqueda.trim();
        return !q || tokenMatch(q, String(r.folio), r.cliente_nombre, r.cliente_telefono, r.tema, r.sala?.name);
    }), [filas, pestana, busqueda]);

    const vencidos = (filas ?? []).filter((r) => plazoDeReclamo(r)?.vencido).length;
    const reemplazar = (fila) => setFilas((p) => [fila, ...(p ?? []).filter((x) => x.id !== fila.id)]
        .sort((a, b) => String(b.recibido_at).localeCompare(String(a.recibido_at))));

    return (
        <GlassViewLayout icon={MessageSquareWarning} title="Reclamos de clientes" filtersContent={(
            <ViewTabBar tabs={PESTANAS} activeTab={pestana} onTabChange={setPestana}
                searchValue={busqueda} onSearchChange={setBusqueda} placeholder="Buscar por cliente, número o tema…" />
        )}>
            <div className="p-4 md:p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-body-sm text-content-3 max-w-2xl">
                        Los reclamos sobre Puntos Salud, las reservas o la condición de Cliente Mayorista se registran en la
                        sala donde se presentan, y hay diez días hábiles para responderlos.
                    </p>
                    {puedeRegistrar && <Button icon={Plus} onClick={() => setNuevo(true)}>Registrar reclamo</Button>}
                </div>

                {vencidos > 0 && (
                    <Notice variant="danger">
                        {vencidos === 1 ? 'Un reclamo pasó' : `${vencidos} reclamos pasaron`} de los diez días hábiles sin respuesta.
                    </Notice>
                )}

                <DataTable columns={COLUMNAS} loading={filas === null} minWidth="760px"
                    movil={{ usarAccionDeFila: true }}
                    empty={{ icon: Inbox, message: pestana === 'abiertos' ? 'No hay reclamos por responder' : 'Sin reclamos respondidos' }}>
                    {visibles.map((r, i) => (
                        <DataRow key={r.id} index={i} onClick={() => setAbierto(r)}>
                            <DataCell><span className="font-black tabular-nums text-content">{r.folio}</span></DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content">{r.cliente_nombre}</span>
                                <span className="block text-caption text-content-3">{ROTULO_PROGRAMA[r.programa]}</span>
                            </DataCell>
                            <DataCell><span className="text-body-sm text-content-2 line-clamp-2">{r.tema}</span></DataCell>
                            <DataCell>{r.sala?.name ?? '—'}</DataCell>
                            <DataCell>{dia(r.recibido_at)}</DataCell>
                            <DataCell><EstadoDelPlazo r={r} /></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            </div>

            {nuevo && (
                <Registrar deTodaLaRed={deTodaLaRed} salaPropia={user?.branchId ?? null}
                    onClose={() => setNuevo(false)}
                    onListo={(fila) => { reemplazar(fila); setNuevo(false); showToast('Reclamo registrado', `Hay que responder a más tardar el ${dia(fila.vence)}`, 'success'); }} />
            )}
            {abierto && (
                <Detalle r={abierto} puedeResponder={puedeResponder} onClose={() => setAbierto(null)}
                    onListo={(fila) => { reemplazar({ ...abierto, ...fila }); setAbierto(null); showToast('Respuesta guardada', '', 'success'); }} />
            )}
        </GlassViewLayout>
    );
}

function Registrar({ deTodaLaRed, salaPropia, onClose, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const branches = useStaff((s) => s.branches);
    const [programa, setPrograma] = useState('puntos');
    const [sala, setSala] = useState(salaPropia);
    const [nombre, setNombre] = useState('');
    const [telefono, setTelefono] = useState('');
    const [tema, setTema] = useState('');
    const [ocupado, setOcupado] = useState(false);
    // Las salas salen de la tabla, con el nombre de la fila (regla del catálogo).
    const opcionesSala = useMemo(() => (branches ?? []).map((b) => ({ value: b.id, label: b.name })), [branches]);

    const guardar = async () => {
        setOcupado(true);
        try {
            const fila = await registrarReclamo({ programa, branchId: sala, tema, nombre, telefono: telefono || null });
            const b = (branches ?? []).find((x) => x.id === fila.branch_id);
            onListo({ ...fila, sala: b ? { id: b.id, name: b.name } : null });
        } catch (e) {
            showToast('No se pudo registrar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setOcupado(false); }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-xl" ariaLabel="Registrar reclamo">
            <LiquidModal.Header titulo="Registrar reclamo" onClose={onClose} />
            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    <SegmentedControl label="Sobre qué es" value={programa} onChange={setPrograma} options={PROGRAMAS} />
                    {deTodaLaRed ? (
                        <div>
                            <span className="text-caption font-bold text-content-2 block mb-1.5">Sala donde se presenta</span>
                            <LiquidSelect value={sala} onChange={setSala} options={opcionesSala} placeholder="¿En qué sala?" />
                        </div>
                    ) : null}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <PortalInput label="Nombre de quien reclama" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                        <PortalInput label="Teléfono" maskType="PHONE" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                    </div>
                    <PortalTextarea label="De qué se trata" rows={4} maxLength={1000} value={tema} onChange={(e) => setTema(e.target.value)} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button icon={Check} loading={ocupado} disabled={!sala || !nombre.trim() || !tema.trim()} onClick={guardar}>Registrar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function Detalle({ r, puedeResponder, onClose, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [respuesta, setRespuesta] = useState('');
    const [via, setVia] = useState('SALA');
    const [ocupado, setOcupado] = useState(false);
    const plazo = plazoDeReclamo(r);

    const guardar = async () => {
        setOcupado(true);
        try { onListo(await responderReclamo(r.id, respuesta, via)); }
        catch (e) { showToast('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error'); }
        finally { setOcupado(false); }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-xl" ariaLabel={`Reclamo ${r.folio}`}>
            <LiquidModal.Header titulo={<>Reclamo {r.folio} · {r.cliente_nombre}</>}
                subtitulo={[ROTULO_PROGRAMA[r.programa], r.sala?.name, r.cliente_telefono].filter(Boolean).join(' · ')}
                acciones={<EstadoDelPlazo r={r} />} onClose={onClose} />
            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    <p className="text-body text-content whitespace-pre-line">{r.tema}</p>
                    <div className="flex flex-wrap items-center gap-2 text-body-sm text-content-2">
                        <span>Lo recibió</span>
                        <PersonaConFoto id={r.recibido_por} nombre={r.recibio ? shortEmployeeName(r.recibio) : null} px={22}
                            detalle={dia(r.recibido_at)} />
                    </div>
                    {r.respondido_at ? (
                        <section className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
                            <p className="text-body-sm text-content whitespace-pre-line">{r.respuesta}</p>
                            <div className="flex flex-wrap items-center gap-2 text-caption text-content-3">
                                <span>{ROTULO_VIA[r.respuesta_via]}</span>
                                <PersonaConFoto id={r.respondido_por} nombre={r.respondio ? shortEmployeeName(r.respondio) : null} px={20}
                                    detalle={dia(r.respondido_at)} />
                            </div>
                        </section>
                    ) : puedeResponder ? (
                        <section className="flex flex-col gap-3">
                            {plazo && (
                                <Notice variant={plazo.vencido ? 'danger' : 'info'} compact>
                                    Vence el {dia(r.vence)}.
                                </Notice>
                            )}
                            <PortalTextarea label="Respuesta que se le dio" rows={4} maxLength={2000}
                                value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
                            <SegmentedControl label="Por dónde se le respondió" value={via} onChange={setVia} options={VIAS} />
                        </section>
                    ) : (
                        <Notice variant="info" compact>Lo responde administración a más tardar el {dia(r.vence)}.</Notice>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                {!r.respondido_at && puedeResponder && (
                    <Button icon={Check} loading={ocupado} disabled={!respuesta.trim()} onClick={guardar}>Guardar la respuesta</Button>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
