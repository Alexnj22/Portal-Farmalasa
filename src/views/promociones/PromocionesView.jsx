import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag, Layers, History, Plus, AlertTriangle } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import Notice from '../../components/common/Notice';
import { LoadingState } from '../../components/common/StateViews';
import usePestanaEnUrl from '../../hooks/usePestanaEnUrl';
import { useAuth } from '../../context/AuthContext';
import { fetchPromociones } from '../../data/promociones';
import { textoBuscable } from './promocionesUtils';
import TabActivas from './TabActivas';
import TabSeguimiento from './TabSeguimiento';
import TabHistorico from './TabHistorico';
import PromocionModal from './PromocionModal';

/**
 * Promociones por producto — `docs/PLAN-PROMOCIONES-2026-09-01.md`.
 *
 * Es la Fase 4 del plan de Metas §9a. Las bonificaciones están SUSPENDIDAS: el
 * módulo calcula y muestra todo, pero como «se habría ganado» — no genera nada
 * para pago hasta que se reactiven desde Metas → Bono.
 */
export default function PromocionesView() {
    const { hasPermission, permsLoading } = useAuth();
    const puedeEditar = hasPermission('promociones', 'can_edit');

    const tabs = useMemo(() => ([
        { key: 'activas',     label: 'Activas',     icon: Tag },
        { key: 'seguimiento', label: 'Seguimiento', icon: Layers },
        { key: 'historico',   label: 'Histórico',   icon: History },
    ]), []);

    const [tab, setTab] = usePestanaEnUrl(tabs, 'activas');
    const [busqueda, setBusqueda] = useState('');

    const [promos, setPromos] = useState([]);
    const [cargando, setCargando] = useState(true);
    // El error se guarda entero, no sólo su texto: hace falta el `code` para
    // distinguir «tu cargo no tiene el módulo» de «falló la consulta».
    const [error, setError] = useState(null);
    const [modal, setModal] = useState(false);
    const [recarga, setRecarga] = useState(0);

    const recargar = useCallback(() => setRecarga((n) => n + 1), []);

    useEffect(() => {
        let vivo = true;
        setCargando(true);
        setError(null);
        fetchPromociones()
            .then((filas) => { if (vivo) setPromos(filas); })
            .catch((e) => { if (vivo) setError(e); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [recarga]);

    const filtradas = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        if (!q) return promos;
        return promos.filter((p) => textoBuscable(p).includes(q));
    }, [promos, busqueda]);

    const vivas      = useMemo(() => filtradas.filter((p) => p.estado !== 'finalizada'), [filtradas]);
    const terminadas = useMemo(() => filtradas.filter((p) => p.estado === 'finalizada'), [filtradas]);

    const filtersContent = (
        <ViewTabBar
            tabs={tabs}
            activeTab={tab}
            onTabChange={setTab}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar por nombre, laboratorio o nota…"
        />
    );

    /* `rotuloFijo` porque ésta es LA acción de la pantalla: un botón relleno con
       un «+» mudo no dice qué agrega, y es justo el control que la vista existe
       para que se apriete. */
    const acciones = puedeEditar ? [{
        key: 'nueva', icon: Plus, label: 'Nueva promoción', rotulo: 'Nueva',
        variant: 'primary', rotuloFijo: true, onClick: () => setModal(true),
    }] : [];

    /* Los tres estados van separados a propósito. Un rechazo de permiso NO se
       puede ver como una lista vacía: deja a la persona sin nada que reportar
       más que «me sale vacía», que fue exactamente lo que pasó con el módulo de
       sesiones. El 42501 es «tu cargo no tiene el módulo» y tiene arreglo. */
    const cuerpo = () => {
        if (permsLoading || cargando) {
            return <LoadingState label="Cargando las promociones…" />;
        }
        if (error) {
            return (
                <Notice variant="danger" icon={AlertTriangle}>
                    {error.code === '42501'
                        ? 'Tu cargo todavía no tiene el módulo de Promociones. Hay que otorgarlo en Ajustes → Permisos.'
                        : (error.message || 'No se pudieron cargar las promociones. Vuelve a intentar en un momento.')}
                </Notice>
            );
        }
        if (tab === 'seguimiento') {
            return <TabSeguimiento promos={vivas} busqueda={busqueda} />;
        }
        if (tab === 'historico') {
            return <TabHistorico promos={terminadas} busqueda={busqueda} />;
        }
        return (
            <TabActivas
                promos={vivas}
                busqueda={busqueda}
                puedeEditar={puedeEditar}
                onCambio={recargar}
                onNueva={() => setModal(true)}
            />
        );
    };

    return (
        <GlassViewLayout
            icon={Tag}
            title="Promociones"
            filtersContent={filtersContent}
            transparentBody
        >
            <div className="p-4 md:p-6 space-y-6">
                {acciones.length > 0 && <FilterBar acciones={acciones} />}

                {/* El aviso va una sola vez y arriba de todo: la pantalla no
                    puede prometer un pago que hoy no existe. */}
                <Notice variant="warning" icon={AlertTriangle}>
                    <span className="font-semibold">Bonificaciones suspendidas.</span>{' '}
                    Las promociones se crean y se siguen igual, y el portal muestra lo que
                    <em> se habría ganado</em>. No genera nada para pago hasta que se reactiven.
                </Notice>

                {cuerpo()}
            </div>

            {modal && (
                <PromocionModal
                    open={modal}
                    onClose={() => setModal(false)}
                    onGuardada={() => { setModal(false); recargar(); }}
                />
            )}
        </GlassViewLayout>
    );
}
