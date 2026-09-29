import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
    ClipboardList, FileCheck2, Store, PackageSearch, Boxes, Tag, Building2, Plus, LogOut, Menu, X, ArrowLeftRight, PackageX } from 'lucide-react';
import { useAuth } from '@nucleo/context/AuthContext';
import { useMarca } from '../../plataforma/useMarca';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { contarDescuentosPendientes } from '@nucleo/data/distribucion';
import { MARCA_DISTRIBUIDORA } from './marca';
import { rutaSeccion, rutaVenta, rutaLogin } from './rutas';
import Badge from '../../components/common/Badge';

// La casa de la distribuidora: su menú, su marca y nada del portal de las
// farmacias (decisión del usuario, 2026-09-28: «parecen independientes, así
// que debe haber una URL aparte»). Misma base y mismas cuentas; lo que se ve lo
// deciden los permisos.
//
// Copia la ANATOMÍA de `AppLayout` y no sus piezas: en escritorio el marco es
// fijo y cada vista scrollea sola (así `GlassViewLayout` se comporta igual que
// en el portal); en el teléfono scrollea el documento y la barra de arriba
// queda pegada. `AppLayout` tiene 1,700 líneas de menú de farmacias que acá no
// hacen falta.

const CampanaLazy = React.lazy(() => import('../../components/common/NotificationBell'));

const MENU = [
    { seccion: 'pedidos',     label: 'Pedidos',     icon: ClipboardList },
    { seccion: 'documentos',  label: 'Documentos',  icon: FileCheck2 },
    { seccion: 'clientes',    label: 'Clientes',    icon: Store },
    { seccion: 'catalogo',    label: 'Catálogo',    icon: PackageSearch },
    { seccion: 'inventario',  label: 'Inventario',  icon: Boxes },
    { seccion: 'perdidas',    label: 'Ventas perdidas', icon: PackageX },
    { seccion: 'solicitudes', label: 'Solicitudes', icon: Tag, contador: true },
    { seccion: 'emisor',      label: 'Empresa',     icon: Building2, soloConfig: true },
];

/** Cuántos descuentos esperan decisión (para el número del menú). */
function usePendientes(activo) {
    const [n, setN] = useState(0);
    const location = useLocation();
    useEffect(() => {
        if (!activo) return undefined;
        let vivo = true;
        contarDescuentosPendientes()
            .then(c => { if (vivo) setN(c); })
            .catch(e => console.error('Torogoz: pendientes', e.message));
        return () => { vivo = false; };
    }, [activo, location.pathname]); // se relee al navegar: barato, y el número no se queda viejo
    return n;
}

function Marca({ compacta = false }) {
    return (
        <div className="flex items-center gap-2.5 min-w-0">
            <img src={MARCA_DISTRIBUIDORA.icono} alt={MARCA_DISTRIBUIDORA.nombre}
                className={compacta ? 'w-9 h-9 rounded-xl shrink-0' : 'w-11 h-11 rounded-2xl shrink-0'} />
            <div className="min-w-0">
                <p className="text-body font-black text-content leading-tight truncate">{MARCA_DISTRIBUIDORA.nombre}</p>
                <p className="text-micro font-black text-brand-text uppercase tracking-wider truncate">{MARCA_DISTRIBUIDORA.bajada}</p>
            </div>
        </div>
    );
}

export default function TorogozLayout({ children, handleLogout }) {
    useMarca('distribucion');
    const { user, hasPermission } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [abierto, setAbierto] = useState(false);
    const puedeVender = hasPermission('distribucion', 'can_edit');
    const puedeConfigurar = hasPermission('distribucion_config', 'can_edit');
    const pendientes = usePendientes(true);
    const nombre = shortEmployeeName(user?.name) || user?.username || '';

    // El menú del teléfono se cierra al navegar.
    useEffect(() => { setAbierto(false); }, [location.pathname]);

    const salir = async () => {
        await handleLogout?.();
        navigate(rutaLogin(), { replace: true });
    };

    const items = MENU.filter(i => !i.soloConfig || puedeConfigurar);

    const navegacion = (
        <nav className="flex flex-col gap-1" aria-label="Menú de la distribuidora">
            {puedeVender && (
                <NavLink to={rutaVenta()} end
                    className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-brand text-white font-black text-body-sm min-h-[max(44px,var(--tap-min))] px-4 shadow-sm hover:opacity-95 active:scale-[0.98] transition-transform">
                    <Plus size={18} /> Nueva venta
                </NavLink>
            )}
            {items.map(i => (
                <NavLink key={i.seccion} to={rutaSeccion(i.seccion)}
                    className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 min-h-[max(40px,var(--tap-min))] text-body-sm font-bold transition-colors active:scale-[0.98] ${isActive
                        ? 'bg-brand/12 text-brand-text'
                        : 'text-content-2 hover:bg-surface-card-hover'}`}>
                    <i.icon size={18} className="shrink-0" />
                    <span className="flex-1 truncate">{i.label}</span>
                    {i.contador && pendientes > 0 && (
                        <Badge size="sm" variant="warning" uppercase={false}>{pendientes}</Badge>
                    )}
                </NavLink>
            ))}
        </nav>
    );

    const pie = (
        <div className="flex flex-col gap-2 pt-3 border-t border-divider">
            <div className="flex items-center gap-2.5 px-1 min-w-0">
                <span className="w-9 h-9 rounded-full bg-brand/10 text-brand-text font-black text-caption flex items-center justify-center shrink-0">
                    {(nombre || '?').slice(0, 1).toUpperCase()}
                </span>
                <p className="text-body-sm font-bold text-content-2 truncate flex-1">{nombre}</p>
                <button type="button" onClick={salir} aria-label="Cerrar sesión"
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-danger-text hover:bg-danger/10 active:scale-[0.95] transition-transform">
                    <LogOut size={18} />
                </button>
            </div>
            {/* Mismas cuentas: quien también trabaja en las farmacias pasa sin
                volver a entrar. */}
            <NavLink to="/" className="flex items-center gap-2 px-2 min-h-[var(--tap-min)] text-caption text-content-3 hover:text-content-2">
                <ArrowLeftRight size={14} /> Ir al portal de las farmacias
            </NavLink>
        </div>
    );

    return (
        <div className="relative z-base w-full flex-1 flex flex-col lg:flex-row min-h-0">
            {/* Escritorio: menú fijo a la izquierda. */}
            <aside className="hidden lg:flex w-64 shrink-0 flex-col gap-4 p-4 pl-[max(1rem,var(--sa-left))]">
                <div data-surface="card" className="flex-1 min-h-0 flex flex-col gap-4 p-4">
                    {/* La campana va junto a la marca y no flotando sobre el contenido:
                        encima tapaba la primera tarjeta de cada vista (la venta ya no
                        tiene encabezado que le dejara el hueco). */}
                    <div className="flex items-center justify-between gap-2">
                        <Marca />
                        <React.Suspense fallback={<div className="w-11 h-11" />}>
                            <CampanaLazy variant="mobile" />
                        </React.Suspense>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">{navegacion}</div>
                    {pie}
                </div>
            </aside>

            <main className="flex-1 flex flex-col relative z-content lg:overflow-hidden min-w-0">
                {/* Teléfono: barra pegada arriba, con el menú detrás del botón. */}
                <header className="lg:hidden sticky top-0 z-tabs bg-surface-page/95 border-b border-divider pt-[var(--sa-top)] px-[max(0.75rem,var(--sa-left))]">
                    <div className="flex items-center justify-between gap-2 h-14">
                        <button type="button" onClick={() => setAbierto(true)} aria-label="Abrir el menú"
                            className="w-11 h-11 rounded-xl flex items-center justify-center text-content-2 active:scale-[0.95] transition-transform">
                            <Menu size={22} />
                        </button>
                        <Marca compacta />
                        <React.Suspense fallback={<div className="w-11 h-11" />}>
                            <CampanaLazy variant="mobile" />
                        </React.Suspense>
                    </div>
                </header>

                <div id="main-scroll" className="flex-1 lg:min-h-0 lg:overflow-hidden relative lg:pt-2 lg:pb-4 lg:pr-2 pb-[max(0px,calc(1rem+var(--sa-bottom)-var(--alto-barra-flotante,0px)))] pl-[max(0.5rem,var(--sa-left))] pr-[max(0.5rem,var(--sa-right))] lg:pl-0">
                    <div className="lg:h-full w-full animate-route-enter">{children}</div>
                </div>
            </main>

            {/* El menú del teléfono. */}
            {abierto && (
                <div className="lg:hidden fixed inset-0 z-modal">
                    <button type="button" aria-label="Cerrar el menú" onClick={() => setAbierto(false)}
                        className="absolute inset-0 bg-scrim" />
                    <div data-surface="card" className="absolute inset-y-0 left-0 w-[min(20rem,85vw)] flex flex-col gap-4 p-4 pt-[max(1rem,var(--sa-top))] pb-[max(1rem,var(--sa-bottom))] rounded-none">
                        <div className="flex items-center justify-between gap-2">
                            <Marca />
                            <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar el menú"
                                className="w-11 h-11 rounded-xl flex items-center justify-center text-content-2 active:scale-[0.95] transition-transform">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto">{navegacion}</div>
                        {pie}
                    </div>
                </div>
            )}
        </div>
    );
}
