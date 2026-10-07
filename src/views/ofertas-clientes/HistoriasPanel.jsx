import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleDashed, Plus, Eye, EyeOff, Trash2, Pencil, Image as ImageIcon, Users } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import FileField from '../../components/common/FileField';
import Switch from '../../components/common/Switch';
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { LoadingState } from '../../components/common/StateViews';
import { estadoDeHistoria, venceHistoria } from '@nucleo/utils/ofertasClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { borrarHistoria, fetchHistorias, fetchOfertasParaHistoria, fetchQuienesVieron, fetchVistasHistorias, guardarHistoria, publicarHistoria, subirImagen } from '@nucleo/data/ofertasClientes';
import LiquidSelect from '../../components/common/LiquidSelect';
import { hora12 } from '@nucleo/utils/hora';
import FormatoImagen from './FormatoImagen';

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
    const [vistas, setVistas] = useState(new Map());
    const [viendo, setViendo] = useState(null);

    const cargar = useCallback(async () => {
        try {
            const [hs, vs] = await Promise.all([fetchHistorias(), fetchVistasHistorias().catch((err) => {
                console.error('HistoriasPanel: no se pudieron contar las vistas', err);
                return new Map();
            })]);
            setHistorias(hs);
            setVistas(vs);
            setError(null);
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar las historias.'));
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial

    const filas = useMemo(() => (historias ?? [])
        .filter((h) => !fEstado || estadoDeHistoria(h).key === fEstado)
        .filter((h) => !busqueda || tokenMatch(`${h.titulo} ${h.texto ?? ''}`, busqueda)), [historias, fEstado, busqueda]);

    // Una que ya terminó se vuelve a publicar: se retira y se publica, y la base
    // le renueva las 24 horas.
    const alternar = async (h, renovar = false) => {
        try {
            if (renovar) await publicarHistoria(h.id, false);
            const publicar = renovar || !h.publicada;
            await publicarHistoria(h.id, publicar);
            showToast(publicar ? 'Historia publicada' : 'Historia retirada',
                publicar ? 'Se ve en la app durante 24 horas.' : 'Ya no se ve en la app.', 'success');
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
                                { value: 'borrador', label: 'Sin publicar' }, { value: 'terminada', label: 'Terminó' }]} />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            <DataTable
                columns={[
                    { key: 'historia', label: 'Historia' },
                    { key: 'estado', label: 'Estado' },
                    { key: 'vistas', label: 'Vistas', align: 'right' },
                    { key: 'fechas', label: 'Se ve hasta', hideBelow: 'sm' },
                    ...(puedeEditar ? [{ key: 'acciones', label: '', align: 'right' }] : []),
                ]}
                movil={{ usarAccionDeFila: true, acciones: 'mantener' }}
                empty={{ icon: CircleDashed, message: 'Sin historias. Crea una para que aparezca en la app.' }}
                minWidth="560px">
                {filas.map((h, i) => {
                    const est = estadoDeHistoria(h);
                    const vence = venceHistoria(h);
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
                            <DataCell align="right">
                                <ConteoVistas v={vistas.get(h.id)} onVer={() => setViendo(h)} />
                            </DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content-2">
                                    {vence ? `${fechaTexto(vence, { day: 'numeric', month: 'short' })} · ${hora12(vence)}` : '—'}
                                </span>
                            </DataCell>
                            {puedeEditar && (
                                <DataCell align="right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" iconOnly icon={est.key === 'vigente' ? EyeOff : Eye}
                                            title={est.key === 'vigente' ? 'Retirar de la app' : (est.key === 'terminada' ? 'Publicar otras 24 horas' : 'Publicar en la app')}
                                            onClick={(e) => { e.stopPropagation(); alternar(h, est.key === 'terminada'); }} />
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
            {viendo && <VistasModal historia={viendo} resumen={vistas.get(viendo.id)} onClose={() => setViendo(null)} />}
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
        titulo: historia.titulo ?? '', rotulo: historia.rotulo ?? '', texto: historia.texto ?? '', enlace: historia.enlace ?? '',
        fin: historia.fin ?? '', publicada: historia.publicada ?? false, oferta_id: historia.oferta_id ?? '',
    });
    const [ofertas, setOfertas] = useState([]);
    useEffect(() => {
        fetchOfertasParaHistoria(hoySV()).then(setOfertas)
            .catch((err) => console.error('HistoriaModal: no se pudieron cargar las ofertas', err));
    }, []);
    const [archivo, setArchivo] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
    const valido = f.titulo.trim().length >= 3 && (archivo || historia.imagen_path);

    const guardar = async () => {
        setGuardando(true);
        try {
            const imagen_path = archivo ? await subirImagen(archivo) : historia.imagen_path;
            const destino = DESTINOS.find((d) => d.valor === f.enlace) ?? DESTINOS[0];
            await guardarHistoria(historia.id, {
                // Duran 24 horas desde que se publican; `inicio`/`fin` sólo cumplen con la tabla.
                titulo: f.titulo.trim(), rotulo: f.rotulo.trim() || null, texto: f.texto.trim() || null, imagen_path, inicio: hoySV(), fin: sumarDias(hoySV(), 1),
                enlace: destino.valor || null, boton: destino.boton, publicada: f.publicada,
                oferta_id: f.oferta_id || null,
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
                        hint={historia.imagen_path && !archivo ? 'Ya tiene imagen; sube otra para reemplazarla' : 'Vertical, 1080 × 1920 px'} />
                    <FormatoImagen tipo="historia" archivo={archivo} />
                    <PortalInput label="Título" name="titulo" value={f.titulo} maxLength={60}
                        onChange={(e) => cambiar('titulo')(e.target.value)} placeholder="Ej. Semana del bebé" />
                    <PortalInput label="Rótulo corto" name="rotulo" value={f.rotulo} maxLength={12}
                        onChange={(e) => cambiar('rotulo')(e.target.value)} placeholder="Ej. Bebé"
                        helperText="Va debajo del círculo en la app. Una o dos palabras; si lo dejas vacío, se usa la primera del título." />
                    <PortalTextarea label="Texto (opcional)" name="texto" rows={2} value={f.texto} maxLength={240}
                        onChange={(e) => cambiar('texto')(e.target.value)} placeholder="Una o dos líneas: se leen sobre la foto." />
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Botón</span>
                        <p className="text-micro text-content-3 mb-2">A dónde lleva el botón de la historia en la app.</p>
                        <SegmentedControl label="Botón" value={f.enlace} onChange={cambiar('enlace')}
                            options={DESTINOS.map((d) => ({ value: d.valor, label: d.rotulo }))} />
                    </div>
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Oferta para reservar</span>
                        <p className="text-micro text-content-3 mb-2">Con una oferta, la historia muestra «Reservar» en lugar del botón. «Más información» (WhatsApp de la empresa) sale siempre.</p>
                        <LiquidSelect value={f.oferta_id} onChange={cambiar('oferta_id')} placeholder="Ninguna"
                            options={[{ value: '', label: 'Ninguna' }, ...ofertas.map((o) => ({
                                value: o.id, label: `${o.titulo}${o.publicada ? '' : ' (sin publicar)'}`,
                            }))]} />
                    </div>
                    <label className="flex items-center justify-between gap-3">
                        <span>
                            <span className="block text-body-sm font-semibold text-content">Publicada</span>
                            <span className="block text-micro text-content-3">Se ve en la app 24 horas desde que se publica.</span>
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

// Cuántos la vieron: el número toca para ver quiénes.
function ConteoVistas({ v, onVer }) {
    if (!v?.vistas) return <span className="text-body-sm text-content-3">—</span>;
    return (
        <button type="button" onClick={(e) => { e.stopPropagation(); onVer(); }}
            className="inline-flex flex-col items-end min-h-[var(--tap-min)] justify-center rounded-md px-1 active:scale-[0.97] hover:text-accent-text"
            title="Ver quién la vio">
            <span className="text-body-sm font-semibold text-content tabular-nums">{v.vistas.toLocaleString('es-SV')}</span>
            {v.tocaron > 0 && <span className="text-micro text-content-3 tabular-nums">{v.tocaron} tocaron</span>}
        </button>
    );
}

function VistasModal({ historia, resumen, onClose }) {
    const [lista, setLista] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        fetchQuienesVieron(historia.id).then(setLista)
            .catch((err) => setError(mensajeAmigable(err, 'No se pudo cargar quién la vio.')));
    }, [historia.id]);
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Quién vio la historia">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{historia.titulo}</h2>
                <p className="text-body-sm text-content-3">
                    {resumen?.vistas ?? 0} la vieron · {resumen?.con_cuenta ?? 0} con cuenta · {resumen?.visitantes ?? 0} sin cuenta · {resumen?.tocaron ?? 0} tocaron un botón
                </p>
            </LiquidModal.Header>
            <LiquidModal.Body>
                {error ? <Notice variant="danger">{error}</Notice>
                    : !lista ? <LoadingState label="Cargando" />
                        : !lista.length ? <p className="text-body-sm text-content-3">Todavía no la ha visto ningún cliente con cuenta.</p>
                            : (
                                <ul className="divide-y divide-border-subtle">
                                    {lista.map((p) => (
                                        <li key={p.customer_id} className="flex items-center justify-between gap-3 py-2">
                                            <span className="min-w-0">
                                                <span className="block text-body-sm font-semibold text-content truncate">{p.cliente}</span>
                                                <span className="block text-micro text-content-3">
                                                    {fechaTexto(p.visto_at, { day: 'numeric', month: 'short' })} · {hora12(p.visto_at)}
                                                </span>
                                            </span>
                                            {p.toco_boton && <Badge variant="success">Tocó un botón</Badge>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                {resumen?.visitantes > 0 && (
                    <p className="text-micro text-content-3 mt-3 flex items-center gap-1.5">
                        <Users size={12} /> Los que la vieron sin cuenta se cuentan, pero no tienen nombre.
                    </p>
                )}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
