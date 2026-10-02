import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    ClipboardList, PenLine, Radio, Archive, BookCopy, Plus, ListOrdered, Settings2, Eye, History, AlertTriangle,
    FileEdit, Hourglass, CheckCircle2,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { LoadingState, EmptyState } from '../../components/common/StateViews';
import usePestanaEnUrl from '../../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { estadoDe, GRUPOS, canalDe, preguntasEnOrden, resumenDeCierre } from '@nucleo/utils/encuestasClientes';
import {
    fetchEncuestas, fetchDimensiones, fetchSalas, fetchPoblacion, crearEncuesta, duplicarEncuesta, guardarDiseno,
} from '@nucleo/data/encuestasClientes';
import EncuestaDetalle from './EncuestaDetalle';

/**
 * Encuestas a clientes — se diseñan, gerencia las aprueba, se publican y se
 * aplican (por QR, entrevista o tablet en la sala) hasta una fecha o una meta
 * de respuestas, general o por sucursal.
 *
 * Fase 1 (esta): diseño, plantillas y el ciclo de aprobación. La captura de
 * respuestas, los incentivos y los resultados son las fases 2 a 4 de
 * `docs/PLAN-ENCUESTAS-A-CLIENTES-2026-10-01.md`.
 *
 * Permisos del módulo `encuestas_clientes`: ver, editar (diseñar y publicar) y
 * aprobar (gerencia).
 */
export default function EncuestasClientesView() {
    const { hasPermission } = useAuth();
    const puedeEditar = hasPermission('encuestas_clientes', 'can_edit');
    const puedeAprobar = hasPermission('encuestas_clientes', 'can_approve');
    const showToast = useToastStore((s) => s.showToast);

    const [params, setParams] = useSearchParams();
    const abiertaId = params.get('encuesta');

    const tabsLista = useMemo(() => ([
        { key: 'diseno',     label: 'En diseño',  icon: PenLine },
        { key: 'campo',      label: 'En campo',   icon: Radio },
        { key: 'cerradas',   label: 'Cerradas',   icon: Archive },
        { key: 'plantillas', label: 'Plantillas', icon: BookCopy },
    ]), []);
    const tabsDetalle = useMemo(() => ([
        { key: 'preguntas', label: 'Preguntas',   icon: ListOrdered },
        { key: 'ajustes',   label: 'Ajustes',     icon: Settings2 },
        { key: 'vista',     label: 'Vista previa', icon: Eye },
        { key: 'historial', label: 'Historial',   icon: History },
    ]), []);
    const [tab, setTab] = usePestanaEnUrl(tabsLista, 'diseno');
    const [vista, setVista] = usePestanaEnUrl(tabsDetalle, 'preguntas', 'vista');

    const [encuestas, setEncuestas] = useState([]);
    const [dimensiones, setDimensiones] = useState([]);
    const [salas, setSalas] = useState([]);
    const [poblacion, setPoblacion] = useState({});
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [fEstado, setFEstado] = useState('');
    const [nueva, setNueva] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [es, dims, ss, pob] = await Promise.all([
                fetchEncuestas(), fetchDimensiones(), fetchSalas(), fetchPoblacion().catch(() => ({})),
            ]);
            setEncuestas(es);
            setDimensiones(dims);
            setSalas(ss);
            setPoblacion(pob);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial

    const abrir = useCallback((id) => setParams((p) => {
        const n = new URLSearchParams(p);
        n.set('encuesta', id);
        n.delete('vista');
        return n;
    }), [setParams]);
    const cerrar = useCallback(() => setParams((p) => {
        const n = new URLSearchParams(p);
        n.delete('encuesta');
        n.delete('vista');
        return n;
    }), [setParams]);

    const reales = encuestas.filter((e) => !e.es_plantilla);
    const cuenta = (estados) => reales.filter((e) => estados.includes(e.estado)).length;
    const porAprobar = cuenta(['en_revision']);

    const filas = useMemo(() => encuestas
        .filter((e) => (tab === 'plantillas' ? e.es_plantilla : !e.es_plantilla && GRUPOS[tab]?.includes(e.estado)))
        .filter((e) => !fEstado || e.estado === fEstado)
        .filter((e) => !busqueda || tokenMatch(busqueda, e.nombre, e.objetivo)),
    [encuestas, tab, fEstado, busqueda]);

    const cuerpo = () => {
        if (cargando) return <LoadingState label="Cargando encuestas…" />;
        if (error) return <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudieron cargar las encuestas.')}</Notice>;
        if (abiertaId) {
            return (
                <EncuestaDetalle key={abiertaId} id={abiertaId} vista={vista} dimensiones={dimensiones} salas={salas}
                    poblacion={poblacion} puedeEditar={puedeEditar} puedeAprobar={puedeAprobar}
                    onVolver={cerrar} onAbrir={abrir} onCambio={cargar} />
            );
        }
        if (!filas.length && !busqueda && !fEstado) {
            return (
                <EmptyState icon={ClipboardList}
                    title={tab === 'plantillas' ? 'Sin plantillas' : tab === 'campo' ? 'Ninguna encuesta en campo' : tab === 'cerradas' ? 'Ninguna cerrada todavía' : 'Ninguna encuesta en diseño'}
                    subtitle={tab === 'campo' ? 'Cuando una encuesta aprobada se publica, aparece aquí.' : 'Empieza una desde cero o a partir de una plantilla.'}
                    action={puedeEditar && tab !== 'campo' && tab !== 'cerradas'
                        && <Button icon={Plus} onClick={() => setNueva(true)}>Nueva encuesta</Button>} />
            );
        }
        return <TablaEncuestas filas={filas} plantillas={tab === 'plantillas'} onAbrir={(e) => abrir(e.id)} />;
    };

    const acciones = puedeEditar && !abiertaId ? [{
        key: 'nueva', icon: Plus, label: 'Nueva encuesta', title: 'Diseñar una encuesta', rotulo: 'Nueva',
        variant: 'primary', onClick: () => setNueva(true),
    }] : [];

    const estadosDelTab = tab === 'plantillas' ? [] : (GRUPOS[tab] || []);

    return (
        <GlassViewLayout icon={ClipboardList} title="Encuestas a clientes" filtersContent={abiertaId ? (
            <ViewTabBar tabs={tabsDetalle} activeTab={vista} onTabChange={setVista} showSearch={false} />
        ) : (
            <ViewTabBar
                tabs={tabsLista.map((t) => (t.key === 'diseno' && puedeAprobar && porAprobar ? { ...t, cuenta: porAprobar } : t))}
                activeTab={tab} onTabChange={(t) => { setTab(t); setFEstado(''); }}
                searchValue={busqueda} onSearchChange={setBusqueda} placeholder="Buscar encuesta…" />
        )} transparentBody>
            <div className="p-4 md:p-6 space-y-6">
                {!abiertaId && (
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                        <CarrilCards className="flex-1" ariaLabel="Resumen de encuestas">
                            <StatCard icon={FileEdit} label="Borradores" value={cuenta(['borrador'])} sub="En diseño" />
                            <StatCard icon={Hourglass} label="Por aprobar" value={porAprobar}
                                valueCls={porAprobar ? 'text-warning' : undefined} sub="Esperan a gerencia" />
                            <StatCard icon={CheckCircle2} label="Aprobadas" value={cuenta(['aprobada'])} sub="Listas para publicar" />
                            <StatCard icon={Radio} label="En campo" value={cuenta(['publicada'])} sub="Recibiendo respuestas" />
                        </CarrilCards>
                        <div className="flex justify-end min-w-0">
                            <FilterBar acciones={acciones} activeCount={fEstado ? 1 : 0} onClear={fEstado ? () => setFEstado('') : undefined}>
                                {estadosDelTab.length > 1 && (
                                    <FilterBar.Section label="estado" active={!!fEstado} onClear={() => setFEstado('')}>
                                        <FilterBar.Opciones value={fEstado} onChange={(v) => setFEstado(v || '')} label="Estado" placeholder="Estado"
                                            umbral={0}
                                            options={[{ value: '', label: 'Estado' }, ...estadosDelTab.map((e) => ({ value: e, label: estadoDe(e).label }))]} />
                                    </FilterBar.Section>
                                )}
                            </FilterBar>
                        </div>
                    </div>
                )}
                {cuerpo()}
            </div>
            {nueva && (
                <NuevaEncuestaModal plantillas={encuestas.filter((e) => e.es_plantilla)} onClose={() => setNueva(false)}
                    onCreada={(id) => { setNueva(false); cargar(); abrir(id); }}
                    onError={(err) => showToast('No se pudo crear', mensajeAmigable(err, 'Intenta de nuevo.'), 'error')} />
            )}
        </GlassViewLayout>
    );
}

// ── La lista ───────────────────────────────────────────────────────────────

function TablaEncuestas({ filas, plantillas, onAbrir }) {
    return (
        <DataTable
            columns={[
                { key: 'nombre', label: plantillas ? 'Plantilla' : 'Encuesta' },
                ...(plantillas ? [] : [{ key: 'estado', label: 'Estado' }]),
                { key: 'preguntas', label: 'Preguntas', hideBelow: 'sm' },
                ...(plantillas ? [] : [
                    { key: 'canales', label: 'Cómo', hideBelow: 'md' },
                    { key: 'cierre', label: 'Cierre', hideBelow: 'lg' },
                ]),
                { key: 'cambio', label: 'Último cambio', hideBelow: 'md' },
            ]}
            movil={{ usarAccionDeFila: true }}
            empty={{ icon: ClipboardList, message: 'Sin encuestas con ese filtro' }}
            minWidth="560px">
            {filas.map((e, i) => {
                const est = estadoDe(e.estado);
                return (
                    <DataRow key={e.id} index={i} onClick={() => onAbrir(e)}>
                        <DataCell>
                            <div className="min-w-0">
                                <p className="text-body-sm font-semibold text-content truncate">
                                    {e.nombre}{!plantillas && e.version > 1 && <span className="text-content-3 font-normal"> · v{e.version}</span>}
                                </p>
                                {e.objetivo && <p className="text-micro text-content-3 truncate">{e.objetivo}</p>}
                            </div>
                        </DataCell>
                        {!plantillas && <DataCell><Badge variant={est.variant}>{est.label}</Badge></DataCell>}
                        <DataCell><span className="text-body-sm text-content-2">{preguntasEnOrden(e.cuestionario).length} preguntas</span></DataCell>
                        {!plantillas && (
                            <>
                                <DataCell>
                                    <span className="text-body-sm text-content-2">{(e.canales || []).map((c) => canalDe(c).label).join(', ')}</span>
                                </DataCell>
                                <DataCell>
                                    <span className="text-body-sm text-content-2">{resumenDeCierre(e, e.sucursales || [], fechaTexto)}</span>
                                </DataCell>
                            </>
                        )}
                        <DataCell>
                            <span className="text-body-sm text-content-3">{fechaTexto(e.updated_at, { day: 'numeric', month: 'short' })}</span>
                        </DataCell>
                    </DataRow>
                );
            })}
        </DataTable>
    );
}

// ── Nueva encuesta ─────────────────────────────────────────────────────────

function NuevaEncuestaModal({ plantillas, onClose, onCreada, onError }) {
    const [nombre, setNombre] = useState('');
    const [base, setBase] = useState('');
    const [tipo, setTipo] = useState('encuesta');
    const [creando, setCreando] = useState(false);

    const crear = async () => {
        setCreando(true);
        try {
            let id;
            if (base) {
                id = await duplicarEncuesta(base, tipo === 'plantilla');
                if (nombre.trim()) await guardarDiseno(id, { nombre: nombre.trim() });
            } else {
                id = await crearEncuesta({ nombre: nombre.trim(), es_plantilla: tipo === 'plantilla' });
            }
            onCreada(id);
        } catch (err) {
            onError(err);
        } finally {
            setCreando(false);
        }
    };

    const valido = nombre.trim() || base;

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Nueva encuesta">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Nueva encuesta</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Empezar desde</span>
                        <LiquidSelect value={base} placeholder="En blanco" onChange={(v) => setBase(v || '')} ariaLabel="Empezar desde"
                            options={plantillas.map((p) => ({ value: p.id, label: p.nombre, sublabel: p.objetivo || undefined }))} />
                    </div>
                    <PortalInput label="Nombre" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
                        placeholder={base ? 'Si lo dejas vacío, usa el de la plantilla' : 'Ej. Satisfacción en sala — octubre'} />
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Es</span>
                        <LiquidSelect value={tipo} clearable={false} onChange={(v) => setTipo(v || 'encuesta')} ariaLabel="Tipo"
                            options={[{ value: 'encuesta', label: 'Una encuesta para aplicar' },
                                { value: 'plantilla', label: 'Una plantilla para reutilizar' }]} />
                    </div>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Plus} loading={creando} disabled={!valido} onClick={crear}>Crear</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
