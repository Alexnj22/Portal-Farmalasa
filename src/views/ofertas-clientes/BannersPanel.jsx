import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GalleryHorizontal, Plus, Eye, EyeOff, Trash2, Pencil, Image as ImageIcon } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import FileField from '../../components/common/FileField';
import Switch from '../../components/common/Switch';
import ConfirmModal from '../../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { LoadingState } from '../../components/common/StateViews';
import FormatoImagen from './FormatoImagen';
import { estadoDeOferta } from '@nucleo/utils/ofertasClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import {
    borrarBanner, fetchBanners, fetchOfertasParaHistoria, guardarBanner, publicarBanner, subirImagen,
} from '@nucleo/data/ofertasClientes';

/**
 * Banners de la app de clientes (2026-10-07): imágenes horizontales que se
 * pasan con el dedo arriba del catálogo. A diferencia de las historias (que
 * duran 24 horas), un banner tiene fechas. Al tocarlo lleva a una oferta o a
 * una pantalla de la app. Sin banners vigentes, la app muestra las ofertas.
 * Tabla `app_banners`; mismo permiso y bucket que las ofertas.
 */
const DESTINOS = [
    { value: '', label: 'Ninguno' },
    { value: '/ofertas', label: 'Ofertas' },
    { value: '/sucursales', label: 'Sucursales' },
    { value: '/puntos', label: 'Mis puntos' },
    { value: '/invitar', label: 'Invitar amigos' },
];

export default function BannersPanel({ busqueda, puedeEditar, showToast }) {
    const [banners, setBanners] = useState(null);
    const [error, setError] = useState(null);
    const [fEstado, setFEstado] = useState('');
    const [editando, setEditando] = useState(null);
    const [borrando, setBorrando] = useState(null);
    const hoy = hoySV();

    const cargar = useCallback(async () => {
        try {
            setBanners(await fetchBanners());
            setError(null);
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar los banners.'));
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial

    const filas = useMemo(() => (banners ?? [])
        .filter((b) => !fEstado || estadoDeOferta(b, hoy).key === fEstado)
        .filter((b) => !busqueda || tokenMatch(b.titulo, busqueda)), [banners, fEstado, busqueda, hoy]);

    const alternar = async (b) => {
        try {
            await publicarBanner(b.id, !b.publicada);
            showToast(b.publicada ? 'Banner retirado' : 'Banner publicado',
                b.publicada ? 'Ya no se ve en la app.' : 'Se ve en la app durante sus fechas.', 'success');
            cargar();
        } catch (err) {
            showToast('No se pudo cambiar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    const acciones = puedeEditar ? [{
        key: 'nuevo', icon: Plus, label: 'Nuevo banner', title: 'Crear un banner para la app', rotulo: 'Nuevo',
        variant: 'primary', onClick: () => setEditando({}),
    }] : [];

    if (error) return <Notice variant="danger">{error}</Notice>;
    if (!banners) return <LoadingState label="Cargando banners" />;

    return (
        <>
            <div className="flex justify-end">
                <FilterBar acciones={acciones} activeCount={fEstado ? 1 : 0} onClear={fEstado ? () => setFEstado('') : undefined}>
                    <FilterBar.Section label="estado" active={!!fEstado} onClear={() => setFEstado('')}>
                        <FilterBar.Opciones value={fEstado} onChange={(v) => setFEstado(v || '')} label="Estado" placeholder="Estado" umbral={0}
                            options={[{ value: '', label: 'Estado' }, { value: 'vigente', label: 'En la app' },
                                { value: 'programada', label: 'Programado' }, { value: 'borrador', label: 'Sin publicar' },
                                { value: 'terminada', label: 'Terminado' }]} />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            <DataTable
                columns={[
                    { key: 'banner', label: 'Banner' },
                    { key: 'estado', label: 'Estado' },
                    { key: 'fechas', label: 'Fechas', hideBelow: 'sm' },
                    ...(puedeEditar ? [{ key: 'acciones', label: '', align: 'right' }] : []),
                ]}
                movil={{ usarAccionDeFila: true, acciones: 'mantener' }}
                empty={{ icon: GalleryHorizontal, message: 'Sin banners. Mientras no haya, la app muestra las ofertas publicadas.' }}
                minWidth="560px">
                {filas.map((b, i) => {
                    const est = estadoDeOferta(b, hoy);
                    return (
                        <DataRow key={b.id} index={i} onClick={puedeEditar ? () => setEditando(b) : undefined}>
                            <DataCell>
                                <div className="flex items-center gap-3 min-w-0">
                                    {b.imagen_url
                                        ? <img src={b.imagen_url} alt="" className="w-24 h-10 object-cover rounded-md shrink-0" />
                                        : <span className="w-24 h-10 rounded-md bg-surface-card-hover grid place-items-center shrink-0"><ImageIcon size={14} className="text-content-3" /></span>}
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-semibold text-content truncate">{b.titulo}</p>
                                        <p className="text-micro text-content-3 truncate">
                                            {b.oferta_id ? 'Abre una oferta' : b.enlace ? `Abre ${DESTINOS.find((d) => d.value === b.enlace)?.label ?? b.enlace}` : 'Sin destino'}
                                        </p>
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell><Badge variant={est.variant}>{est.label}</Badge></DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content-2">
                                    {fechaTexto(b.inicio, { day: 'numeric', month: 'short' })} – {fechaTexto(b.fin, { day: 'numeric', month: 'short' })}
                                </span>
                            </DataCell>
                            {puedeEditar && (
                                <DataCell align="right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" iconOnly icon={b.publicada ? EyeOff : Eye}
                                            title={b.publicada ? 'Retirar de la app' : 'Publicar en la app'}
                                            onClick={(e) => { e.stopPropagation(); alternar(b); }} />
                                        <Button variant="ghost" iconOnly icon={Pencil} title="Editar"
                                            onClick={(e) => { e.stopPropagation(); setEditando(b); }} />
                                        <Button variant="ghost" iconOnly icon={Trash2} title="Borrar"
                                            onClick={(e) => { e.stopPropagation(); setBorrando(b); }} />
                                    </div>
                                </DataCell>
                            )}
                        </DataRow>
                    );
                })}
            </DataTable>
            {editando && (
                <BannerModal banner={editando} onClose={() => setEditando(null)}
                    onGuardado={() => { setEditando(null); cargar(); showToast('Banner guardado', '', 'success'); }}
                    onError={(err) => showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error')} />
            )}
            {borrando && (
                <ConfirmModal isOpen title="Borrar banner" message={`«${borrando.titulo}» deja de verse en la app y se borra su imagen.`}
                    confirmText="Borrar" onClose={() => setBorrando(null)}
                    onConfirm={async () => {
                        try {
                            await borrarBanner(borrando);
                            setBorrando(null);
                            cargar();
                            showToast('Banner borrado', '', 'success');
                        } catch (err) {
                            showToast('No se pudo borrar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
                        }
                    }} />
            )}
        </>
    );
}

function BannerModal({ banner, onClose, onGuardado, onError }) {
    const nuevo = !banner.id;
    const claveBorrador = `banner-app:${banner.id ?? 'nuevo'}`;
    const hoy = hoySV();
    const [f, setF] = useState(() => loadDraft(claveBorrador) ?? {
        titulo: banner.titulo ?? '', titulo_visible: banner.titulo_visible ?? false,
        oferta_id: banner.oferta_id ?? '', enlace: banner.enlace ?? '',
        inicio: banner.inicio ?? hoy, fin: banner.fin ?? sumarDias(hoy, 14), publicada: banner.publicada ?? false,
    });
    useEffect(() => { saveDraft(claveBorrador, f); }, [claveBorrador, f]);
    const [archivo, setArchivo] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [ofertas, setOfertas] = useState([]);
    useEffect(() => {
        fetchOfertasParaHistoria(hoySV()).then(setOfertas)
            .catch((err) => console.error('BannerModal: no se pudieron cargar las ofertas', err));
    }, []);
    const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
    const valido = f.titulo.trim().length >= 3 && f.inicio && f.fin && f.fin >= f.inicio && (archivo || banner.imagen_path);

    const guardar = async () => {
        setGuardando(true);
        try {
            const imagen_path = archivo ? await subirImagen(archivo) : banner.imagen_path;
            await guardarBanner(banner.id, {
                titulo: f.titulo.trim(), titulo_visible: f.titulo_visible, imagen_path,
                // Con oferta, el banner abre la oferta; si no, la pantalla elegida.
                oferta_id: f.oferta_id || null, enlace: f.oferta_id ? null : (f.enlace || null),
                inicio: f.inicio, fin: f.fin, publicada: f.publicada,
            });
            clearDraft(claveBorrador);
            onGuardado();
        } catch (err) {
            onError(err);
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel={nuevo ? 'Nuevo banner' : 'Editar banner'}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{nuevo ? 'Nuevo banner' : 'Editar banner'}</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <FileField label="Imagen" accept="image/jpeg,image/png,image/webp" file={archivo} onChange={setArchivo}
                        hint={banner.imagen_path && !archivo ? 'Ya tiene imagen; sube otra para reemplazarla' : 'Horizontal, 1200 × 500 px'} />
                    <FormatoImagen tipo="banner" archivo={archivo} />
                    <PortalInput label="Título" name="titulo" value={f.titulo} maxLength={60}
                        onChange={(e) => cambiar('titulo')(e.target.value)} placeholder="Ej. Semana del bebé"
                        helperText="Lo lee VoiceOver y sirve para encontrarlo aquí." />
                    <label className="flex items-center justify-between gap-3">
                        <span>
                            <span className="block text-body-sm font-semibold text-content">Escribir el título sobre la imagen</span>
                            <span className="block text-micro text-content-3">Apágalo si la imagen ya trae su texto.</span>
                        </span>
                        <Switch checked={f.titulo_visible} onChange={cambiar('titulo_visible')} label="Título sobre la imagen" />
                    </label>
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Al tocarlo abre</span>
                        <LiquidSelect value={f.oferta_id} onChange={cambiar('oferta_id')} placeholder="Una oferta (opcional)"
                            options={[{ value: '', label: 'Ninguna oferta' }, ...ofertas.map((o) => ({
                                value: o.id, label: `${o.titulo}${o.publicada ? '' : ' (sin publicar)'}`,
                            }))]} />
                        {!f.oferta_id && (
                            <div className="mt-2">
                                <LiquidSelect value={f.enlace} onChange={cambiar('enlace')} placeholder="O una pantalla" options={DESTINOS} />
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <span className="block text-label font-semibold text-content-2 mb-1">Desde</span>
                            <LiquidDatePicker value={f.inicio} onChange={cambiar('inicio')} />
                        </div>
                        <div>
                            <span className="block text-label font-semibold text-content-2 mb-1">Hasta</span>
                            <LiquidDatePicker value={f.fin} onChange={cambiar('fin')} />
                        </div>
                    </div>
                    {f.fin && f.inicio && f.fin < f.inicio && <Notice variant="warning">La fecha final es antes que la inicial.</Notice>}
                    <label className="flex items-center justify-between gap-3">
                        <span>
                            <span className="block text-body-sm font-semibold text-content">Publicado</span>
                            <span className="block text-micro text-content-3">Se ve en la app entre esas fechas.</span>
                        </span>
                        <Switch checked={f.publicada} onChange={cambiar('publicada')} label="Publicado" />
                    </label>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={GalleryHorizontal} loading={guardando} disabled={!valido} onClick={guardar}>Guardar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
