/**
 * Novedades (2026-11-16) — lo nuevo del portal y la app, para el personal.
 *
 * Pedido del usuario: que las sucursales tengan SIEMPRE dónde enterarse de los
 * cambios, con una animación o una foto de cómo se hace cada uno.
 *
 *   · El contenido vive en `@nucleo/constants/novedades` (una tanda por
 *     quincena). Cada novedad nombra el módulo que exige: quien no lo puede
 *     ver, no la ve.
 *   · «Revisada» se guarda en este dispositivo (es una comodidad, no un
 *     registro).
 *   · La tarjeta de la app del personal lleva el enlace de App Store y, para
 *     Android, el campo del correo de Google: entra a la prueba interna y pone
 *     al día la ficha de empleado y la de cliente (`@nucleo/data/novedades`).
 *   · Quien edita el módulo ve la pestaña «Prueba Android»: la lista de correos
 *     para agregarlos en Google Play y marcarlos como agregados.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Megaphone, Smartphone, Receipt, Tag, UserPlus, ShoppingBag, Truck, CalendarClock,
    PackageCheck, ClipboardCheck, CircleAlert, ShieldCheck, Star, Sparkles, ChevronDown,
    Check, ArrowRight, Apple, Mail, Copy, Users, Maximize2,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import TituloDeSeccion from '../components/common/TituloDeSeccion';
import LiquidModal from '../components/common/LiquidModal';
import PortalInput from '../components/common/PortalInput';
import SegmentedControl from '../components/common/SegmentedControl';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import { EmptyState } from '../components/common/StateViews';
import PersonaConFoto from '../components/caja/PersonaConFoto';
import usePestanaEnUrl from '../plataforma/usePestanaEnUrl';
import * as almacen from '../plataforma/almacen';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore } from '@nucleo/store/staffStore';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { clickable } from '@nucleo/utils/clickable';
import { TEMAS, APP_PERSONAL_IOS, novedadesVisibles } from '@nucleo/constants/novedades';
import {
    registrarCorreoAndroid, fetchMiCorreoAndroid, fetchPruebasAndroid, marcarAgregadosEnPlay, mensajeDeNovedades,
} from '@nucleo/data/novedades';

const ICONOS = { Smartphone, Receipt, Tag, UserPlus, ShoppingBag, Truck, CalendarClock, PackageCheck, ClipboardCheck, CircleAlert, ShieldCheck, Star };

const dia = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'long' }) : '');

// «Revisada» por persona y dispositivo. El id de la tanda va en la clave de
// cada novedad, así una tanda nueva arranca en cero.
const claveRevisadas = (empId) => `novedades-revisadas:${empId || 'anon'}`;
function leerRevisadas(empId) {
    try { return new Set(JSON.parse(almacen.leer(claveRevisadas(empId)) || '[]')); } catch { return new Set(); }
}
function guardarRevisadas(empId, set) {
    try { almacen.guardar(claveRevisadas(empId), JSON.stringify([...set])); } catch { /* sin espacio: sigue en memoria */ }
}

export default function NovedadesView() {
    const { user, hasPermission } = useAuth();
    const puedeVer = useCallback((m) => hasPermission(m, 'can_view'), [hasPermission]);
    const puedeAdministrar = hasPermission('novedades', 'can_edit');

    const pestanas = useMemo(() => [
        { key: 'novedades', label: 'Lo nuevo', icon: Sparkles },
        ...(puedeAdministrar ? [{ key: 'android', label: 'Prueba Android', icon: Smartphone }] : []),
    ], [puedeAdministrar]);
    const [pestana, setPestana] = usePestanaEnUrl(pestanas, 'novedades');
    const [busqueda, setBusqueda] = useState('');

    return (
        <GlassViewLayout icon={Megaphone} title="Novedades" filtersContent={(
            <ViewTabBar tabs={pestanas} activeTab={pestana} onTabChange={setPestana}
                searchValue={busqueda} onSearchChange={setBusqueda}
                placeholder={pestana === 'android' ? 'Buscar por nombre o correo…' : 'Buscar una novedad…'} />
        )}>
            {pestana === 'android'
                ? <PruebaAndroid busqueda={busqueda} />
                : <LoNuevo user={user} puedeVer={puedeVer} busqueda={busqueda} />}
        </GlassViewLayout>
    );
}

// ── Lo nuevo ────────────────────────────────────────────────────────────────

function LoNuevo({ user, puedeVer, busqueda }) {
    const empId = user?.id;
    const [tema, setTema] = useState('todos');
    const [revisadas, setRevisadas] = useState(() => leerRevisadas(empId));
    const tandas = useMemo(() => novedadesVisibles(puedeVer), [puedeVer]);
    const todas = useMemo(() => tandas.flatMap((t) => t.novedades.map((n) => ({ ...n, tanda: t.id }))), [tandas]);
    const [abiertas, setAbiertas] = useState(() => {
        const primera = todas.find((n) => !leerRevisadas(empId).has(`${n.tanda}:${n.id}`));
        return new Set(primera ? [primera.id] : []);
    });
    const [ampliada, setAmpliada] = useState(null);

    useEffect(() => { setRevisadas(leerRevisadas(empId)); }, [empId]);

    const filtrar = (n) => (tema === 'todos' || n.tema === tema)
        && (!busqueda.trim() || tokenMatch(busqueda, n.titulo, n.resumen, n.donde, ...(n.pasos || [])));

    const total = todas.length;
    const hechas = todas.filter((n) => revisadas.has(`${n.tanda}:${n.id}`)).length;

    const alternarRevisada = (n) => {
        const k = `${n.tanda}:${n.id}`;
        const sig = new Set(revisadas);
        if (sig.has(k)) sig.delete(k); else sig.add(k);
        setRevisadas(sig);
        guardarRevisadas(empId, sig);
    };
    const alternarAbierta = (id) => setAbiertas((p) => { const s = new Set(p); if (s.has(id)) s.delete(id); else s.add(id); return s; });

    const temasConCuenta = TEMAS
        .map((t) => ({ ...t, n: t.value === 'todos' ? total : todas.filter((x) => x.tema === t.value).length }))
        .filter((t) => t.n > 0)
        .map((t) => ({ value: t.value, label: `${t.label} · ${t.n}` }));

    return (
        <div className="p-4 md:p-6 flex flex-col gap-5">
            <section data-surface="card" className="p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 max-w-2xl">
                    <h2 className="text-title font-black text-content">Lo que cambió en el portal y la app</h2>
                    <p className="text-body-sm text-content-2 mt-1">
                        Aquí ves solo lo que puedes usar con tu cargo. Abre cada novedad para ver cómo se hace.
                    </p>
                </div>
                <div className="flex flex-col gap-1.5 min-w-[200px]" aria-live="polite">
                    <span className="text-body-sm text-content-2">
                        <b className="text-content tabular-nums">{hechas}</b> de <b className="text-content tabular-nums">{total}</b> revisadas
                    </span>
                    <div className="h-2 rounded-full bg-surface-card-hover overflow-hidden">
                        <div className="h-full bg-brand rounded-full transition-[width] duration-[var(--dur-lento)]" style={{ width: `${total ? (hechas / total) * 100 : 0}%` }} />
                    </div>
                </div>
            </section>

            {temasConCuenta.length > 2 && (
                <SegmentedControl options={temasConCuenta} value={tema} onChange={setTema} size="sm" />
            )}

            {tandas.map((t) => {
                const visibles = t.novedades.filter(filtrar);
                if (!visibles.length) return null;
                return (
                    <section key={t.id} className="flex flex-col gap-3">
                        <TituloDeSeccion nivel="seccion" tono="tenue">
                            {t.titulo} · del {dia(t.desde)} al {dia(t.hasta)}
                        </TituloDeSeccion>
                        {visibles.map((n) => (
                            <Novedad key={n.id} n={n} abierta={abiertas.has(n.id)} revisada={revisadas.has(`${t.id}:${n.id}`)}
                                onAlternar={() => alternarAbierta(n.id)} onRevisada={() => alternarRevisada({ ...n, tanda: t.id })}
                                onAmpliar={() => setAmpliada(n)} user={user} />
                        ))}
                    </section>
                );
            })}

            {!todas.some(filtrar) && (
                <EmptyState icon={Sparkles} title="Sin novedades con ese filtro" subtitle="Prueba con Todo o borra la búsqueda." />
            )}

            {ampliada && (
                <LiquidModal open onClose={() => setAmpliada(null)} maxWidth="max-w-6xl" ariaLabel={ampliada.titulo}>
                    <LiquidModal.Header titulo={ampliada.titulo} subtitulo={ampliada.donde} onClose={() => setAmpliada(null)} />
                    <LiquidModal.Body>
                        <img src={ampliada.media.src} alt={`Cómo se hace: ${ampliada.titulo}`} className="w-full rounded-lg border border-border-subtle" />
                    </LiquidModal.Body>
                </LiquidModal>
            )}
        </div>
    );
}

function Novedad({ n, abierta, revisada, onAlternar, onRevisada, onAmpliar, user }) {
    const navigate = useNavigate();
    const Icono = ICONOS[n.icono] || Sparkles;
    const idCuerpo = `novedad-${n.id}`;
    return (
        <article data-surface="card" className="overflow-hidden" data-testid={`novedad-${n.id}`}>
            <div className="p-4 md:p-5 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-4 items-center cursor-pointer min-h-[var(--tap-min)]"
                {...clickable(onAlternar)} aria-expanded={abierta} aria-controls={idCuerpo}>
                <span className="w-12 h-12 rounded-xl bg-brand/10 text-brand-text grid place-items-center shrink-0">
                    <Icono size={22} />
                </span>
                <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-1">
                        {n.nuevo && <Badge variant="success">Nuevo</Badge>}
                        {revisada && <Badge variant="info" icon={Check}>Revisada</Badge>}
                    </div>
                    <h4 className="text-body-lg font-black text-content leading-tight">{n.titulo}</h4>
                    <p className="text-body-sm text-content-2 mt-1">{n.resumen}</p>
                </div>
                <ChevronDown size={20} className={`text-content-3 transition-transform duration-[var(--dur-fast)] ${abierta ? 'rotate-180' : ''}`} aria-hidden />
            </div>

            {abierta && (
                <div id={idCuerpo} className="border-t border-border-subtle p-4 md:p-5 grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-5 items-start">
                    <Medio n={n} onAmpliar={onAmpliar} />
                    <div className="flex flex-col gap-4 min-w-0">
                        <Bloque titulo="Para qué te sirve"><p className="text-body text-content">{n.para}</p></Bloque>
                        <Bloque titulo="Cómo se usa">
                            <ol className="flex flex-col gap-2">
                                {n.pasos.map((p, i) => (
                                    <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5 items-start">
                                        <span className="w-7 h-7 rounded-full bg-brand text-white text-caption font-black grid place-items-center tabular-nums">{i + 1}</span>
                                        <span className="text-body text-content pt-0.5">{p}</span>
                                    </li>
                                ))}
                            </ol>
                        </Bloque>
                        {n.ojo?.length > 0 && (
                            <Bloque titulo="Ten en cuenta">
                                <ul className="list-disc pl-5 flex flex-col gap-1 text-body-sm text-content-2">
                                    {n.ojo.map((o, i) => <li key={i}>{o}</li>)}
                                </ul>
                            </Bloque>
                        )}
                        <div className="rounded-lg bg-surface-card-hover px-3.5 py-2.5 text-body-sm text-content-2">
                            Dónde está: <b className="text-brand-text">{n.donde}</b>
                        </div>
                        {n.especial === 'app-personal' && <InstalarApp user={user} />}
                        <div className="flex flex-wrap gap-2">
                            {n.ruta && <Button variant="secondary" icon={ArrowRight} onClick={() => navigate(n.ruta)}>Ir ahí</Button>}
                            <Button variant={revisada ? 'ghost' : 'primary'} icon={Check} onClick={onRevisada}>
                                {revisada ? 'Revisada' : 'Marcar como revisada'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </article>
    );
}

function Bloque({ titulo, children }) {
    return (
        <div className="flex flex-col gap-1.5">
            <TituloDeSeccion nivel="seccion" tono="brand" as="h5">{titulo}</TituloDeSeccion>
            {children}
        </div>
    );
}

function Medio({ n, onAmpliar }) {
    if (!n.media) return null;
    if (n.media.tipo === 'icono') {
        return (
            <div className="rounded-xl bg-surface-card-hover p-6 grid place-items-center">
                <img src={n.media.src} alt="Ícono de la app del personal" className="w-28 h-28 rounded-3xl shadow-lg" />
            </div>
        );
    }
    return (
        <figure className="flex flex-col gap-1.5 min-w-0">
            <div className="relative rounded-lg overflow-hidden border border-border-subtle bg-surface-card-hover cursor-zoom-in" {...clickable(onAmpliar)}
                aria-label="Ver la captura grande">
                <img src={n.media.src} alt={`Cómo se hace: ${n.titulo}`} loading="lazy" className="block w-full h-auto" />
                <span className="absolute top-2 right-2 rounded-full bg-surface-card p-1.5 text-content-2"><Maximize2 size={14} /></span>
            </div>
            <figcaption className="text-caption text-content-3 text-center">
                {n.media.tipo === 'animacion' ? 'Animación: así se hace. ' : ''}Tócala para verla grande.
            </figcaption>
        </figure>
    );
}

// ── La app del personal: iPhone por App Store, Android por la prueba ───────

const esAndroid = () => /android/i.test(globalThis.navigator?.userAgent || '');
const esIphone = () => /iphone|ipad|ipod/i.test(globalThis.navigator?.userAgent || '');

function InstalarApp({ user }) {
    const showToast = useToastStore((s) => s.showToast);
    const [correo, setCorreo] = useState('');
    const [guardado, setGuardado] = useState(undefined);
    const [ocupado, setOcupado] = useState(false);
    const android = esAndroid();
    const iphone = esIphone();

    useEffect(() => {
        let vivo = true;
        fetchMiCorreoAndroid(user?.id)
            .then((d) => { if (vivo) { setGuardado(d); if (d?.email) setCorreo(d.email); } })
            .catch(() => { if (vivo) setGuardado(null); });
        return () => { vivo = false; };
    }, [user?.id]);

    const valido = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(correo.trim());
    const guardar = async () => {
        setOcupado(true);
        try {
            const r = await registrarCorreoAndroid(correo.trim());
            setGuardado({ email: r.correo, agregado_at: guardado?.email === r.correo ? guardado.agregado_at : null });
            const ficha = r.fichaDeCliente === 'actualizada' ? ' y en tu ficha de cliente'
                : r.fichaDeCliente === 'pendiente' ? '. Tu ficha de cliente se actualiza después' : '';
            showToast('Correo guardado', `Quedó en tu ficha de empleado${ficha}. Te avisamos cuando puedas instalar la app.`, 'success');
        } catch (e) {
            showToast('No se pudo guardar', mensajeDeNovedades(e), 'error');
        } finally { setOcupado(false); }
    };

    const abrirAppStore = () => { globalThis.open?.(APP_PERSONAL_IOS, '_blank', 'noopener'); };

    const ios = (
        <div className="rounded-lg border border-border-subtle p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 font-black text-content"><Apple size={18} /> iPhone</div>
            <p className="text-body-sm text-content-2">Instálala desde App Store y entra con tu usuario del portal.</p>
            <Button icon={Apple} onClick={abrirAppStore}>Abrir en App Store</Button>
        </div>
    );
    const androide = (
        <div className="rounded-lg border border-border-subtle p-4 flex flex-col gap-3" data-campo="correo-android">
            <div className="flex items-center gap-2 font-black text-content"><Smartphone size={18} /> Android</div>
            <p className="text-body-sm text-content-2">
                Escribe el correo de tu cuenta de Google, el que usas en Play Store. Te agregamos a la prueba de la app.
            </p>
            <PortalInput label="Correo de Google" name="correo-android" type="email" icon={Mail} value={correo}
                placeholder="nombre@gmail.com" onChange={(e) => setCorreo(e.target.value)}
                hasError={!!correo && !valido} errorMessage="Revisa el correo: debe verse como nombre@gmail.com." />
            {guardado?.email && (
                <Notice variant={guardado.agregado_at ? 'success' : 'info'} compact>
                    {guardado.agregado_at
                        ? `Ya estás en la prueba con ${guardado.email}. Busca la invitación en ese correo.`
                        : `Recibimos ${guardado.email}. Te avisamos cuando te agreguemos.`}
                </Notice>
            )}
            <Button icon={Check} loading={ocupado} disabled={!valido || correo.trim().toLowerCase() === guardado?.email}
                onClick={guardar}>
                Guardar
            </Button>
        </div>
    );

    // En el teléfono se muestra primero (o solo) el que corresponde.
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {android ? <>{androide}{ios}</> : iphone ? <>{ios}{androide}</> : <>{ios}{androide}</>}
        </div>
    );
}

// ── Prueba Android (administración) ────────────────────────────────────────

const COLUMNAS = [
    { key: 'persona', label: 'Persona' },
    { key: 'sucursal', label: 'Sucursal', hideBelow: 'md' },
    { key: 'correo', label: 'Correo' },
    { key: 'estado', label: 'Estado' },
];

function PruebaAndroid({ busqueda }) {
    const showToast = useToastStore((s) => s.showToast);
    const branches = useStaffStore((s) => s.branches);
    const [filas, setFilas] = useState(null);
    const [ocupado, setOcupado] = useState(false);

    const cargar = useCallback(() => {
        fetchPruebasAndroid()
            .then(setFilas)
            .catch((e) => { setFilas([]); showToast('No se pudo cargar', mensajeDeNovedades(e), 'error'); });
    }, [showToast]);
    useEffect(() => { cargar(); }, [cargar]);

    const sala = (id) => (branches ?? []).find((b) => b.id === id)?.name ?? '—';
    const visibles = (filas ?? []).filter((f) => !busqueda.trim() || tokenMatch(busqueda, f.email, f.empleado?.name));
    const porAgregar = (filas ?? []).filter((f) => !f.agregado_at);

    const copiar = async () => {
        const texto = porAgregar.map((f) => f.email).join(', ');
        try {
            await globalThis.navigator.clipboard.writeText(texto);
            showToast('Correos copiados', `${porAgregar.length} para pegar en la lista de la prueba interna.`, 'success');
        } catch {
            showToast('No se pudo copiar', texto, 'warning');
        }
    };
    const marcar = async () => {
        setOcupado(true);
        try {
            const n = await marcarAgregadosEnPlay(porAgregar.map((f) => f.employee_id));
            showToast('Listo', `${n} marcados como agregados.`, 'success');
            cargar();
        } catch (e) {
            showToast('No se pudo marcar', mensajeDeNovedades(e), 'error');
        } finally { setOcupado(false); }
    };

    return (
        <div className="p-4 md:p-6 flex flex-col gap-4">
            <Notice variant="info">
                Pega los correos en Google Play Console → la app del personal → Pruebas internas → Testers. Después toca «Marcar como agregados».
            </Notice>
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={Copy} disabled={!porAgregar.length} onClick={copiar}>
                    Copiar correos por agregar ({porAgregar.length})
                </Button>
                <Button icon={Check} loading={ocupado} disabled={!porAgregar.length} onClick={marcar}>
                    Marcar como agregados
                </Button>
            </div>
            <DataTable columns={COLUMNAS} loading={filas === null} minWidth="640px"
                empty={{ icon: Users, message: 'Todavía nadie dejó su correo' }}>
                {visibles.map((f, i) => (
                    <DataRow key={f.employee_id} index={i}>
                        <DataCell>
                            <PersonaConFoto id={f.employee_id} nombre={f.empleado?.name ? shortEmployeeName(f.empleado.name) : null} px={28} />
                        </DataCell>
                        <DataCell>{sala(f.empleado?.branch_id)}</DataCell>
                        <DataCell><span className="text-body-sm text-content break-all">{f.email}</span></DataCell>
                        <DataCell>
                            {f.agregado_at
                                ? <Badge variant="success" uppercase={false}>Agregado el {dia(f.agregado_at)}</Badge>
                                : <Badge variant="warning" uppercase={false}>Por agregar</Badge>}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
        </div>
    );
}

