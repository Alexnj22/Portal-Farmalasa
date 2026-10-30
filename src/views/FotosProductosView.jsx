import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, FlaskConical, Globe, ImagePlus, Loader2, Package, Plus, Search, SkipForward, Smartphone, Users, X } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import CarrilCards from '../components/common/CarrilCards';
import StatCard from '../components/common/StatCard';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import ListRow from '../components/common/ListRow';
import PortalInput from '../components/common/PortalInput';
import SegmentedControl from '../components/common/SegmentedControl';
import AvatarConEstado from '../components/common/AvatarConEstado';
import { EmptyState, SkeletonText } from '../components/common/StateViews';
import useFotoDelTelefono from '../components/common/useFotoDelTelefono';
import useCoarsePointer from '../plataforma/useCoarsePointer';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { fotoDeCatalogo } from '../plataforma/imagenes';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { PROPS_CAMARA } from '@nucleo/utils/capturaDeFoto';
import { PRINCIPIO_PRESETS, editorDePrincipios, principiosParaGuardar } from '@nucleo/utils/edicionDeProducto';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { formatQty } from '@nucleo/utils/formatNumber';
import SrsBuscadorWidget from '../components/srs/SrsBuscadorWidget';
import { buscarEnSrsParaProducto } from '@nucleo/data/srs';
import { resultadoDeSrs } from '@nucleo/utils/srs';
import { SRS_AUTO_MIN, decidirSrs, principiosDeSrs } from '@nucleo/utils/enriquecerSrs';
import { buscarParaCarga, fetchColaDeCarga, fetchResumenDeCarga, guardarCarga, tomarProducto } from '@nucleo/data/fotosProductos';

const PhotoEditorModal = lazy(() => import('../components/common/PhotoEditorModal'));
const LectorDeCodigo = lazy(() => import('../components/common/LectorDeCodigo'));

// ═══════════════════════════════════════════════════════════════════════════
// Fotos de productos (2026-10-30) — completar la foto y el principio activo
// del catálogo, uno detrás de otro.
//
// Pedido del usuario: «un lugar en el cual se puedan subir las fotos de los
// productos de forma más fácil, foto y compuesto activo; así se lo asigno a una
// persona y lo va subiendo». Ese día faltaban 4,362 fotos y 3,632 principios
// sobre 4,382 productos activos: en la ficha del catálogo hay que buscar cada
// producto, abrirlo y volver a la lista. Acá la pantalla PONE el siguiente.
//
// ── Una cola común ─────────────────────────────────────────────────────────
// Decisión del usuario: no se reparten productos por persona; quien tiene el
// permiso toma el siguiente. Para que dos personas no hagan el mismo a la vez,
// abrir un producto lo TOMA por 15 minutos y la cola de los demás lo salta.
// Los que más se venden salen primero.
//
// ── Se publica de una vez ──────────────────────────────────────────────────
// Lo guardado va directo a la ficha (decisión del usuario). Queda quién lo hizo
// en `producto_carga_log` —el avance por persona de la columna derecha— y en la
// bitácora.
//
// ── Teléfono y computadora ─────────────────────────────────────────────────
// En el teléfono, «Tomar foto» abre la cámara. En la computadora, «Con el
// teléfono» pinta el QR de siempre y la foto llega sola a esta pantalla.
// ═══════════════════════════════════════════════════════════════════════════

const PESTANAS = [
    { key: 'cualquiera', label: 'Todo lo que falta', icon: Package },
    { key: 'foto', label: 'Sin foto', icon: Camera },
    { key: 'principio', label: 'Sin principio activo', icon: FlaskConical },
];

const avisar = (titulo, texto, tipo = 'error') => useToastStore.getState().showToast(titulo, texto, tipo);

export default function FotosProductosView() {
    const { hasPermission } = useAuth();
    const puedeEditar = hasPermission('fotos_productos', 'can_edit') || hasPermission('productos', 'can_edit');
    const [falta, setFalta] = usePestanaEnUrl(PESTANAS, 'cualquiera', 'falta');
    const [busqueda, setBusqueda] = useState('');
    const [lectorAbierto, setLectorAbierto] = useState(false);

    const [cola, setCola] = useState(null);
    const [elegido, setElegido] = useState(null);         // uno elegido desde la búsqueda
    const [resultados, setResultados] = useState(null);
    const [resumen, setResumen] = useState(null);
    const saltados = useRef(new Set());
    const [cuantosSaltados, setCuantosSaltados] = useState(0);

    const cargarResumen = useCallback(() => {
        fetchResumenDeCarga().then(setResumen)
            .catch((err) => console.error('FotosProductos: no se pudo leer el avance', err));
    }, []);

    const cargarCola = useCallback(async () => {
        try {
            const filas = await fetchColaDeCarga({ falta, limite: 60 + saltados.current.size });
            setCola(filas.filter((f) => !saltados.current.has(f.id)));
        } catch (err) {
            setCola([]);
            avisar('Fotos de productos', mensajeAmigable(err));
        }
    }, [falta]);

    useEffect(() => { cargarCola(); }, [cargarCola]);
    useEffect(() => { cargarResumen(); }, [cargarResumen]);

    // La búsqueda: nombre, principio activo o código de barras (el lector lo escribe acá).
    useEffect(() => {
        const q = busqueda.trim();
        if (q.length < 2) return undefined;
        let vivo = true;
        const t = setTimeout(() => {
            buscarParaCarga(q).then((r) => { if (vivo) setResultados(r); })
                .catch((err) => { if (vivo) { setResultados([]); avisar('Buscar', mensajeAmigable(err)); } });
        }, 250);
        return () => { vivo = false; clearTimeout(t); };
    }, [busqueda]);

    // Con menos de dos letras no hay búsqueda: lo que quedó de la anterior no se muestra.
    const enBusqueda = busqueda.trim().length >= 2 ? resultados : null;
    const actual = elegido ?? cola?.[0] ?? null;

    const pasar = (id, { saltar = false } = {}) => {
        if (saltar) { saltados.current.add(id); setCuantosSaltados(saltados.current.size); }
        if (elegido?.id === id) { setElegido(null); return; }
        setCola((prev) => {
            const resto = (prev || []).filter((f) => f.id !== id);
            if (resto.length < 5) setTimeout(cargarCola, 0);
            return resto;
        });
    };

    // Abrir un producto lo toma. Si otra persona ya lo tiene, se salta.
    useEffect(() => {
        if (!actual || !puedeEditar) return undefined;
        let vivo = true;
        tomarProducto(actual.id).then((r) => {
            if (!vivo || r?.ok) return;
            avisar('Ya lo están trabajando', `${shortEmployeeName(r?.tomado_por) || 'Otra persona'} tiene abierto este producto. Pasamos al siguiente.`, 'warning');
            if (elegido?.id === actual.id) setElegido(null);
            else pasar(actual.id);
        }).catch((err) => console.error('FotosProductos: no se pudo tomar el producto', err));
        return () => { vivo = false; };
    }, [actual?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const alGuardar = (id) => {
        cargarResumen();
        setBusqueda('');
        pasar(id);
    };

    const volverAEmpezar = () => { saltados.current = new Set(); setCuantosSaltados(0); setCola(null); cargarCola(); };

    const mias = resumen?.personas ?? [];

    return (
        <GlassViewLayout icon={Camera} title="Fotos de productos" transparentBody
            filtersContent={(
                <ViewTabBar tabs={PESTANAS} activeTab={falta} onTabChange={(k) => { setElegido(null); setCola(null); setFalta(k); }}
                    searchValue={busqueda} onSearchChange={setBusqueda}
                    onEscanear={() => setLectorAbierto(true)}
                    placeholder="Buscar un producto o escanear su código" />
            )}>
            <div className="p-4 md:p-6 space-y-5">
                <CarrilCards ariaLabel="Lo que falta en el catálogo">
                    <StatCard icon={Camera} iconBg="bg-warning/10" iconCls="text-warning-text" valueCls="text-warning-text"
                        label="Sin foto" value={formatQty(resumen?.faltan_foto ?? 0)} loading={!resumen} />
                    <StatCard icon={FlaskConical} iconBg="bg-chart-3/10" iconCls="text-chart-3-text" valueCls="text-chart-3-text"
                        label="Sin principio activo" value={formatQty(resumen?.faltan_principio ?? 0)} loading={!resumen} />
                    <StatCard icon={CheckCircle2} iconBg="bg-success/10" iconCls="text-success-text" valueCls="text-success-text"
                        label="Completados hoy" loading={!resumen}
                        value={formatQty(mias.reduce((s, p) => s + p.fotos_hoy + p.principios_hoy, 0))} />
                </CarrilCards>

                <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 items-start">
                    <div className="space-y-4 min-w-0">
                        {enBusqueda && (
                            <section data-surface="card" className="p-3 md:p-4 space-y-1">
                                <p className="text-label font-semibold text-content-2 px-1 pb-1">
                                    {enBusqueda.length ? 'Elige el producto' : 'No se encontró ningún producto'}
                                </p>
                                {enBusqueda.map((r) => (
                                    <ListRow key={r.id} density="sm"
                                        leading={<Miniatura src={r.foto_url} />}
                                        title={r.nombre}
                                        subtitle={[r.laboratorio, r.principio_activo].filter(Boolean).join(' · ') || 'Sin principio activo'}
                                        trailing={<Faltas p={r} />}
                                        onClick={() => { setElegido(r); setResultados(null); setBusqueda(''); }} />
                                ))}
                            </section>
                        )}

                        {!puedeEditar && (
                            <Notice variant="warning">Puedes ver la cola, pero no tienes permiso para guardar fotos ni principios activos.</Notice>
                        )}

                        {cola == null && !elegido ? (
                            <section data-surface="card" className="p-5"><SkeletonText lines={6} /></section>
                        ) : actual ? (
                            <FichaDeCarga key={actual.id} producto={actual} puedeEditar={puedeEditar}
                                quedan={elegido ? null : cola.length}
                                onGuardado={() => alGuardar(actual.id)}
                                onSaltar={() => pasar(actual.id, { saltar: true })} />
                        ) : (
                            <section data-surface="card" className="p-5">
                                <EmptyState icon={CheckCircle2} title="Sin productos pendientes en esta lista"
                                    subtitle={cuantosSaltados
                                        ? `Saltaste ${cuantosSaltados} producto(s). Puedes volver a verlos.`
                                        : 'Todos los productos activos están completos.'}
                                    action={cuantosSaltados ? <Button variant="secondary" onClick={volverAEmpezar}>Volver a los saltados</Button> : null} />
                            </section>
                        )}
                    </div>

                    <section data-surface="card" className="p-4 space-y-3">
                        <p className="text-label font-semibold text-content-2 flex items-center gap-1.5">
                            <Users size={14} /> Avance del equipo
                        </p>
                        {!resumen ? <SkeletonText lines={3} /> : mias.length === 0 ? (
                            <p className="text-caption text-content-3">Nadie ha completado productos en los últimos 7 días.</p>
                        ) : mias.map((p) => (
                            <div key={p.employee_id} className="flex items-center gap-2.5">
                                <AvatarConEstado emp={{ id: p.employee_id, name: p.name, nombre_corto: p.nombre_corto, photo_url: p.photo_url }} px={32} mostrarChip={false} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-label font-semibold text-content truncate">{shortEmployeeName(p)}</p>
                                    <p className="text-micro text-content-3">
                                        Hoy {p.fotos_hoy} foto(s) · {p.principios_hoy} principio(s)
                                    </p>
                                </div>
                                <Badge variant="neutral" title="Últimos 7 días">{p.fotos_semana + p.principios_semana}</Badge>
                            </div>
                        ))}
                    </section>
                </div>
            </div>

            {lectorAbierto && (
                <Suspense fallback={null}>
                    <LectorDeCodigo abierto={lectorAbierto} onCerrar={() => setLectorAbierto(false)}
                        onLeer={(codigo) => setBusqueda(codigo)} titulo="Escanear producto" />
                </Suspense>
            )}
        </GlassViewLayout>
    );
}

function Miniatura({ src, size = 40 }) {
    return src ? (
        <img src={src} alt="" width={size} height={size} className="rounded-lg object-contain bg-surface-card" style={{ width: size, height: size }} />
    ) : (
        <span className="flex items-center justify-center rounded-lg bg-surface-card-hover text-content-3" style={{ width: size, height: size }}>
            <Package size={size / 2} />
        </span>
    );
}

function Faltas({ p }) {
    if (!p.falta_foto && !p.falta_principio) return <Badge variant="success" icon={CheckCircle2}>Completo</Badge>;
    return (
        <span className="flex flex-wrap gap-1 justify-end">
            {p.falta_foto && <Badge variant="warning">Sin foto</Badge>}
            {p.falta_principio && <Badge variant="chart-3">Sin principio</Badge>}
        </span>
    );
}

// ── La ficha del producto que toca ─────────────────────────────────────────
// La foto nueva y los principios se guardan JUNTOS al apretar «Guardar y
// siguiente»: la foto se sube recién ahí, así que saltar un producto no deja
// archivos sueltos en el bucket.
//
// Tres atajos para que cada producto cueste segundos (2026-10-30, pedido del
// usuario: «que sea funcional, fácil de usar y muy útil»):
//  · el principio lo SUGIERE el registro sanitario apenas se abre el producto;
//  · en la computadora la foto entra pegándola (Ctrl+V), arrastrándola, o
//    buscándola en internet con el nombre ya escrito;
//  · ⌘/Ctrl+Enter guarda y pasa al siguiente.
function FichaDeCarga({ producto, puedeEditar, quedan, onGuardado, onSaltar }) {
    const esTactil = useCoarsePointer();
    const archivoRef = useRef(null);
    const camaraRef = useRef(null);
    const [pendiente, setPendiente] = useState(null);     // archivo elegido, todavía sin recortar
    const [fotoNueva, setFotoNueva] = useState(null);     // Blob recortado, listo para subir
    const [encima, setEncima] = useState(false);          // arrastrando una imagen sobre la foto
    const vistaNueva = useMemo(() => (fotoNueva ? URL.createObjectURL(fotoNueva) : null), [fotoNueva]);
    useEffect(() => () => { if (vistaNueva) URL.revokeObjectURL(vistaNueva); }, [vistaNueva]);

    const inicial = useMemo(() => editorDePrincipios(producto.principios || []), [producto.principios]);
    const [preset, setPreset] = useState(inicial.preset);
    const [items, setItems] = useState(inicial.items);
    const [tocoPrincipios, setTocoPrincipios] = useState(false);
    const [deSrs, setDeSrs] = useState(null);             // el registro de donde salió lo escrito
    const [guardando, setGuardando] = useState(false);

    const fotoDelTelefono = useFotoDelTelefono(setPendiente, {
        etiqueta: `Foto de ${producto.nombre}`,
        onError: (msg) => { if (msg) avisar('Foto', msg); },
    });

    const elegirArchivo = (e) => {
        const f = e.target.files?.[0];
        if (f) setPendiente(f);
        e.target.value = '';
    };

    // Pegar una imagen copiada (de internet, de WhatsApp Web…) en cualquier
    // parte de la pantalla. Si el foco está en un campo de texto y lo pegado es
    // texto, el campo lo recibe como siempre: sólo se toma una IMAGEN.
    useEffect(() => {
        if (!puedeEditar) return undefined;
        const alPegar = (e) => {
            for (const item of e.clipboardData?.items || []) {
                if (item.type.startsWith('image/')) {
                    const f = item.getAsFile();
                    if (f) { e.preventDefault(); setPendiente(f); return; }
                }
            }
        };
        document.addEventListener('paste', alPegar);
        return () => document.removeEventListener('paste', alPegar);
    }, [puedeEditar]);

    const soltar = (e) => {
        e.preventDefault();
        setEncima(false);
        const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
        if (f) setPendiente(f);
        else avisar('Foto', 'Suelta una imagen (JPG, PNG o WebP).', 'warning');
    };

    const buscarEnInternet = () => {
        const q = [producto.nombre, producto.laboratorio].filter(Boolean).join(' ');
        window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, '_blank', 'noopener');
    };

    const cambiar = (fn) => { setTocoPrincipios(true); fn(); };
    const elegirPreset = (p) => cambiar(() => {
        setDeSrs(null);
        if (preset === p) { setPreset(null); setItems([{ nombre: '', concentracion: '', orden: 0, _key: Date.now() }]); }
        else { setPreset(p); setItems([]); }
    });
    const agregar = () => cambiar(() => setItems((prev) => [...prev, { nombre: '', concentracion: '', orden: prev.length, _key: Date.now() }]));
    const quitar = (key) => cambiar(() => setItems((prev) => (prev.length > 1
        ? prev.filter((p) => p._key !== key)
        : [{ nombre: '', concentracion: '', orden: 0, _key: Date.now() }])));
    const editar = (key, campo, valor) => cambiar(() => setItems((prev) => prev.map((p) => (p._key === key ? { ...p, [campo]: valor } : p))));

    // Lo que trae un registro del SRS reemplaza lo escrito (un registro es UN
    // producto: sus principios van juntos, no se mezclan con los de otro).
    const usarSrs = useCallback((crudo) => {
        const lista = principiosDeSrs(crudo);
        if (!lista.length) { avisar('Registro sanitario', 'Ese registro no trae principio activo.', 'warning'); return; }
        setTocoPrincipios(true);
        setPreset(null);
        setItems(lista.map((p, i) => ({ ...p, _key: `srs-${Date.now()}-${i}` })));
        setDeSrs(resultadoDeSrs(crudo));
    }, []);

    const principios = tocoPrincipios ? principiosParaGuardar(producto.id, { preset, items }) : null;
    // Borrar todos los principios no se hace desde acá: la cola es para completar.
    const principiosValidos = principios && principios.rows.length > 0 ? principios : null;
    const hayCambios = !!fotoNueva || !!principiosValidos;

    const guardar = async () => {
        if (!hayCambios || guardando) return;
        setGuardando(true);
        try {
            let fotoUrl = null;
            if (fotoNueva) {
                const blob = await fotoDeCatalogo(fotoNueva, 800, 0.85);
                const url = await subirArchivo('product-photos', `${producto.id}.jpg`, blob, { upsert: true, contentType: 'image/jpeg' });
                fotoUrl = `${url}?t=${Date.now()}`;
            }
            await guardarCarga(producto.id, { fotoUrl, principios: principiosValidos },
                { producto: producto.nombre, ...(deSrs?.noregistro ? { registro_sanitario: deSrs.noregistro } : {}) });
            avisar('Guardado', producto.nombre, 'success');
            onGuardado();
        } catch (err) {
            avisar('No se pudo guardar', mensajeAmigable(err));
        } finally {
            setGuardando(false);
        }
    };

    // ⌘/Ctrl+Enter: guardar y siguiente sin soltar el teclado.
    const guardarRef = useRef(guardar);
    guardarRef.current = guardar;
    useEffect(() => {
        if (!puedeEditar) return undefined;
        const alTeclear = (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); guardarRef.current(); }
        };
        document.addEventListener('keydown', alTeclear);
        return () => document.removeEventListener('keydown', alTeclear);
    }, [puedeEditar]);

    const fotoVisible = vistaNueva || producto.foto_url;

    return (
        <section data-surface="card" className="p-4 md:p-5 space-y-5">
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-title font-bold text-content leading-tight">{producto.nombre}</h2>
                    <p className="text-caption text-content-3 mt-0.5">
                        {[producto.laboratorio, producto.codigo_barras && `Código ${producto.codigo_barras}`].filter(Boolean).join(' · ') || 'Sin laboratorio'}
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <Faltas p={producto} />
                    {quedan != null && <span className="text-micro text-content-3">{formatQty(quedan)} en la lista</span>}
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-5">
                {/* ── Foto ── */}
                <div className="space-y-2">
                    <p className="text-label font-semibold text-content-2 flex items-center gap-1.5"><Camera size={14} /> Foto</p>
                    <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={elegirArchivo} />
                    <input ref={camaraRef} type="file" {...PROPS_CAMARA} className="hidden" aria-hidden="true" tabIndex={-1} onChange={elegirArchivo} />
                    <button type="button" disabled={!puedeEditar}
                        onClick={() => (esTactil ? camaraRef : archivoRef).current?.click()}
                        onDragOver={(e) => { e.preventDefault(); if (!encima) setEncima(true); }}
                        onDragLeave={() => setEncima(false)}
                        onDrop={puedeEditar ? soltar : undefined}
                        className={`relative w-full aspect-square max-w-[240px] rounded-2xl border-2 border-dashed overflow-hidden bg-surface-card active:scale-[0.97] transition-[transform,border-color] ${encima ? 'border-brand' : 'border-divider'}`}>
                        {fotoVisible ? (
                            <img src={fotoVisible} alt="" className="w-full h-full object-contain p-2" />
                        ) : (
                            <span className="w-full h-full flex flex-col items-center justify-center gap-2 px-4 text-center text-content-3">
                                <ImagePlus size={32} />
                                <span className="text-caption font-semibold">{esTactil ? 'Tomar foto' : 'Subir, arrastrar o pegar (Ctrl+V)'}</span>
                            </span>
                        )}
                        {vistaNueva && <Badge variant="success" className="absolute top-2 left-2">Nueva</Badge>}
                    </button>
                    {puedeEditar && (
                        <div className="flex flex-wrap gap-1.5">
                            {esTactil && <Button variant="secondary" size="sm" icon={Camera} onClick={() => camaraRef.current?.click()}>Tomar foto</Button>}
                            {!esTactil && (
                                <Button variant="secondary" size="sm" icon={Smartphone}
                                    loading={fotoDelTelefono.pidiendo} disabled={fotoDelTelefono.esperando}
                                    onClick={fotoDelTelefono.pedir}>
                                    {fotoDelTelefono.esperando ? 'Esperando el teléfono…' : 'Con el teléfono'}
                                </Button>
                            )}
                            <Button variant="ghost" size="sm" icon={Globe} onClick={buscarEnInternet}
                                title="Abre la búsqueda de imágenes con el nombre del producto: copia una y pégala aquí">
                                Buscar en internet
                            </Button>
                            <Button variant="ghost" size="sm" icon={ImagePlus} onClick={() => archivoRef.current?.click()}>Elegir archivo</Button>
                            {fotoNueva && <Button variant="ghost" size="sm" icon={X} onClick={() => setFotoNueva(null)}>Descartar</Button>}
                        </div>
                    )}
                    {fotoDelTelefono.dialogo}
                    {pendiente && (
                        <Suspense fallback={null}>
                            <PhotoEditorModal file={pendiente}
                                onConfirm={(blob) => { setPendiente(null); setFotoNueva(blob); }}
                                onCancel={() => setPendiente(null)} />
                        </Suspense>
                    )}
                </div>

                {/* ── Principio activo ── */}
                <div className="space-y-3 min-w-0">
                    <div className="space-y-2">
                        <p className="text-label font-semibold text-content-2 flex items-center gap-1.5"><FlaskConical size={14} /> Principio activo</p>
                        <SegmentedControl size="sm" label="No es un medicamento" value={preset} onChange={elegirPreset}
                            options={PRINCIPIO_PRESETS.map((p) => ({ value: p, label: p }))} />
                        {!preset && (
                            <div className="space-y-1.5">
                                {items.map((it, i) => (
                                    <div key={it._key} className="flex items-center gap-1.5">
                                        <span className="text-micro font-bold w-4 text-right shrink-0 text-content-3">{i + 1}</span>
                                        <PortalInput aria-label="Nombre del principio activo" value={it.nombre} readOnly={!puedeEditar}
                                            onChange={(e) => editar(it._key, 'nombre', e.target.value)}
                                            placeholder="Ej. Amoxicilina" className="flex-1 min-w-0" />
                                        <PortalInput aria-label="Concentración" value={it.concentracion || ''} readOnly={!puedeEditar}
                                            onChange={(e) => editar(it._key, 'concentracion', e.target.value)}
                                            placeholder="500mg" inputClassName="text-center" className="w-28 shrink-0" />
                                        <Button variant="ghost" size="sm" icon={X} iconOnly title="Quitar" disabled={!puedeEditar} onClick={() => quitar(it._key)} />
                                    </div>
                                ))}
                                {puedeEditar && <Button variant="ghost" size="sm" icon={Plus} onClick={agregar}>Agregar otro principio</Button>}
                            </div>
                        )}
                        {deSrs && !preset && (
                            <Notice variant="chart-3" compact>
                                {`Tomado del registro ${deSrs.noregistro || 'sanitario'} (${deSrs.nombre}). Revísalo contra el empaque antes de guardar.`}
                            </Notice>
                        )}
                    </div>

                    {puedeEditar && !preset && (
                        <SugerenciasSrs producto={producto} onUsar={usarSrs}
                            autoAplicar={producto.falta_principio && !tocoPrincipios} />
                    )}
                </div>
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {!esTactil && puedeEditar && <span className="text-micro text-content-3 mr-auto">⌘/Ctrl + Enter guarda y pasa al siguiente</span>}
                <Button variant="ghost" icon={SkipForward} onClick={onSaltar} disabled={guardando}>Saltar</Button>
                {puedeEditar && (
                    <Button variant="primary" icon={guardando ? Loader2 : CheckCircle2} loading={guardando}
                        disabled={!hayCambios} onClick={guardar}>
                        Guardar y siguiente
                    </Button>
                )}
            </footer>
        </section>
    );
}

// ── Lo que dice el registro sanitario ──────────────────────────────────────
// Se busca solo al abrir el producto, con las mismas búsquedas y la misma
// medida de parecido que «Enriquecer SRS» del catálogo (`utils/enriquecerSrs`):
// así lo que acá se sugiere y lo que allá se aplica en lote no se contradicen.
// Con el producto SIN principio y un candidato de 70% o más, se precarga
// (`autoAplicar`) — la persona lo revisa y guarda; nunca se guarda solo.
function SugerenciasSrs({ producto, onUsar, autoAplicar }) {
    const [estado, setEstado] = useState({ cargando: true, candidatos: [], error: null });
    const [buscarOtro, setBuscarOtro] = useState(false);
    const aplicar = useRef(autoAplicar);

    useEffect(() => {
        let vivo = true;
        buscarEnSrsParaProducto({ nombre: producto.nombre, laboratorios: { nombre: producto.laboratorio } })
            .then((json) => {
                if (!vivo) return;
                const { tipo, entrada } = decidirSrs({ nombre: producto.nombre }, json.data || []);
                const candidatos = (entrada?.candidates || []).filter((c) => principiosDeSrs(c.srs).length);
                setEstado({ cargando: false, candidatos, error: null });
                if (tipo === 'auto' && aplicar.current && candidatos[0]?.srs === entrada.srs) onUsar(entrada.srs);
            })
            .catch((err) => { if (vivo) setEstado({ cargando: false, candidatos: [], error: mensajeAmigable(err) }); });
        return () => { vivo = false; };
    }, [producto.id]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="space-y-2 pt-1 border-t border-divider">
            <div className="flex items-center justify-between gap-2 pt-2">
                <p className="text-label font-semibold text-content-2 flex items-center gap-1.5"><Search size={14} /> Registro sanitario</p>
                <Button variant="ghost" size="sm" onClick={() => setBuscarOtro((v) => !v)}>
                    {buscarOtro ? 'Cerrar búsqueda' : 'Buscar otro'}
                </Button>
            </div>
            {estado.cargando ? (
                <p className="text-caption text-content-3 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Buscando coincidencias…</p>
            ) : estado.error ? (
                <Notice variant="warning" compact>{`No se pudo consultar el registro: ${estado.error}`}</Notice>
            ) : estado.candidatos.length === 0 ? (
                <p className="text-caption text-content-3">Sin coincidencias con principio activo. Prueba con «Buscar otro» o escríbelo del empaque.</p>
            ) : (
                <div className="space-y-1.5">
                    {estado.candidatos.map(({ srs, score }) => {
                        const r = resultadoDeSrs(srs);
                        return (
                            <ListRow key={srs.id ?? r.noregistro} density="sm"
                                icon={FlaskConical} iconClass="text-chart-3-text"
                                title={[r.principio, r.conc].filter(Boolean).join(' · ')}
                                subtitle={[r.nombre, r.lab, r.forma, r.noregistro].filter(Boolean).join(' · ')}
                                trailing={(
                                    <span className="flex items-center gap-2 shrink-0">
                                        <Badge variant={score >= SRS_AUTO_MIN ? 'success' : 'neutral'} title="Qué tanto se parece el nombre">
                                            {`${Math.round(score * 100)}%`}
                                        </Badge>
                                        <span className="text-label font-semibold text-brand-text">Usar</span>
                                    </span>
                                )}
                                onClick={() => onUsar(srs)} />
                        );
                    })}
                </div>
            )}
            {buscarOtro && (
                <SrsBuscadorWidget initialQuery={producto.nombre}
                    onSelectResult={(crudo) => { onUsar(crudo); setBuscarOtro(false); }} />
            )}
        </div>
    );
}
