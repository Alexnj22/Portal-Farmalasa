import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag, Plus, Image as ImageIcon, Eye, EyeOff, Trash2, Pencil, UserPlus, Link2, XCircle, Smartphone, CircleDashed, ShoppingBag } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import FileField from '../../components/common/FileField';
import Switch from '../../components/common/Switch';
import ConfirmModal from '../../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import OfertaModal from './OfertaModal';
import HistoriasPanel from './HistoriasPanel';
import WidgetReservas from '../dashboard/WidgetReservas';
import { estadoDeOferta, etiquetaDeDescuento } from '@nucleo/utils/ofertasClientes';
import { LoadingState, EmptyState } from '../../components/common/StateViews';
import usePestanaEnUrl from '../../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import {
    fetchOfertas, fetchSalas, publicarOferta, borrarOferta,
    fetchPreregistros, resolverPreregistro, buscarFichasPorDocumento,
} from '@nucleo/data/ofertasClientes';

/**
 * Ofertas para clientes — lo que ve el cliente en la pestaña «Ofertas» de la
 * app Puntos Salud. Y los pre-registros: quien se unió desde la app y todavía
 * no tiene ficha.
 *
 * Una oferta se ve en la app si está PUBLICADA y hoy está entre su inicio y su
 * fin. Las EXCLUSIVAS se anuncian a todos, pero el detalle sólo lo ven los
 * socios del programa de puntos.
 *
 * Un pre-registro se vincula SOLO cuando la sala crea la ficha con el mismo
 * documento y teléfono: la app lo reconoce en su siguiente consulta. Esta
 * pestaña existe para los que no coinciden (escribió mal el teléfono, o la
 * ficha ya existía con otro) y para descartar los que no son nadie.
 */
// El estado de una oferta: núcleo (`estadoDeOferta`), el mismo de la app.

export default function OfertasClientesView() {
    const { hasPermission } = useAuth();
    const puedeEditar = hasPermission('ofertas_clientes', 'can_edit');
    const veClientes = hasPermission('clientes', 'can_view');
    const showToast = useToastStore((s) => s.showToast);

    const tabs = useMemo(() => [
        { key: 'ofertas', label: 'Ofertas', icon: Tag },
        { key: 'historias', label: 'Historias', icon: CircleDashed },
        ...(puedeEditar ? [{ key: 'reservas', label: 'Reservas', icon: ShoppingBag }] : []),
        ...(veClientes ? [{ key: 'preregistros', label: 'Pre-registros', icon: UserPlus }] : []),
    ], [veClientes, puedeEditar]);
    const [tab, setTab] = usePestanaEnUrl(tabs, 'ofertas');
    const [busqueda, setBusqueda] = useState('');

    return (
        <GlassViewLayout icon={Smartphone} title="Ofertas para clientes" filtersContent={(
            <ViewTabBar tabs={tabs} activeTab={tab} onTabChange={setTab}
                searchValue={busqueda} onSearchChange={setBusqueda}
                placeholder={tab === 'ofertas' ? 'Buscar oferta…' : tab === 'historias' ? 'Buscar historia…' : 'Buscar por nombre o documento…'} />
        )} transparentBody>
            <div className="p-4 md:p-6 space-y-6">
                {tab === 'preregistros'
                    ? <Preregistros busqueda={busqueda} puedeEditar={hasPermission('clientes', 'can_edit')} showToast={showToast} />
                    : tab === 'reservas'
                        ? <WidgetReservas todas />
                    : tab === 'historias'
                        ? <HistoriasPanel busqueda={busqueda} puedeEditar={puedeEditar} showToast={showToast} />
                        : <Ofertas busqueda={busqueda} puedeEditar={puedeEditar} showToast={showToast} />}
            </div>
        </GlassViewLayout>
    );
}

// ── Ofertas ─────────────────────────────────────────────────────────────────

function Ofertas({ busqueda, puedeEditar, showToast }) {
    const [ofertas, setOfertas] = useState(null);
    const [salas, setSalas] = useState([]);
    const [error, setError] = useState(null);
    const [fEstado, setFEstado] = useState('');
    const [editando, setEditando] = useState(null); // {} = nueva
    const [borrando, setBorrando] = useState(null);
    const hoy = hoySV();

    const cargar = useCallback(async () => {
        try {
            const [o, s] = await Promise.all([fetchOfertas(), fetchSalas()]);
            setOfertas(o);
            setSalas(s);
            setError(null);
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar las ofertas.'));
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial

    const nombreSala = useMemo(() => new Map(salas.map((s) => [s.id, s.name])), [salas]);
    const filas = useMemo(() => (ofertas ?? [])
        .filter((o) => !fEstado || estadoDeOferta(o, hoy).key === fEstado)
        .filter((o) => !busqueda || tokenMatch(busqueda, o.titulo, o.etiqueta ?? '')), [ofertas, fEstado, busqueda, hoy]);

    const alternar = async (o) => {
        try {
            await publicarOferta(o.id, !o.publicada);
            showToast(o.publicada ? 'Oferta retirada' : 'Oferta publicada',
                o.publicada ? 'Ya no se ve en la app.' : 'Se ve en la app durante sus fechas.', 'success');
            cargar();
        } catch (err) {
            showToast('No se pudo cambiar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    const acciones = puedeEditar ? [{
        key: 'nueva', icon: Plus, label: 'Nueva oferta', title: 'Crear una oferta para la app', rotulo: 'Nueva',
        variant: 'primary', onClick: () => setEditando({}),
    }] : [];

    if (error) return <Notice variant="danger">{error}</Notice>;
    if (!ofertas) return <LoadingState label="Cargando ofertas" />;

    return (
        <>
            <div className="flex justify-end">
                <FilterBar acciones={acciones} activeCount={fEstado ? 1 : 0} onClear={fEstado ? () => setFEstado('') : undefined}>
                    <FilterBar.Section label="estado" active={!!fEstado} onClear={() => setFEstado('')}>
                        <FilterBar.Opciones value={fEstado} onChange={(v) => setFEstado(v || '')} label="Estado" placeholder="Estado" umbral={0}
                            options={[{ value: '', label: 'Estado' }, { value: 'vigente', label: 'En la app' },
                                { value: 'programada', label: 'Programada' }, { value: 'borrador', label: 'Sin publicar' },
                                { value: 'terminada', label: 'Terminada' }]} />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            <DataTable
                columns={[
                    { key: 'oferta', label: 'Oferta' },
                    { key: 'estado', label: 'Estado' },
                    { key: 'fechas', label: 'Fechas', hideBelow: 'sm' },
                    { key: 'salas', label: 'Salas', hideBelow: 'md' },
                    ...(puedeEditar ? [{ key: 'acciones', label: '', align: 'right' }] : []),
                ]}
                movil={{ usarAccionDeFila: true, acciones: 'mantener' }}
                empty={{ icon: Tag, message: 'Sin ofertas con ese filtro' }}
                minWidth="640px">
                {filas.map((o, i) => {
                    const est = estadoDeOferta(o, hoy);
                    return (
                        <DataRow key={o.id} index={i} onClick={puedeEditar ? () => setEditando(o) : undefined}>
                            <DataCell>
                                <div className="flex items-center gap-3 min-w-0">
                                    {o.imagen_url
                                        ? <img src={o.imagen_url} alt="" className="w-14 h-8 object-cover rounded-md shrink-0" />
                                        : <span className="w-14 h-8 rounded-md bg-surface-card-hover grid place-items-center shrink-0"><ImageIcon size={14} className="text-content-3" /></span>}
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-semibold text-content truncate">{o.titulo}</p>
                                        <p className="text-micro text-content-3 truncate">
                                            {[o.etiqueta, o.descuento_tipo ? `Descuento ${etiquetaDeDescuento(o.descuento_tipo, o.descuento_monto)}` : null,
                                                o.exclusiva ? 'Exclusiva para socios' : null].filter(Boolean).join(' · ') || '—'}
                                        </p>
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell><Badge variant={est.variant}>{est.label}</Badge></DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content-2">
                                    {fechaTexto(o.inicio, { day: 'numeric', month: 'short' })} – {fechaTexto(o.fin, { day: 'numeric', month: 'short' })}
                                </span>
                            </DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content-2">
                                    {o.branch_ids?.length ? o.branch_ids.map((id) => nombreSala.get(id)).filter(Boolean).join(', ') : 'Todas'}
                                </span>
                            </DataCell>
                            {puedeEditar && (
                                <DataCell align="right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" iconOnly icon={o.publicada ? EyeOff : Eye}
                                            title={o.publicada ? 'Retirar de la app' : 'Publicar en la app'}
                                            onClick={(e) => { e.stopPropagation(); alternar(o); }} />
                                        <Button variant="ghost" iconOnly icon={Pencil} title="Editar"
                                            onClick={(e) => { e.stopPropagation(); setEditando(o); }} />
                                        <Button variant="ghost" iconOnly icon={Trash2} title="Borrar"
                                            onClick={(e) => { e.stopPropagation(); setBorrando(o); }} />
                                    </div>
                                </DataCell>
                            )}
                        </DataRow>
                    );
                })}
            </DataTable>
            {editando && (
                <OfertaModal oferta={editando} salas={salas} onClose={() => setEditando(null)}
                    onGuardada={() => { setEditando(null); cargar(); showToast('Oferta guardada', '', 'success'); }}
                    onError={(err) => showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error')} />
            )}
            {borrando && (
                <ConfirmModal isOpen title="Borrar oferta" message={`«${borrando.titulo}» deja de verse en la app y se borra su imagen.`}
                    confirmText="Borrar" onClose={() => setBorrando(null)}
                    onConfirm={async () => {
                        try {
                            await borrarOferta(borrando);
                            setBorrando(null);
                            cargar();
                        } catch (err) {
                            showToast('No se pudo borrar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
                        }
                    }} />
            )}
        </>
    );
}

// ── Pre-registros ───────────────────────────────────────────────────────────

function Preregistros({ busqueda, puedeEditar, showToast }) {
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const [abierto, setAbierto] = useState(null);

    const cargar = useCallback(async () => {
        try {
            setFilas(await fetchPreregistros('pendiente'));
            setError(null);
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar los pre-registros.'));
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial

    const visibles = useMemo(() => (filas ?? [])
        .filter((p) => !busqueda || tokenMatch(busqueda, p.nombre, p.documento, p.telefono)), [filas, busqueda]);

    if (error) return <Notice variant="danger">{error}</Notice>;
    if (!filas) return <LoadingState label="Cargando pre-registros" />;

    return (
        <>
            <Notice variant="info">
                Se unieron desde la app y todavía no tienen ficha. Cuando la sala los registra con el mismo documento y
                teléfono, la app los reconoce sola. Aquí quedan los que no coincidieron.
            </Notice>
            {visibles.length === 0 ? (
                <EmptyState icon={UserPlus} title="Sin pre-registros pendientes" />
            ) : (
                <DataTable
                    columns={[
                        { key: 'nombre', label: 'Nombre' },
                        { key: 'documento', label: 'Documento' },
                        { key: 'telefono', label: 'Teléfono', hideBelow: 'sm' },
                        { key: 'fecha', label: 'Se unió', hideBelow: 'md' },
                    ]}
                    movil={{ usarAccionDeFila: true }}
                    minWidth="560px">
                    {visibles.map((p, i) => (
                        <DataRow key={p.id} index={i} onClick={puedeEditar ? () => setAbierto(p) : undefined}>
                            <DataCell><span className="text-body-sm font-semibold text-content">{p.nombre}</span></DataCell>
                            <DataCell><span className="text-body-sm text-content-2 tabular-nums">{p.documento}</span></DataCell>
                            <DataCell><span className="text-body-sm text-content-2 tabular-nums">{p.telefono}</span></DataCell>
                            <DataCell><span className="text-body-sm text-content-3">{fechaTexto(p.created_at, { day: 'numeric', month: 'short' })}</span></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            )}
            {abierto && (
                <ResolverModal pre={abierto} onClose={() => setAbierto(null)}
                    onListo={(msg) => { setAbierto(null); cargar(); showToast(msg, '', 'success'); }}
                    onError={(err) => showToast('No se pudo completar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error')} />
            )}
        </>
    );
}

/**
 * Vincular busca la ficha por el MISMO documento —nunca por el nombre— y la
 * base vuelve a comprobarlo (`DOCUMENTO_NO_COINCIDE`).
 */
function ResolverModal({ pre, onClose, onListo, onError }) {
    const [fichas, setFichas] = useState(null);
    const [ocupado, setOcupado] = useState(false);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const data = await buscarFichasPorDocumento(pre.documento);
                if (vivo) setFichas(data);
            } catch (err) {
                if (vivo) { onError(err); setFichas([]); }
            }
        })();
        return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pre.id]);

    const hacer = async (accion, customerId) => {
        setOcupado(true);
        try {
            await resolverPreregistro(pre.id, accion, customerId);
            onListo(accion === 'vincular' ? 'Pre-registro vinculado' : 'Pre-registro descartado');
        } catch (err) {
            onError(err);
        } finally {
            setOcupado(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Pre-registro">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{pre.nombre}</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2">Documento {pre.documento} · Teléfono {pre.telefono}{pre.email ? ` · ${pre.email}` : ''}</p>
                    {fichas === null && <LoadingState label="Buscando la ficha" />}
                    {fichas?.length === 0 && (
                        <Notice variant="warning">No hay ficha con ese documento. Hay que crearla en caja con estos datos; la app la reconocerá sola.</Notice>
                    )}
                    {fichas?.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-card-hover">
                            <div className="min-w-0">
                                <p className="text-body-sm font-semibold text-content truncate">{c.name}</p>
                                <p className="text-micro text-content-3">{[c.dui, c.nit, c.phone].filter(Boolean).join(' · ')}</p>
                            </div>
                            <Button size="sm" icon={Link2} loading={ocupado} onClick={() => hacer('vincular', c.id)}>Vincular</Button>
                        </div>
                    ))}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                <Button variant="destructive" icon={XCircle} loading={ocupado} onClick={() => hacer('descartar')}>Descartar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
