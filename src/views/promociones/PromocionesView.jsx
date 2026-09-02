import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag, Layers, History, Plus, AlertTriangle, Scale, FlaskConical } from 'lucide-react';
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
import TabExcedentes from './TabExcedentes';
import PromocionModal from './PromocionModal';
import EditarPromocionModal from './EditarPromocionModal';
import PromocionLaboratorioModal from './PromocionLaboratorioModal';
import MatrizLaboratorioModal from './MatrizLaboratorioModal';

/**
 * Promociones — `docs/PLAN-PROMOCIONES-2026-09-01.md`.
 *
 * Es la Fase 4 del plan de Metas §9a y §9b. Hay DOS tipos y no se parecen:
 *
 *   · **por producto** — el laboratorio paga por cada unidad vendida de ciertos
 *     productos. Vive por lote: empieza cuando llega la mercadería y termina
 *     cuando se acaba o vence la fecha.
 *   · **por laboratorio** — si la sala vende $X de esos laboratorios en el mes,
 *     cada persona de la sala gana el monto de ese nivel. Vive por MES, y el
 *     umbral cambia por sala porque las salas no venden lo mismo.
 *
 * Las bonificaciones están SUSPENDIDAS: el módulo calcula y muestra todo, pero
 * como «se habría ganado» — no genera nada para pago hasta que se reactiven
 * desde Metas → Bono.
 */
export default function PromocionesView() {
    const { hasPermission, permsLoading } = useAuth();
    const puedeEditar  = hasPermission('promociones', 'can_edit');
    const puedeAprobar = hasPermission('promociones', 'can_approve');

    const tabs = useMemo(() => ([
        { key: 'activas',     label: 'Activas',     icon: Tag },
        { key: 'seguimiento', label: 'Seguimiento', icon: Layers },
        { key: 'excedentes',  label: 'Excedentes',  icon: Scale },
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
    const [modalLab, setModalLab] = useState(false);
    const [editando, setEditando] = useState(null);   // {id, tipo} de la que se corrige
    const [matriz, setMatriz] = useState(null);       // id de la de laboratorio que se mira
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

    /* Dos acciones y no una con un paso de «¿de qué tipo?»: quien crea una
       promoción YA sabe cuál de las dos está negociando, y una pregunta que
       siempre tiene respuesta es un clic de más.

       `rotuloFijo` porque son LAS acciones de la pantalla: un botón relleno con
       un «+» mudo no dice qué agrega. */
    const acciones = puedeEditar ? [
        {
            key: 'nueva-producto', icon: Plus, label: 'Nueva promoción por producto',
            rotulo: 'Por producto', variant: 'primary', rotuloFijo: true,
            onClick: () => setModal(true),
        },
        {
            key: 'nueva-laboratorio', icon: FlaskConical,
            label: 'Nueva promoción por laboratorio',
            rotulo: 'Por laboratorio', variant: 'secondary', rotuloFijo: true,
            onClick: () => setModalLab(true),
        },
    ] : [];

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
        if (tab === 'excedentes') {
            return <TabExcedentes puedeAprobar={puedeAprobar} />;
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
                onEditar={setEditando}
                onVerMatriz={setMatriz}
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

            {/* Cada tipo se corrige con su propio modal: el de producto edita
                renglones, lotes y reparto; el de laboratorio, niveles y
                umbrales. No hay nada en común que valga la pena unificar. */}
            {editando?.tipo === 'producto' && (
                <EditarPromocionModal
                    promocionId={editando.id}
                    open
                    onClose={() => setEditando(null)}
                    onCambio={recargar}
                />
            )}

            {editando?.tipo === 'laboratorio' && (
                <PromocionLaboratorioModal
                    promocionId={editando.id}
                    open
                    onClose={() => setEditando(null)}
                    onGuardada={() => { setEditando(null); recargar(); }}
                />
            )}

            {matriz && (
                <MatrizLaboratorioModal
                    promocionId={matriz}
                    open
                    onClose={() => setMatriz(null)}
                />
            )}

            {modal && (
                <PromocionModal
                    open={modal}
                    onClose={() => setModal(false)}
                    onGuardada={() => { setModal(false); recargar(); }}
                />
            )}

            {modalLab && (
                <PromocionLaboratorioModal
                    open
                    onClose={() => setModalLab(false)}
                    onGuardada={() => { setModalLab(false); recargar(); }}
                />
            )}
        </GlassViewLayout>
    );
}
