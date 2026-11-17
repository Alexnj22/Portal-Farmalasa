/**
 * Novedades (2026-11-16) — lo nuevo del portal y la app, para el personal.
 *
 * Pedido del usuario: que las sucursales tengan SIEMPRE dónde enterarse de los
 * cambios, con una animación o una foto de cómo se hace cada uno, y que cada
 * cargo lea lo que le toca.
 *
 *   · El contenido vive en `@nucleo/constants/novedades` (una tanda por
 *     quincena). Cada novedad y cada paso dicen quién los ve (`cumple`).
 *   · Arriba va la app del personal (descargarla y activarla); abajo, una
 *     galería de tarjetas con la animación de cada novedad. Al tocar una se
 *     abre el detalle: la animación grande, para qué sirve y los pasos.
 *   · Las tarjetas muestran una imagen fija; la animación corre al abrirla.
 *   · Abrir una novedad la marca como revisada, en este dispositivo
 *     (comodidad, no registro).
 *   · «Ver como»: quien administra Novedades ve lo que lee cada cargo, con los
 *     permisos reales de ese cargo.
 *   · Android: la app se baja de la prueba interna de Google Play. La persona
 *     deja su correo de Google; administración lo agrega en Play Console y lo
 *     marca en la pestaña «Android». La base le manda un aviso (campana y
 *     teléfono) que trae a `?app=android`, donde ya está encendido el botón
 *     de Google Play con los pasos.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Megaphone, Smartphone, Receipt, Tag, UserPlus, ShoppingBag, Truck, CalendarClock,
    PackageCheck, ClipboardCheck, CircleAlert, ShieldCheck, Star, Sparkles,
    Check, ArrowRight, Apple, Mail, Copy, Users, Eye, Play, ChevronLeft, ChevronRight, MapPin,
    ExternalLink, BellRing, PartyPopper, UserRound, CreditCard, FileText, Archive, Inbox,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import TituloDeSeccion from '../components/common/TituloDeSeccion';
import LiquidModal from '../components/common/LiquidModal';
import PieDeModal from '../components/common/PieDeModal';
import PortalInput from '../components/common/PortalInput';
import SegmentedControl from '../components/common/SegmentedControl';
import LiquidSelect from '../components/common/LiquidSelect';
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
import {
    TEMAS, APP_PERSONAL_IOS, APP_PERSONAL_ANDROID, APP_PERSONAL_NOMBRE, novedadesVisibles,
} from '@nucleo/constants/novedades';
import {
    registrarCorreoAndroid, fetchMiCorreoAndroid, fetchPruebasAndroid, marcarAgregadosEnPlay, mensajeDeNovedades,
    fetchPermisosDeCargo, reenviarAvisoAndroid,
} from '@nucleo/data/novedades';

const ICONOS = {
    Smartphone, Receipt, Tag, UserPlus, ShoppingBag, Truck, CalendarClock, PackageCheck, ClipboardCheck, CircleAlert, ShieldCheck, Star,
    UserRound, CreditCard, FileText, Users, Archive, Inbox,
};

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

const esAndroid = () => /android/i.test(globalThis.navigator?.userAgent || '');
const esIphone = () => /iphone|ipad|ipod/i.test(globalThis.navigator?.userAgent || '');
const abrir = (url) => { globalThis.open?.(url, '_blank', 'noopener'); };
const PLAY_CONSOLE = 'https://play.google.com/console';

export default function NovedadesView() {
    const { user, hasPermission } = useAuth();
    const puedeAdministrar = hasPermission('novedades', 'can_edit');
    const roles = useStaffStore((s) => s.roles);
    const miCargo = user?.roleId ?? (Number.isInteger(user?.role) ? user.role : null);

    const [verComo, setVerComo] = useState(null);
    const [leidos, setLeidos] = useState({ roleId: null, mapa: null });
    const showToast = useToastStore((s) => s.showToast);
    useEffect(() => {
        if (!verComo) return undefined;
        let vivo = true;
        fetchPermisosDeCargo(verComo)
            .then((mapa) => { if (vivo) setLeidos({ roleId: verComo, mapa }); })
            .catch(() => { if (vivo) { setVerComo(null); showToast('No se pudo cargar', 'No se pudieron leer los permisos de ese cargo.', 'error'); } });
        return () => { vivo = false; };
    }, [verComo, showToast]);
    const permisosAjenos = verComo && leidos.roleId === verComo ? leidos.mapa : null;

    const ctx = useMemo(() => {
        if (verComo && permisosAjenos) {
            return { roleId: verComo, puede: (m, nivel = 'can_view') => !!permisosAjenos[m]?.[nivel], simulado: true };
        }
        return { roleId: miCargo, puede: (m, nivel = 'can_view') => hasPermission(m, nivel), simulado: false };
    }, [verComo, permisosAjenos, miCargo, hasPermission]);
    const cargoVisto = (roles ?? []).find((r) => r.id === ctx.roleId)?.name ?? null;
    const opcionesDeCargo = useMemo(() => (roles ?? [])
        .filter((r) => !r.is_su)
        .map((r) => ({ value: r.id, label: r.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')), [roles]);

    const pestanas = useMemo(() => [
        { key: 'novedades', label: 'Lo nuevo', icon: Sparkles },
        ...(puedeAdministrar ? [{ key: 'android', label: 'Android', icon: Smartphone }] : []),
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
                : (
                    <LoNuevo key={ctx.roleId ?? 'yo'} user={user} ctx={ctx} cargo={cargoVisto} busqueda={busqueda}
                        cargando={!!verComo && !permisosAjenos}
                        verComo={puedeAdministrar ? (
                            <div className="w-full sm:w-72">
                                <LiquidSelect icon={Eye} value={verComo} onChange={(v) => setVerComo(v || null)}
                                    options={opcionesDeCargo} placeholder="Ver como otro cargo" clearable />
                            </div>
                        ) : null} />
                )}
        </GlassViewLayout>
    );
}

// ── Lo nuevo ────────────────────────────────────────────────────────────────

function LoNuevo({ user, ctx, cargo, busqueda, verComo, cargando }) {
    const empId = user?.id;
    const [tema, setTema] = useState('todos');
    const [revisadas, setRevisadas] = useState(() => leerRevisadas(empId));
    const [abierta, setAbierta] = useState(null);
    const tandas = useMemo(() => novedadesVisibles(ctx), [ctx]);
    const todas = useMemo(() => tandas.flatMap((t) => t.novedades.map((n) => ({ ...n, tanda: t.id }))), [tandas]);
    const app = todas.find((n) => n.especial === 'app-personal');
    const galeria = todas.filter((n) => n.especial !== 'app-personal');

    const clave = (n) => `${n.tanda}:${n.id}`;
    const filtrar = (n) => (tema === 'todos' || n.tema === tema)
        && (!busqueda.trim() || tokenMatch(busqueda, n.titulo, n.resumen, n.donde, ...(n.pasos || [])));
    const visibles = galeria.filter(filtrar);

    const total = galeria.length;
    const hechas = galeria.filter((n) => revisadas.has(clave(n))).length;
    const pct = total ? Math.round((hechas / total) * 100) : 0;

    // Abrir una novedad la da por revisada (también al pasar con anterior/siguiente).
    const ver = (n) => {
        setAbierta(n.id);
        if (revisadas.has(clave(n))) return;
        const sig = new Set(revisadas);
        sig.add(clave(n));
        setRevisadas(sig);
        guardarRevisadas(empId, sig);
    };

    // El aviso «ya puedes descargarla» trae aquí con `?app=android`.
    const { search } = useLocation();
    const llegaPorLaApp = new URLSearchParams(search).get('app') === 'android';

    const temasConCuenta = TEMAS
        .filter((t) => t.value !== 'app')
        .map((t) => ({ ...t, n: t.value === 'todos' ? total : galeria.filter((x) => x.tema === t.value).length }))
        .filter((t) => t.n > 0)
        .map((t) => ({ value: t.value, label: `${t.label} ${t.n}` }));

    const indice = abierta ? visibles.findIndex((n) => n.id === abierta) : -1;
    const actual = indice >= 0 ? visibles[indice] : null;
    const tanda = tandas[0];

    return (
        <div className="p-4 md:p-6 flex flex-col gap-6">
            {/* Portada */}
            <section className="relative overflow-hidden rounded-card bg-gradient-to-br from-brand to-brand-purple text-white p-6 md:p-8">
                <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 w-72 h-72 rounded-full bg-brand-purple/40" />
                <div aria-hidden className="pointer-events-none absolute right-24 -bottom-24 w-56 h-56 rounded-full bg-brand/30" />
                <div className="relative flex flex-wrap items-end justify-between gap-6">
                    <div className="min-w-0 max-w-2xl flex flex-col gap-2">
                        <Badge onDark icon={Sparkles} className="w-fit">{tanda ? `Del ${dia(tanda.desde)} al ${dia(tanda.hasta)}` : 'Novedades'}</Badge>
                        <h2 className="text-display-lg font-black leading-none tracking-tight">Lo nuevo en el portal</h2>
                        <p className="text-body-lg text-white/85">
                            {ctx.simulado
                                ? <>Así lo ve <b className="text-white">{cargo || 'ese cargo'}</b>: {total} novedades, cada una con sus pasos.</>
                                : <>{cargo ? <>Para ti, como <b className="text-white">{cargo}</b>: </> : ''}{total} novedades que ya puedes usar. Toca una para ver cómo se hace.</>}
                        </p>
                        {verComo && <div className="mt-2">{verComo}</div>}
                    </div>
                    <Progreso pct={pct} hechas={hechas} total={total} />
                </div>
            </section>

            {cargando && <Notice variant="info" compact>Cargando los permisos de ese cargo…</Notice>}

            {app && !busqueda.trim() && <AppPersonal user={user} destacar={llegaPorLaApp} />}

            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <TituloDeSeccion nivel="modal">Qué cambió</TituloDeSeccion>
                    {temasConCuenta.length > 2 && (
                        <SegmentedControl options={temasConCuenta} value={tema} onChange={setTema} size="sm" />
                    )}
                </div>

                {visibles.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5">
                        {visibles.map((n) => (
                            <TarjetaNovedad key={n.id} n={n} revisada={revisadas.has(clave(n))} onAbrir={() => ver(n)} />
                        ))}
                    </div>
                ) : !cargando && (
                    <EmptyState icon={Sparkles} title="Sin novedades con ese filtro" subtitle="Prueba con Todo o borra la búsqueda." />
                )}
            </div>

            {actual && (
                <DetalleNovedad n={actual}
                    posicion={`${indice + 1} de ${visibles.length}`}
                    onCerrar={() => setAbierta(null)}
                    onAnterior={indice > 0 ? () => ver(visibles[indice - 1]) : null}
                    onSiguiente={indice < visibles.length - 1 ? () => ver(visibles[indice + 1]) : null} />
            )}
        </div>
    );
}

function Progreso({ pct, hechas, total }) {
    const r = 34;
    const c = 2 * Math.PI * r;
    return (
        <div className="flex items-center gap-4" aria-live="polite">
            <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90 shrink-0" aria-hidden>
                <circle cx="42" cy="42" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="8" />
                <circle cx="42" cy="42" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
                    className="transition-[stroke-dashoffset] duration-[var(--dur-lento)]" />
            </svg>
            <div className="flex flex-col">
                <span className="text-title font-black tabular-nums leading-none">{pct}%</span>
                <span className="text-body-sm text-white/80 mt-1"><span className="tabular-nums">{hechas}</span> de <span className="tabular-nums">{total}</span> revisadas</span>
            </div>
        </div>
    );
}

function TarjetaNovedad({ n, revisada, onAbrir }) {
    const Icono = ICONOS[n.icono] || Sparkles;
    return (
        <article data-surface="card" data-interactive data-testid={`novedad-${n.id}`}
            className="group overflow-hidden flex flex-col cursor-pointer active:scale-[0.99]"
            {...clickable(onAbrir, { label: `Ver cómo: ${n.titulo}` })}>
            <div className="relative aspect-video overflow-hidden bg-surface-card-hover">
                {n.media
                    ? <img src={n.media.portada || n.media.src} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-[var(--dur-slow)] group-hover:scale-[1.03]" />
                    : <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-brand to-brand-purple text-white"><Icono size={48} /></div>}
                <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-card to-transparent" />
                <div className="absolute top-3 left-3 flex gap-1.5">
                    {n.nuevo && <Badge tone="solid" variant="success">Nuevo</Badge>}
                    {revisada && <Badge tone="solid" variant="info" icon={Check}>Revisada</Badge>}
                </div>
                {n.media?.tipo === 'animacion' && (
                    <Badge tone="solid" variant="neutral" icon={Play} className="absolute top-3 right-3">Animación</Badge>
                )}
            </div>
            <div className="p-5 pt-3 flex flex-col gap-2 flex-1">
                <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-brand/12 text-brand-text grid place-items-center shrink-0"><Icono size={18} /></span>
                    <TituloDeSeccion nivel="tarjeta" as="h4">{n.titulo}</TituloDeSeccion>
                </div>
                <p className="text-body-sm text-content-2 line-clamp-3">{n.resumen}</p>
                <div className="mt-auto pt-3 flex items-center justify-between gap-3 text-caption">
                    <span className="inline-flex items-center gap-1 text-content-3 min-w-0"><MapPin size={12} className="shrink-0" /><span className="truncate">{n.donde}</span></span>
                    <span className="inline-flex items-center gap-1 font-bold text-brand-text shrink-0">Ver cómo <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
                </div>
            </div>
        </article>
    );
}

function DetalleNovedad({ n, posicion, onCerrar, onAnterior, onSiguiente }) {
    const navigate = useNavigate();
    const Icono = ICONOS[n.icono] || Sparkles;
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-6xl" ariaLabel={n.titulo}>
            <LiquidModal.Header titulo={n.titulo} subtitulo={n.donde} icono={Icono} onClose={onCerrar} />
            <LiquidModal.Body>
                <div className={`grid grid-cols-1 gap-6 items-start ${n.media ? 'lg:grid-cols-5' : ''}`}>
                    {n.media && (
                        <figure className="flex flex-col gap-2 lg:col-span-3 lg:sticky lg:top-0">
                            <div className="rounded-card overflow-hidden border border-border-subtle bg-surface-card-hover grid place-items-center">
                                <img src={n.media.src} alt={`Cómo se hace: ${n.titulo}`} className="block max-w-full h-auto cursor-zoom-in" {...clickable(() => abrir(n.media.src), { label: 'Ver en tamaño completo' })} />
                            </div>
                            <figcaption className="text-caption text-content-3 text-center">{n.media.tipo === 'animacion' ? 'La animación se repite sola. ' : ''}Tócala para verla en tamaño completo.</figcaption>
                        </figure>
                    )}
                    <div className={`flex flex-col gap-5 min-w-0 ${n.media ? 'lg:col-span-2' : ''}`}>
                        <p className="text-body-lg text-content">{n.resumen}</p>
                        <div className="rounded-card bg-brand/8 border border-brand/20 p-4">
                            <TituloDeSeccion nivel="seccion" tono="brand" as="h5">Para qué te sirve</TituloDeSeccion>
                            <p className="text-body text-content mt-1.5">{n.para}</p>
                        </div>
                        <div>
                            <TituloDeSeccion nivel="seccion" tono="brand" as="h5">Cómo se hace</TituloDeSeccion>
                            <ol className="mt-3 flex flex-col">
                                {n.pasos.map((p, i) => (
                                    <li key={i} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
                                        {i < n.pasos.length - 1 && <span aria-hidden className="absolute left-4 top-8 bottom-0 w-px bg-border-subtle" />}
                                        <span className="relative w-8 h-8 rounded-full bg-gradient-to-br from-brand to-brand-purple text-white text-body-sm font-black grid place-items-center tabular-nums">{i + 1}</span>
                                        <span className="text-body text-content pt-1">{p}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                        {n.ojo?.length > 0 && (
                            <div>
                                <TituloDeSeccion nivel="seccion" tono="tenue" as="h5">Ten en cuenta</TituloDeSeccion>
                                <ul className="mt-2 flex flex-col gap-2">
                                    {n.ojo.map((o, i) => (
                                        <li key={i} className="flex gap-2.5 text-body-sm text-content-2">
                                            <Check size={16} className="text-success-text shrink-0 mt-0.5" />
                                            <span>{o}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </LiquidModal.Body>
            <PieDeModal izquierda={(
                <div className="flex items-center gap-1">
                    <Button variant="ghost" icon={ChevronLeft} iconOnly aria-label="Anterior" disabled={!onAnterior} onClick={onAnterior} />
                    <span className="text-caption text-content-3 tabular-nums px-1">{posicion}</span>
                    <Button variant="ghost" icon={ChevronRight} iconOnly aria-label="Siguiente" disabled={!onSiguiente} onClick={onSiguiente} />
                </div>
            )}>
                {n.ruta && <Button variant="secondary" icon={ArrowRight} onClick={() => { onCerrar(); navigate(n.ruta); }}>Ir ahí</Button>}
                {onSiguiente
                    ? <Button onClick={onSiguiente}>Siguiente <ArrowRight size={16} aria-hidden /></Button>
                    : <Button icon={Check} onClick={onCerrar}>Listo</Button>}
            </PieDeModal>
        </LiquidModal>
    );
}

// ── La app del personal ─────────────────────────────────────────────────────


// Pasos numerados. Con `hechos`, los primeros se ven terminados (✓) y el
// siguiente queda resaltado: así la persona sabe en cuál va.
function Pasos({ pasos, hechos = null }) {
    return (
        <ol className="flex flex-col gap-2.5">
            {pasos.map((p, i) => {
                const hecho = hechos != null && i < hechos;
                const actual = hechos != null && i === hechos;
                return (
                    <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5 items-start">
                        <span className={`w-6 h-6 rounded-full text-caption font-black grid place-items-center tabular-nums ${hecho
                            ? 'bg-success-solid text-white'
                            : actual ? 'bg-brand text-white' : 'bg-brand/12 text-brand-text'}`}>
                            {hecho ? <Check size={14} strokeWidth={3} /> : i + 1}
                        </span>
                        <span className={`text-body-sm ${hecho ? 'text-content-3 line-through decoration-content-3/40' : actual ? 'text-content font-semibold' : 'text-content'}`}>{p}</span>
                    </li>
                );
            })}
        </ol>
    );
}

function AppPersonal({ user, destacar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [correo, setCorreo] = useState('');
    const [guardado, setGuardado] = useState(undefined);
    const [cambiando, setCambiando] = useState(false);
    const [ocupado, setOcupado] = useState(false);
    const android = esAndroid();
    const iphone = esIphone();
    const [caja, setCaja] = useState(null);

    useEffect(() => {
        let vivo = true;
        fetchMiCorreoAndroid(user?.id)
            .then((d) => { if (vivo) { setGuardado(d); if (d?.email) setCorreo(d.email); } })
            .catch(() => { if (vivo) setGuardado(null); });
        return () => { vivo = false; };
    }, [user?.id]);

    // Llegó desde el aviso: lo trae a la vista.
    useEffect(() => {
        if (destacar && caja) caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [destacar, caja]);

    const valido = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(correo.trim());
    const habilitado = !!guardado?.agregado_at;
    const pedirCorreo = !guardado?.email || cambiando;
    const guardar = async () => {
        setOcupado(true);
        try {
            const r = await registrarCorreoAndroid(correo.trim());
            setGuardado({ email: r.correo, agregado_at: guardado?.email === r.correo ? guardado.agregado_at : null });
            setCambiando(false);
            const ficha = r.fichaDeCliente === 'actualizada' ? ' y en tu ficha de cliente' : '';
            showToast('Correo guardado', `Quedó en tu ficha de empleado${ficha}. Te avisamos cuando ya puedas descargarla.`, 'success');
        } catch (e) {
            showToast('No se pudo guardar', mensajeDeNovedades(e), 'error');
        } finally { setOcupado(false); }
    };

    const ios = (
        <div className="rounded-xl bg-surface-card-hover p-5 flex flex-col gap-4" key="ios">
            <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-content text-surface-card grid place-items-center"><Apple size={18} /></span>
                <TituloDeSeccion nivel="tarjeta" as="h4">iPhone</TituloDeSeccion>
            </div>
            <Pasos pasos={[
                'Toca Descargar en App Store.',
                `Instala ${APP_PERSONAL_NOMBRE}.`,
                'Ábrela y entra con tu usuario y contraseña del portal.',
                'Permite los avisos. Si quieres, activa Face ID para entrar más rápido.',
            ]} />
            <Button icon={Apple} className="mt-auto" onClick={() => abrir(APP_PERSONAL_IOS)}>Descargar en App Store</Button>
        </div>
    );

    const hechosAndroid = habilitado ? 2 : guardado?.email ? 1 : 0;
    const androide = (
        <div className={`rounded-xl p-5 flex flex-col gap-4 ${habilitado ? 'bg-success/10 ring-1 ring-success/30' : 'bg-surface-card-hover'}`} key="android" data-campo="correo-android">
            <div className="flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-success/15 text-success-text grid place-items-center"><Smartphone size={18} /></span>
                    <TituloDeSeccion nivel="tarjeta" as="h4">Android</TituloDeSeccion>
                </div>
                {habilitado
                    ? <Badge tone="solid" variant="success" icon={Check} uppercase={false}>Lista para ti</Badge>
                    : guardado?.email ? <Badge variant="warning" uppercase={false}>Esperando acceso</Badge> : null}
            </div>
            <Pasos hechos={hechosAndroid} pasos={[
                'Escribe el correo de tu cuenta de Google, el que usas en Play Store, y toca Guardar.',
                'Espera el aviso. Te llega aquí y en tu teléfono cuando ya puedas descargarla.',
                `Toca Descargar en Google Play, con esa misma cuenta, e instala ${APP_PERSONAL_NOMBRE}.`,
                'Entra con tu usuario y contraseña del portal y permite los avisos. Si quieres, activa tu huella.',
            ]} />

            {pedirCorreo ? (
                <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
                    <div className="flex-1 min-w-0">
                        <PortalInput label="Correo de Google" name="correo-android" type="email" icon={Mail} value={correo}
                            placeholder="nombre@gmail.com" onChange={(e) => setCorreo(e.target.value)}
                            hasError={!!correo && !valido} errorMessage="Revisa el correo: debe verse como nombre@gmail.com." />
                    </div>
                    <Button variant={habilitado ? 'secondary' : 'primary'} icon={Check} loading={ocupado} className="sm:mt-6"
                        disabled={!valido || correo.trim().toLowerCase() === guardado?.email} onClick={guardar}>
                        Guardar
                    </Button>
                </div>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-card px-3 py-2">
                    <span className="inline-flex items-center gap-2 min-w-0 text-body-sm text-content">
                        <Mail size={14} className="text-content-3 shrink-0" />
                        <span className="truncate font-semibold">{guardado.email}</span>
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setCambiando(true)}>Cambiar</Button>
                </div>
            )}

            {guardado?.email && !habilitado && !cambiando && (
                <Notice variant="info" compact icon={BellRing}>Ya tenemos tu correo. Te avisamos aquí y en tu teléfono cuando puedas descargarla.</Notice>
            )}
            {habilitado && !cambiando && (
                <Notice variant="success" compact icon={PartyPopper}>Ya puedes descargarla. Si Google Play te pide unirte a la prueba, toca Unirme y después Instalar.</Notice>
            )}
            <Button icon={Play} className="mt-auto" disabled={!habilitado} onClick={() => abrir(APP_PERSONAL_ANDROID)}>
                Descargar en Google Play
            </Button>
        </div>
    );

    return (
        <section ref={setCaja} data-surface="card" className={`overflow-hidden scroll-mt-24 ${destacar ? 'ring-2 ring-brand/45' : ''}`}>
            <div className="grid grid-cols-1 lg:grid-cols-4">
                <div className="relative bg-gradient-to-br from-brand to-brand-purple text-white p-6 flex lg:flex-col items-center lg:items-start lg:justify-center gap-5 lg:col-span-1">
                    <img src="/novedades/2026-11/app-personal.jpg" alt={`Ícono de ${APP_PERSONAL_NOMBRE}`}
                        className="w-20 h-20 lg:w-24 lg:h-24 rounded-3xl shadow-modal ring-4 ring-brand/40 shrink-0" />
                    <div className="flex flex-col gap-1.5">
                        <span className="text-caption font-black uppercase tracking-widest text-white/75">App del personal</span>
                        <span className="text-title font-black leading-tight">{APP_PERSONAL_NOMBRE}</span>
                        <span className="text-body-sm text-white/85">Consulta de precios, conteo, traslados y tus avisos en el teléfono.</span>
                    </div>
                </div>
                <div className="p-5 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-4 lg:col-span-3">
                    {android || destacar ? [androide, ios] : iphone ? [ios, androide] : [ios, androide]}
                </div>
            </div>
        </section>
    );
}

// ── Android (administración) ───────────────────────────────────────────────

const COLUMNAS = [
    { key: 'persona', label: 'Persona' },
    { key: 'sucursal', label: 'Sucursal', hideBelow: 'md' },
    { key: 'correo', label: 'Correo' },
    { key: 'estado', label: 'Estado' },
    { key: 'acciones', label: '' },
];

function PasoAdmin({ n, titulo, texto, hecho, children }) {
    return (
        <div data-surface="card" className={`p-5 flex flex-col gap-3 ${hecho ? 'ring-1 ring-success/30' : ''}`}>
            <div className="flex items-center gap-3">
                <span className={`w-8 h-8 rounded-full text-body-sm font-black grid place-items-center tabular-nums ${hecho ? 'bg-success-solid text-white' : 'bg-gradient-to-br from-brand to-brand-purple text-white'}`}>
                    {hecho ? <Check size={16} strokeWidth={3} /> : n}
                </span>
                <TituloDeSeccion nivel="tarjeta" as="h4">{titulo}</TituloDeSeccion>
            </div>
            <p className="text-body-sm text-content-2 flex-1">{texto}</p>
            {children}
        </div>
    );
}

function PruebaAndroid({ busqueda }) {
    const showToast = useToastStore((s) => s.showToast);
    const branches = useStaffStore((s) => s.branches);
    const [filas, setFilas] = useState(null);
    const [ocupado, setOcupado] = useState(null);
    // Los que se copiaron: el paso 3 marca ESOS, no a alguien que dejó su
    // correo después de copiar y que todavía no está en Google Play.
    const [copiados, setCopiados] = useState(null);

    const cargar = useCallback(() => {
        fetchPruebasAndroid()
            .then(setFilas)
            .catch((e) => { setFilas([]); showToast('No se pudo cargar', mensajeDeNovedades(e), 'error'); });
    }, [showToast]);
    useEffect(() => { cargar(); }, [cargar]);

    const sala = (id) => (branches ?? []).find((b) => b.id === id)?.name ?? '—';
    const visibles = (filas ?? []).filter((f) => !busqueda.trim() || tokenMatch(busqueda, f.email, f.empleado?.name));
    const porAgregar = (filas ?? []).filter((f) => !f.agregado_at);
    const pendientesCopiados = copiados ? porAgregar.filter((f) => copiados.has(f.employee_id)) : [];
    const aMarcar = copiados ? pendientesCopiados : porAgregar;

    const copiar = async () => {
        const texto = porAgregar.map((f) => f.email).join(', ');
        try {
            await globalThis.navigator.clipboard.writeText(texto);
            setCopiados(new Set(porAgregar.map((f) => f.employee_id)));
            showToast('Correos copiados', `${porAgregar.length} listos para pegar en Google Play.`, 'success');
        } catch {
            showToast('No se pudo copiar', texto, 'warning');
        }
    };
    const agregar = async (ids, clave) => {
        setOcupado(clave);
        try {
            const n = await marcarAgregadosEnPlay(ids);
            showToast('Listo', n === 1 ? 'Se le avisó que ya puede descargarla.' : `Se les avisó a ${n} que ya pueden descargarla.`, 'success');
            setCopiados(null);
            cargar();
        } catch (e) {
            showToast('No se pudo marcar', mensajeDeNovedades(e), 'error');
        } finally { setOcupado(null); }
    };
    const reenviar = async (f) => {
        setOcupado(f.employee_id);
        try {
            await reenviarAvisoAndroid([f.employee_id]);
            showToast('Aviso enviado', `${shortEmployeeName(f.empleado?.name || '')} lo recibe en la campana y en su teléfono.`, 'success');
        } catch (e) {
            showToast('No se pudo avisar', mensajeDeNovedades(e), 'error');
        } finally { setOcupado(null); }
    };

    return (
        <div className="p-4 md:p-6 flex flex-col gap-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PasoAdmin n={1} titulo="Copia los correos" hecho={!!copiados && copiados.size > 0}
                    texto={porAgregar.length ? `${porAgregar.length} ${porAgregar.length === 1 ? 'persona espera' : 'personas esperan'} acceso.` : 'Nadie espera acceso.'}>
                    <Button variant="secondary" icon={Copy} disabled={!porAgregar.length} onClick={copiar}>
                        Copiar correos ({porAgregar.length})
                    </Button>
                </PasoAdmin>
                <PasoAdmin n={2} titulo="Pégalos en Google Play"
                    texto="En Play Console abre Portal Farmasalud → Pruebas internas → Testers, pega los correos en la lista y guarda.">
                    <Button variant="secondary" icon={ExternalLink} onClick={() => abrir(PLAY_CONSOLE)}>Abrir Google Play Console</Button>
                </PasoAdmin>
                <PasoAdmin n={3} titulo="Avísales"
                    texto="A cada uno le llega un aviso en la campana y en su teléfono con el botón de descarga y los pasos.">
                    <Button icon={BellRing} loading={ocupado === 'todos'} disabled={!aMarcar.length || !!ocupado}
                        onClick={() => agregar(aMarcar.map((f) => f.employee_id), 'todos')}>
                        Agregados, avisarles ({aMarcar.length})
                    </Button>
                </PasoAdmin>
            </div>

            <DataTable columns={COLUMNAS} loading={filas === null} minWidth="720px" movil={{ acciones: true }}
                empty={{ icon: Users, message: 'Sin correos todavía', subtext: 'Aquí sale quien deja su correo en Novedades.' }}>
                {visibles.map((f, i) => (
                    <DataRow key={f.employee_id} index={i}>
                        <DataCell>
                            <PersonaConFoto id={f.employee_id} nombre={f.empleado?.name ? shortEmployeeName(f.empleado.name) : null} px={28} />
                        </DataCell>
                        <DataCell>{sala(f.empleado?.branch_id)}</DataCell>
                        <DataCell><span className="text-body-sm text-content break-all">{f.email}</span></DataCell>
                        <DataCell>
                            {f.agregado_at
                                ? <Badge variant="success" uppercase={false}>Avisado el {dia(f.agregado_at)}</Badge>
                                : <Badge variant="warning" uppercase={false}>Por agregar</Badge>}
                        </DataCell>
                        <DataCell align="right">
                            {f.agregado_at
                                ? <Button variant="ghost" size="sm" icon={BellRing} loading={ocupado === f.employee_id} disabled={!!ocupado} onClick={() => reenviar(f)}>Avisar de nuevo</Button>
                                : <Button variant="ghost" size="sm" icon={Check} loading={ocupado === f.employee_id} disabled={!!ocupado} onClick={() => agregar([f.employee_id], f.employee_id)}>Agregado, avisar</Button>}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
        </div>
    );
}
