import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag, Layers, History, Plus, AlertTriangle, Scale, FlaskConical, Wallet, Percent } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import Notice from '../../components/common/Notice';
import { LoadingState } from '../../components/common/StateViews';
import usePestanaEnUrl from '../../hooks/usePestanaEnUrl';
import { useAuth } from '../../context/AuthContext';
import { fetchPromociones } from '../../data/promociones';
import { fetchDescuentos } from '../../data/descuentos';
import { useStaffStore } from '../../store/staffStore';
import { SALAS_VENTA } from '../metas/metasUtils';
import { mensajeAmigable } from '../../utils/errorMessages';
import { estadoVisible, esLaboratorio, textoBuscable } from './promocionesUtils';
import TabActivas from './TabActivas';
import TabSeguimiento from './TabSeguimiento';
import TabHistorico from './TabHistorico';
import TabExcedentes from './TabExcedentes';
import TabLiquidacion from './TabLiquidacion';
import TabDescuentos from './TabDescuentos';
import DescuentoModal from './DescuentoModal';
import PromocionModal from './PromocionModal';
import DuplicarPromocionModal from './DuplicarPromocionModal';
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
 *
 * ── Y hay un TERCER tipo, que no se parece a los otros dos (2026-09-04) ───
 * · **Descuentos** — lo que la venta le REBAJA al renglón: un porcentaje, o un
 *   monto por cada unidad. No paga nada a nadie; le baja el precio al cliente.
 *   Vive en el sistema de la caja —es él quien lo aplica al facturar— y el
 *   portal lo configura para no tener que entrar allá sala por sala.
 *
 * Comparten pestañera porque para quien negocia con un laboratorio son la
 * misma conversación, pero NO comparten nada más: los otros dos salen de la
 * base del portal y éste de una edge function contra el sistema de la caja.
 * Por eso se carga sólo cuando se abre su pestaña — cada visita son varias
 * peticiones a un sistema ajeno.
 */
/* Los estados que la pantalla PINTA, en el orden en que se buscan. Salen de
   `estadoVisible`, que es quien los decide: escribirlos aparte los dejaría
   desincronizados de las tarjetas el día que se agregue uno. */
const ESTADOS = [
    { value: '',           label: 'Cualquiera' },
    { value: 'activa',     label: 'Activa' },
    { value: 'por_vencer', label: 'Por vencer' },
    { value: 'vencida',    label: 'Vencida' },
    { value: 'borrador',   label: 'Borrador' },
    { value: 'finalizada', label: 'Terminada' },
];

export default function PromocionesView() {
    const { hasPermission, permsLoading } = useAuth();
    const puedeEditar  = hasPermission('promociones', 'can_edit');
    const puedeAprobar = hasPermission('promociones', 'can_approve');

    const tabs = useMemo(() => ([
        { key: 'activas',     label: 'Activas',     icon: Tag },
        { key: 'seguimiento', label: 'Seguimiento', icon: Layers },
        { key: 'descuentos',  label: 'Descuentos',  icon: Percent },
        { key: 'excedentes',  label: 'Excedentes',  icon: Scale },
        { key: 'liquidacion', label: 'Liquidación', icon: Wallet },
        { key: 'historico',   label: 'Histórico',   icon: History },
    ]), []);

    const [tab, setTab] = usePestanaEnUrl(tabs, 'activas');
    const [busqueda, setBusqueda] = useState('');

    /* Los filtros de la vista. Van en la píldora del cuerpo porque ahí es donde
       se mira qué está recortado (§17), y no existían: `get_promociones` acepta
       `p_estado` y `p_tipo` desde que nació y la pantalla nunca los usó, así que
       la píldora quedaba con dos botones y ningún filtro — una isla. */
    const [fTipo, setFTipo] = useState('');       // '' | 'producto' | 'laboratorio'
    const [fEstado, setFEstado] = useState('');   // '' | activa | borrador | finalizada
    const [fLab, setFLab] = useState('');         // nombre de laboratorio

    const [promos, setPromos] = useState([]);
    const [cargando, setCargando] = useState(true);
    // El error se guarda entero, no sólo su texto: hace falta el `code` para
    // distinguir «tu cargo no tiene el módulo» de «falló la consulta».
    const [error, setError] = useState(null);
    const [modal, setModal] = useState(false);
    const [modalLab, setModalLab] = useState(false);
    const [editando, setEditando] = useState(null);   // {id, tipo} de la que se corrige
    const [matriz, setMatriz] = useState(null);       // id de la de laboratorio que se mira
    const [duplicando, setDuplicando] = useState(null);  // la promoción que se copia
    const [recarga, setRecarga] = useState(0);

    // ── Los descuentos, aparte: viven en el sistema de la caja ─────────────
    const [descuentos, setDescuentos] = useState([]);
    const [alcanceTodo, setAlcanceTodo] = useState(false);
    const [cargandoDesc, setCargandoDesc] = useState(false);
    const [errorDesc, setErrorDesc] = useState(null);
    /* `null` = cerrado · `>0` = el descuento que se CORRIGE. No hay «nuevo»:
       los descuentos nacen con su promoción. */
    const [modalDesc, setModalDesc] = useState(null);

    const branches = useStaffStore((s) => s.branches);
    const salasDeVenta = useMemo(
        () => SALAS_VENTA
            .map((id) => (branches || []).find((b) => Number(b.id) === id))
            .filter(Boolean),
        [branches],
    );

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

    /* Sólo al abrir su pestaña: cada carga son varias peticiones al sistema de
       la caja, y quien entra a mirar el avance de una promoción de laboratorio
       no tiene por qué pagarlas. */
    const [recargaDesc, setRecargaDesc] = useState(0);
    const recargarDesc = useCallback(() => setRecargaDesc((n) => n + 1), []);

    useEffect(() => {
        if (tab !== 'descuentos') return undefined;
        let vivo = true;
        // Los descuentos viven en un sistema ajeno: no hay forma de tenerlos
        // antes de pedirlos, así que el cargador se enciende acá.
        setCargandoDesc(true); // eslint-disable-line react-hooks/set-state-in-effect
        setErrorDesc(null);
        fetchDescuentos()
            .then(({ descuentos: filas, alcanceTodo: todo }) => {
                if (!vivo) return;
                setDescuentos(filas);
                setAlcanceTodo(todo);
            })
            .catch((e) => { if (vivo) setErrorDesc(e); })
            .finally(() => { if (vivo) setCargandoDesc(false); });
        return () => { vivo = false; };
    }, [tab, recargaDesc]);

    /* Los laboratorios que de verdad aparecen, sacados de las promociones —no de
       una lista escrita a mano ni del catálogo entero—: ofrecer un laboratorio
       que no tiene ninguna promoción es ofrecer un filtro que sólo puede dar
       vacío. */
    const labsDisponibles = useMemo(() => {
        const vistos = new Set();
        for (const p of promos) for (const l of (p.laboratorios || [])) vistos.add(l);
        return [...vistos].sort((a, b) => a.localeCompare(b, 'es'));
    }, [promos]);

    const filtradas = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return promos.filter((p) => {
            if (q && !textoBuscable(p).includes(q)) return false;
            if (fTipo && (esLaboratorio(p) ? 'laboratorio' : 'producto') !== fTipo) return false;
            /* Por el estado VISIBLE y no por `p.estado`: la pantalla pinta
               «Vencida» y «Por vencer», que no son estados guardados sino una
               lectura de la fecha. Filtrar por el de la base ofrecería opciones
               que no coinciden con lo que se ve en las tarjetas. */
            if (fEstado && estadoVisible(p).clave !== fEstado) return false;
            if (fLab && !(p.laboratorios || []).includes(fLab)) return false;
            return true;
        });
    }, [promos, busqueda, fTipo, fEstado, fLab]);

    const filtrosPuestos = [fTipo, fEstado, fLab].filter(Boolean).length;
    const limpiarFiltros = useCallback(() => { setFTipo(''); setFEstado(''); setFLab(''); }, []);

    /* Busca por nombre del descuento y también por el de sus productos: quien
       pregunta «¿este producto tiene descuento?» escribe el producto. */
    const descuentosFiltrados = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        if (!q) return descuentos;
        return descuentos.filter((d) => (
            `${d.descripcion} ${(d.productos || []).map((p) => p.nombre).join(' ')}`
                .toLowerCase().includes(q)
        ));
    }, [descuentos, busqueda]);

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
       siempre tiene respuesta es un clic de más. */
    /* En Descuentos NO hay acción de crear: un descuento nace al crear su
       promoción, marcando «Además baja el precio en la venta». Tener las dos
       puertas era el defecto —obligaba a cargar los mismos productos y las
       mismas fechas dos veces, que es cómo dos listas que deberían decir lo
       mismo terminan diciendo cosas distintas. */
    const acciones = !puedeEditar || tab === 'descuentos' ? [] : [
            /* SIN `rotuloFijo`: es «opt-in y rara» según el propio canónico
               —hace que el texto no ceda nunca y la píldora se mida siempre
               con él—, y puesta en las DOS dejaba la barra con dos botones
               larguísimos que no se compactaban ni cediendo ancho. Sin ella,
               la medida de la fila decide, y el rótulo sigue en el tooltip.
               Y el rótulo dice «Nueva por…», no «Nueva promoción por…»: en
               una vista llamada Promociones, la palabra ya la dijo el título. */
            {
                key: 'nueva-producto', icon: Plus, label: 'Nueva por producto',
                rotulo: 'Por producto', variant: 'primary',
                onClick: () => setModal(true),
            },
            {
                key: 'nueva-laboratorio', icon: FlaskConical,
                label: 'Nueva por laboratorio',
                rotulo: 'Por laboratorio', variant: 'secondary',
                onClick: () => setModalLab(true),
            },
        ];

    /* Sólo donde los filtros recortan lo que se ve. Seguimiento e Histórico sí
       listan promociones; Descuentos sale del sistema de ventas y Excedentes y
       Liquidación miran otra cosa.

       ⚠️ Va DESPUÉS de `acciones` y no antes: leerlo arriba de su `const` no da
       `undefined`, LANZA en cada render y se lleva la vista entera al
       ErrorBoundary. Lo cazó `npm run gate:tdz` — el aviso del navegador traía
       el nombre minificado y una pila apuntando a react-dom. */
    const muestraFiltros = ['activas', 'seguimiento', 'historico'].includes(tab)
        && (acciones.length > 0 || promos.length > 0);

    /* Los tres estados van separados a propósito. Un rechazo de permiso NO se
       puede ver como una lista vacía: deja a la persona sin nada que reportar
       más que «me sale vacía», que fue exactamente lo que pasó con el módulo de
       sesiones. El 42501 es «tu cargo no tiene el módulo» y tiene arreglo. */
    const cuerpo = () => {
        /* Los descuentos se resuelven ANTES del cargador y del error de las
           promociones: son otra fuente, y colgar su pestaña de la carga de la
           base mostraría «Cargando las promociones…» sobre algo que no las
           necesita — o peor, el error de una consulta que no se hizo. */
        if (tab === 'descuentos') {
            if (permsLoading || cargandoDesc) {
                return <LoadingState label="Consultando los descuentos…" />;
            }
            if (errorDesc) {
                /* Por `mensajeAmigable` y NO por `.message` crudo. Medido en el
                   barrido del teléfono: la pantalla llegó a decir «Failed to
                   send a request to the Edge Function» —en inglés y nombrando
                   la tubería, que es lo que la regla de copy prohíbe—. El
                   canónico ya traduce ese caso; lo que faltaba era usarlo. */
                return (
                    <Notice variant="danger" icon={AlertTriangle}>
                        {mensajeAmigable(errorDesc,
                            'No se pudieron consultar los descuentos. Vuelve a intentar en un momento.')}
                    </Notice>
                );
            }
            return (
                <TabDescuentos
                    descuentos={descuentosFiltrados}
                    busqueda={busqueda}
                    puedeEditar={puedeEditar}
                    alcanceTodo={alcanceTodo}
                    salas={salasDeVenta}
                    onEditar={(id) => setModalDesc(id)}
                    onCambio={recargarDesc}
                />
            );
        }

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
        if (tab === 'liquidacion') {
            return <TabLiquidacion puedeEditar={puedeEditar} puedeAprobar={puedeAprobar} />;
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
                onDuplicar={setDuplicando}
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
                {/* La píldora del cuerpo: TODO el filtro de la vista y todas sus
                    acciones (§17). Antes llevaba sólo los dos botones y ningún
                    filtro, así que se leía como dos controles flotando en una
                    caja sin motivo — reportado con captura.

                    Los filtros son de las promociones, así que la barra no se
                    dibuja en las pestañas que muestran otra cosa (Descuentos
                    tiene su propia fuente; Excedentes y Liquidación no listan
                    promociones): una píldora que ofrece recortes que no
                    afectan a lo que se está mirando es peor que ninguna. */}
                {/* La píldora va a la DERECHA de su fila, como en Bitácoras y
                    en el resto del portal: el `flex-1` de la izquierda es lo
                    que la empuja. Sin él quedaba pegada al borde izquierdo,
                    que es la forma que ninguna otra vista tiene. */}
                {muestraFiltros && (
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                        <div className="flex-1" />
                        <div className="flex justify-end min-w-0">
                            <FilterBar
                                acciones={acciones}
                                activeCount={filtrosPuestos}
                                onClear={filtrosPuestos > 0 ? limpiarFiltros : undefined}
                            >
                                {/* `FilterBar.Opciones` y no un `SegmentedControl`
                                    a mano: el canónico decide el control por el
                                    NÚMERO de opciones —hasta 3 segmentado, de 4
                                    en adelante desplegable— y esa decisión no se
                                    toma vista por vista, o se toma distinto en
                                    cada una. */}
                                <FilterBar.Section label="tipo" active={!!fTipo}
                                    onClear={() => setFTipo('')}>
                                    <FilterBar.Opciones
                                        value={fTipo}
                                        onChange={setFTipo}
                                        label="Tipo"
                                        options={[
                                            { value: '', label: 'Todas' },
                                            { value: 'producto', label: 'Producto' },
                                            { value: 'laboratorio', label: 'Laboratorio' },
                                        ]}
                                    />
                                </FilterBar.Section>

                                <FilterBar.Section label="estado" active={!!fEstado}
                                    onClear={() => setFEstado('')}>
                                    <FilterBar.Opciones
                                        value={fEstado}
                                        onChange={(v) => setFEstado(v || '')}
                                        label="Estado"
                                        options={ESTADOS}
                                        placeholder="Cualquiera"
                                    />
                                </FilterBar.Section>

                                {labsDisponibles.length > 1 && (
                                    <FilterBar.Section label="laboratorio" active={!!fLab}
                                        onClear={() => setFLab('')}>
                                        <FilterBar.Opciones
                                            value={fLab}
                                            onChange={(v) => setFLab(v || '')}
                                            label="Laboratorio"
                                            options={labsDisponibles.map((l) => ({ value: l, label: l }))}
                                            placeholder="Todos"
                                        />
                                    </FilterBar.Section>
                                )}
                            </FilterBar>
                        </div>
                    </div>
                )}

                {/* El aviso va una sola vez y arriba de todo: la pantalla no
                    puede prometer un pago que hoy no existe.

                    Fuera de Descuentos: ahí no hay bonificación de la que hablar
                    —un descuento le baja el precio al cliente y no le paga a
                    nadie—, y el aviso se leería como que el descuento tampoco
                    aplica. */}
                {tab !== 'descuentos' && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <span className="font-semibold">Bonificaciones suspendidas.</span>{' '}
                        Las promociones se crean y se siguen igual, y el portal muestra lo que
                        <em> se habría ganado</em>. No genera nada para pago hasta que se reactiven.
                    </Notice>
                )}

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

            {duplicando && (
                <DuplicarPromocionModal
                    promo={duplicando}
                    open
                    onClose={() => setDuplicando(null)}
                    onDuplicada={() => { setDuplicando(null); recargar(); }}
                />
            )}

            {modalDesc !== null && (
                <DescuentoModal
                    open
                    descuentoId={modalDesc}
                    alcanceTodo={alcanceTodo}
                    onClose={() => setModalDesc(null)}
                    onGuardado={() => { setModalDesc(null); recargarDesc(); }}
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
