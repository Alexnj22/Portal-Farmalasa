import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleDashed, Plus, Eye, EyeOff, Trash2, Pencil, Image as ImageIcon } from 'lucide-react';
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
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { LoadingState } from '../../components/common/StateViews';
import { estadoDeOferta } from '@nucleo/utils/ofertasClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { borrarHistoria, fetchHistorias, guardarHistoria, publicarHistoria, subirImagen } from '@nucleo/data/ofertasClientes';

/**
 * Historias de la app de clientes (2026-10-06): imágenes tipo «estados» con
 * promociones o información, que la app muestra en un carrusel arriba de Mis
 * puntos. Tabla `app_historias`; mismo permiso y bucket que las ofertas.
 *
 * El botón de cada historia lleva a una pantalla de la app: se elige de una
 * lista cerrada y no se escribe, para que un enlace mal tecleado no deje un
 * botón que no hace nada.
 */
const DESTINOS = [
    { valor: '', rotulo: 'Sin botón', boton: null },
    { valor: '/ofertas', rotulo: 'Ofertas', boton: 'Ver ofertas' },
    { valor: '/sucursales', rotulo: 'Sucursales', boton: 'Ver sucursales' },
    { valor: '/puntos', rotulo: 'Mis puntos', boton: 'Ver mis puntos' },
    { valor: '/invitar', rotulo: 'Invitar amigos', boton: 'Invitar' },
];

export default function HistoriasPanel({ busqueda, puedeEditar, showToast }) {
    const [historias, setHistorias] = useState(null);
    const [error, setError] = useState(null);
    const [fEstado, setFEstado] = useState('');
    const [editando, setEditando] = useState(null);
    const [borrando, setBorrando] = useState(null);
    const hoy = hoySV();

    const cargar = useCallback(async () => {
        try {
            setHistorias(await fetchHistorias());
            setError(null);
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar las historias.'));
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial

    const filas = useMemo(() => (historias ?? [])
        .filter((h) => !fEstado || estadoDeOferta(h, hoy).key === fEstado)
        .filter((h) => !busqueda || tokenMatch(`${h.titulo} ${h.texto ?? ''}`, busqueda)), [historias, fEstado, busqueda, hoy]);

    const alternar = async (h) => {
        try {
            await publicarHistoria(h.id, !h.publicada);
            showToast(h.publicada ? 'Historia retirada' : 'Historia publicada',
                h.publicada ? 'Ya no se ve en la app.' : 'Se ve en la app durante sus fechas.', 'success');
            cargar();
        } catch (err) {
            showToast('No se pudo cambiar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    const acciones = puedeEditar ? [{
        key: 'nueva', icon: Plus, label: 'Nueva historia', title: 'Crear una historia para la app', rotulo: 'Nueva',
        variant: 'primary', onClick: () => setEditando({}),
    }] : [];

    if (error) return <Notice variant="danger">{error}</Notice>;
    if (!historias) return <LoadingState label="Cargando historias" />;

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
                    { key: 'historia', label: 'Historia' },
                    { key: 'estado', label: 'Estado' },
                    { key: 'fechas', label: 'Fechas', hideBelow: 'sm' },
                    ...(puedeEditar ? [{ key: 'acciones', label: '', align: 'right' }] : []),
                ]}
                movil={{ usarAccionDeFila: true, acciones: 'mantener' }}
                empty={{ icon: CircleDashed, message: 'Sin historias. Crea una para que aparezca en la app.' }}
                minWidth="560px">
                {filas.map((h, i) => {
                    const est = estadoDeOferta(h, hoy);
                    return (
                        <DataRow key={h.id} index={i} onClick={puedeEditar ? () => setEditando(h) : undefined}>
                            <DataCell>
                                <div className="flex items-center gap-3 min-w-0">
                                    {h.imagen_url
                                        ? <img src={h.imagen_url} alt="" className="w-9 h-14 object-cover rounded-md shrink-0" />
                                        : <span className="w-9 h-14 rounded-md bg-surface-card-hover grid place-items-center shrink-0"><ImageIcon size={14} className="text-content-3" /></span>}
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-semibold text-content truncate">{h.titulo}</p>
                                        <p className="text-micro text-content-3 truncate">
                                            {h.boton ? `Botón: ${h.boton}` : 'Sin botón'}
                                        </p>
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell><Badge variant={est.variant}>{est.label}</Badge></DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content-2">
                                    {fechaTexto(h.inicio, { day: 'numeric', month: 'short' })} – {fechaTexto(h.fin, { day: 'numeric', month: 'short' })}
                                </span>
                            </DataCell>
                            {puedeEditar && (
                                <DataCell align="right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" iconOnly icon={h.publicada ? EyeOff : Eye}
                                            title={h.publicada ? 'Retirar de la app' : 'Publicar en la app'}
                                            onClick={(e) => { e.stopPropagation(); alternar(h); }} />
                                        <Button variant="ghost" iconOnly icon={Pencil} title="Editar"
                                            onClick={(e) => { e.stopPropagation(); setEditando(h); }} />
                                        <Button variant="ghost" iconOnly icon={Trash2} title="Borrar"
                                            onClick={(e) => { e.stopPropagation(); setBorrando(h); }} />
                                    </div>
                                </DataCell>
                            )}
                        </DataRow>
                    );
                })}
            </DataTable>
            {editando && (
                <HistoriaModal historia={editando} onClose={() => setEditando(null)}
                    onGuardada={() => { setEditando(null); cargar(); showToast('Historia guardada', '', 'success'); }}
                    onError={(err) => showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error')} />
            )}
            {borrando && (
                <ConfirmModal isOpen title="Borrar historia" message={`«${borrando.titulo}» deja de verse en la app y se borra su imagen.`}
                    confirmText="Borrar" onClose={() => setBorrando(null)}
                    onConfirm={async () => {
                        try {
                            await borrarHistoria(borrando);
                            setBorrando(null);
                            cargar();
                            showToast('Historia borrada', '', 'success');
                        } catch (err) {
                            showToast('No se pudo borrar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
                        }
                    }} />
            )}
        </>
    );
}

function HistoriaModal({ historia, onClose, onGuardada, onError }) {
    const nueva = !historia.id;
    const [f, setF] = useState({
        titulo: historia.titulo ?? '', texto: historia.texto ?? '', enlace: historia.enlace ?? '',
        fin: historia.fin ?? '', publicada: historia.publicada ?? false,
    });
    const [archivo, setArchivo] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
    const inicio = historia.inicio ?? hoySV();
    const valido = f.titulo.trim().length >= 3 && f.fin && f.fin >= inicio && (archivo || historia.imagen_path);

    const guardar = async () => {
        setGuardando(true);
        try {
            const imagen_path = archivo ? await subirImagen(archivo) : historia.imagen_path;
            const destino = DESTINOS.find((d) => d.valor === f.enlace) ?? DESTINOS[0];
            await guardarHistoria(historia.id, {
                titulo: f.titulo.trim(), texto: f.texto.trim() || null, imagen_path, inicio, fin: f.fin,
                enlace: destino.valor || null, boton: destino.boton, publicada: f.publicada,
            });
            onGuardada();
        } catch (err) {
            onError(err);
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel={nueva ? 'Nueva historia' : 'Editar historia'}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{nueva ? 'Nueva historia' : 'Editar historia'}</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <FileField label="Imagen" accept="image/jpeg,image/png,image/webp" file={archivo} onChange={setArchivo}
                        hint={historia.imagen_path && !archivo ? 'Ya tiene imagen; sube otra para reemplazarla' : 'Vertical (9:16, como un estado), hasta 3 MB'} />
                    <PortalInput label="Título" name="titulo" value={f.titulo} maxLength={60}
                        onChange={(e) => cambiar('titulo')(e.target.value)} placeholder="Ej. Semana del bebé" />
                    <PortalTextarea label="Texto (opcional)" name="texto" rows={2} value={f.texto} maxLength={240}
                        onChange={(e) => cambiar('texto')(e.target.value)} placeholder="Una o dos líneas: se leen sobre la foto." />
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Botón</span>
                        <p className="text-micro text-content-3 mb-2">A dónde lleva el botón de la historia en la app.</p>
                        <SegmentedControl label="Botón" value={f.enlace} onChange={cambiar('enlace')}
                            options={DESTINOS.map((d) => ({ value: d.valor, label: d.rotulo }))} />
                    </div>
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Se ve hasta</span>
                        <LiquidDatePicker value={f.fin} onChange={cambiar('fin')} />
                        {f.fin && f.fin < inicio && <Notice variant="warning">La fecha ya pasó.</Notice>}
                    </div>
                    <label className="flex items-center justify-between gap-3">
                        <span>
                            <span className="block text-body-sm font-semibold text-content">Publicada</span>
                            <span className="block text-micro text-content-3">Se ve en la app hasta la fecha final.</span>
                        </span>
                        <Switch checked={f.publicada} onChange={cambiar('publicada')} label="Publicada" />
                    </label>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={CircleDashed} loading={guardando} disabled={!valido} onClick={guardar}>Guardar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
