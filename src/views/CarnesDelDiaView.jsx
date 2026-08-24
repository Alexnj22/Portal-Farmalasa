import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IdCard, Ban, Clock, Search, ShieldCheck, Printer, UserCheck } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Button from '../components/common/Button';
import ConfirmModal from '../components/common/ConfirmModal';
import LiquidAvatar from '../components/common/LiquidAvatar';
import { EmptyState, SkeletonText } from '../components/common/StateViews';
import BotonCarneDePapel from '../components/personal/BotonCarneDePapel';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { fetchCarnesVigentes, anularCarneTemporal } from '../data/carneTemporal';
import { mensajeAmigable } from '../utils/errorMessages';
import { tokenMatch } from '../utils/searchUtils';
import { shortEmployeeName } from '../utils/nameUtils';

const VACIO = [];
const SIN_SUCURSAL = 'Sin sucursal';

/**
 * Sistema → Carnés del día: emitir uno y ver los que están vivos para matarlos.
 *
 * Pedido del usuario el 2026-08-20: «dame una vista en sistema donde pueda
 * generarlo, y donde vea los activos para anularlos de ser necesario».
 *
 * ── Por qué hace falta si el perfil ya lo hace ─────────────────────────────
 * Desde el perfil se atiende a UNA persona, y hay que saber a quién buscar. Acá
 * la pregunta es la otra: **cuántos papeles andan sueltos ahora mismo**. Un
 * carné de papel abre el portal y marca en el kiosco igual que el de plástico, y
 * vence solo a medianoche — así que «quién tiene uno vivo» es una lista que
 * alguien tiene que poder mirar entera.
 *
 * ── UN solo buscador, el del header ────────────────────────────────────────
 * Corregido el 2026-08-20 sobre la primera versión, que tenía el suyo dentro de
 * cada tarjeta: el buscador de una vista vive en su header y es el mismo de
 * todas las demás pantallas (`ViewTabBar`). Y acá además **filtra las dos
 * mitades a la vez**, que resultó ser lo correcto y no una economía: al escribir
 * un nombre se ve de una si esa persona YA tiene un carné vivo antes de
 * imprimirle otro — que es justo lo que hay que mirar antes de apretar.
 *
 * ── Lo que esta pantalla NO puede hacer ───────────────────────────────────
 * Mostrar el código. El secreto existió entre la respuesta del servidor y el
 * papel; en la base sólo queda su huella. Un carné traspapelado no se «vuelve a
 * ver»: se anula y se imprime otro, que es lo que ofrecen los dos botones.
 */
const CarnesDelDiaView = () => {
    const employees = useStaff(s => s.employees) || VACIO;
    const branches = useStaff(s => s.branches) || VACIO;

    const [vigentes, setVigentes] = useState(VACIO);
    const [cargando, setCargando] = useState(true);
    const [fallo, setFallo] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [aAnular, setAAnular] = useState(null);
    const [anulando, setAnulando] = useState(false);

    const releer = useCallback(async () => {
        setCargando(true);
        const { data, error } = await fetchCarnesVigentes();
        // El error VIAJA. Una lista vacía es un estado legítimo —nadie tiene un
        // carné de papel hoy— y pintarla cuando en realidad no se pudo leer
        // diría que no hay nada que anular justo cuando sí lo hay.
        setFallo(error ? mensajeAmigable(error, 'No se pudo leer la lista.') : null);
        setVigentes(error ? VACIO : (data || []));
        setCargando(false);
    }, []);

    useEffect(() => { releer(); }, [releer]);

    const porId = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
    const nombreDeSala = useCallback(
        (id) => branches.find(b => String(b.id) === String(id))?.name || '',
        [branches]);

    const filas = useMemo(() => vigentes.map(c => {
        const emp = porId.get(c.employee_id);
        const quien = porId.get(c.emitido_por);
        return {
            ...c,
            nombre: emp ? shortEmployeeName(emp) : 'Alguien que ya no está en la lista',
            cargo: emp?.role || '',
            foto: emp?.photo || null,
            // La sucursal por la que se decide el orden es la de la PERSONA, no
            // la de la ticketera por donde salió el papel: lo que se busca acá
            // es «quién de tal sala anda con papel», y un carné se puede
            // imprimir desde administración para alguien de otra sala.
            sala: nombreDeSala(emp?.branchId) || SIN_SUCURSAL,
            // Por dónde SALIÓ el papel, que no es la sucursal de la persona.
            // `impreso_en` en null significa «la computadora de quien lo
            // emitió» — se dice así y no se deja el renglón en blanco: una
            // línea que falta se lee como «no se sabe», y acá sí se sabe.
            impresoEn: c.impreso_en
                ? (nombreDeSala(c.impreso_en) || `Sucursal ${c.impreso_en}`)
                : 'La computadora de quien lo emitió',
            loEntrego: quien ? shortEmployeeName(quien) : '—',
        };
    }), [vigentes, porId, nombreDeSala]);

    const filasVisibles = useMemo(() => {
        if (!busqueda.trim()) return filas;
        return filas.filter(c => tokenMatch(busqueda, c.nombre, c.sala, c.loEntrego));
    }, [filas, busqueda]);

    /**
     * Los vigentes agrupados por sucursal, pedido del usuario: «que se ordene
     * por sucursal al haber más de 1».
     *
     * El encabezado de grupo sólo aparece cuando hay MÁS DE UNA sucursal en la
     * lista. Con una sola, un rótulo que dice lo mismo en todas las tarjetas es
     * ruido — y con cero tarjetas no hay nada que agrupar.
     *
     * «Sin sucursal» va al final: es la excepción, no una sala más.
     */
    const grupos = useMemo(() => {
        const mapa = new Map();
        for (const c of filasVisibles) {
            if (!mapa.has(c.sala)) mapa.set(c.sala, []);
            mapa.get(c.sala).push(c);
        }
        return [...mapa.entries()]
            .map(([sala, items]) => ({
                sala,
                items: [...items].sort((a, b) => a.nombre.localeCompare(b.nombre)),
            }))
            .sort((a, b) => {
                if (a.sala === SIN_SUCURSAL) return 1;
                if (b.sala === SIN_SUCURSAL) return -1;
                return a.sala.localeCompare(b.sala);
            });
    }, [filasVisibles]);

    // Sólo personal activo: a alguien de baja el servidor no le emite carné, así
    // que ofrecerlo sería ofrecer un botón que siempre falla.
    const candidatos = useMemo(() => {
        if (!busqueda.trim()) return VACIO;
        return employees
            .filter(e => (e.status ?? 'ACTIVO') === 'ACTIVO')
            .filter(e => tokenMatch(busqueda, e.name, e.first_names, e.last_names, e.role, e.username))
            .slice(0, 12);
    }, [busqueda, employees]);

    const anular = useCallback(async () => {
        if (!aAnular) return;
        setAnulando(true);
        const { showToast } = useToastStore.getState();
        try {
            const r = await anularCarneTemporal(aAnular.id);
            if (r?.ok) {
                useStaff.getState().appendAuditLog?.('CARNE_TEMPORAL_ANULADO', aAnular.employee_id, {
                    carne_id: aAnular.id,
                });
                showToast('Carné anulado', `El papel de ${aAnular.nombre} ya no sirve para nada.`, 'success');
            } else {
                showToast('No se anuló', r?.motivo || 'Intenta de nuevo.', 'error');
            }
        } catch (err) {
            showToast('No se anuló', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setAnulando(false);
            setAAnular(null);
            releer();
        }
    }, [aAnular, releer]);

    const filtersContent = (
        <ViewTabBar
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar a una persona por nombre, cargo o usuario"
        />
    );

    return (
        <GlassViewLayout icon={IdCard} title="Carnés del día" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-4">
                {/* ── Emitir uno ──────────────────────────────────────────── */}
                {/* Las tarjetas van SUELTAS sobre el cuerpo de la vista, sin un
                    panel `data-surface="card"` que las envuelva. DESIGN.md §5.1:
                    «no anides tarjetas». Y no es sólo el anillo doble: el cuerpo
                    de vista YA es una tarjeta, así que envolverlas dejaba tres
                    escalones de vidrio y el de más adentro salía más oscuro que
                    la página — la tarjeta perdía el efecto y se veía como un
                    recuadro plano. Es exactamente lo que reportó el usuario. */}
                {busqueda.trim() && (
                    <div>
                        <h3 className="text-body-sm font-black uppercase tracking-widest text-content mb-3">
                            Imprimir un carné
                        </h3>

                        {/* «No hay nadie cargado» y «nadie se llama así» son dos
                            cosas distintas y se ven igual si las dos dicen «nadie
                            con ese nombre». La primera manda a revisar cómo
                            escribiste un nombre que está bien. */}
                        {candidatos.length === 0 && employees.length === 0 && (
                            <EmptyState compact icon={Ban} iconClass="text-warning"
                                title="Todavía no se cargó el personal"
                                subtitle="Vuelve a entrar a la pantalla en unos segundos. Si sigue igual, no tienes permiso para ver el listado de personal." />
                        )}
                        {candidatos.length === 0 && employees.length > 0 && (
                            <EmptyState compact icon={Search}
                                title="Nadie con ese nombre"
                                subtitle="Revisa cómo está escrito en su ficha." />
                        )}

                        {/* Tarjetas y no renglones: una fila con la foto chica a
                            la izquierda y el botón perdido en el borde derecho se
                            lee como una tabla, y hay que recorrerla con el dedo
                            para saber a quién le estás imprimiendo. */}
                        {candidatos.length > 0 && (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {candidatos.map(e => (
                                    <div key={e.id} data-surface="card" className="p-4 flex flex-col gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {/* `rounded-xl` va EN el avatar: su
                                                contenedor tiene `overflow-hidden`
                                                pero no radio propio, así que sin
                                                esto la foto sale con las esquinas
                                                cuadradas dentro de una tarjeta
                                                redondeada. */}
                                            <LiquidAvatar src={e.photo} alt={e.name} fallbackText={e.name}
                                                className="w-12 h-12 rounded-xl shrink-0 border border-border-card" />
                                            <div className="min-w-0">
                                                <p className="text-body-sm font-black text-content truncate">{shortEmployeeName(e)}</p>
                                                <p className="text-caption text-content-3 truncate">{e.role || 'Sin cargo'}</p>
                                                <p className="text-micro text-content-3 truncate">
                                                    {nombreDeSala(e.branchId) || SIN_SUCURSAL}
                                                </p>
                                            </div>
                                        </div>
                                        <BotonCarneDePapel
                                            className="w-full"
                                            employeeId={e.id}
                                            nombre={shortEmployeeName(e)}
                                            cargo={e.role || ''}
                                            sala={nombreDeSala(e.branchId)}
                                            motivo="Desde Sistema"
                                            alImprimir={releer}
                                        >Imprimir carné</BotonCarneDePapel>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Los que andan sueltos ───────────────────────────────── */}
                <div>
                    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                        <h3 className="text-body-sm font-black uppercase tracking-widest text-content">
                            Vigentes ahora{!cargando && !fallo && (
                                busqueda.trim() && filasVisibles.length !== filas.length
                                    ? ` (${filasVisibles.length} de ${filas.length})`
                                    : ` (${filas.length})`
                            )}
                        </h3>
                        <Button variant="secondary" size="sm" onClick={releer} loading={cargando}>
                            Actualizar
                        </Button>
                    </div>

                    {cargando && <SkeletonText lines={3} />}

                    {!cargando && fallo && (
                        <EmptyState compact icon={Ban} iconClass="text-danger"
                            title="No se pudo leer la lista" subtitle={fallo} />
                    )}

                    {!cargando && !fallo && filas.length === 0 && (
                        <EmptyState compact icon={ShieldCheck}
                            title="Nadie tiene un carné de papel vigente"
                            subtitle="Los que se imprimieron antes de hoy ya dejaron de servir." />
                    )}

                    {!cargando && !fallo && filas.length > 0 && filasVisibles.length === 0 && (
                        <EmptyState compact icon={Search}
                            title="Ninguno coincide"
                            subtitle="Prueba con otro nombre o con la sucursal." />
                    )}

                    {!cargando && !fallo && grupos.length > 0 && (
                        <div className="space-y-5">
                            {grupos.map(g => (
                                <div key={g.sala}>
                                    {grupos.length > 1 && (
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-2">
                                            {g.sala} · {g.items.length}
                                        </p>
                                    )}
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                        {g.items.map(c => (
                                            <div key={c.id} data-surface="card" className="p-4 flex flex-col gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <LiquidAvatar src={c.foto} alt={c.nombre} fallbackText={c.nombre}
                                                        className="w-12 h-12 rounded-xl shrink-0 border border-border-card" />
                                                    <div className="min-w-0">
                                                        <p className="text-body-sm font-black text-content truncate">{c.nombre}</p>
                                                        <p className="text-caption text-content-3 truncate">{c.cargo || 'Sin cargo'}</p>
                                                        <p className="text-micro text-content-3 truncate">{c.sala}</p>
                                                    </div>
                                                </div>

                                                {/* Los tres datos con los que se
                                                    audita un papel suelto: hasta
                                                    cuándo vale, por qué ticketera
                                                    salió y quién lo autorizó. Cada
                                                    uno con su rótulo — sin él,
                                                    dos nombres seguidos no se
                                                    distinguen. */}
                                                <div className="space-y-1.5 pt-1 border-t border-divider">
                                                    <p className="text-caption text-content-2 flex items-center gap-1.5">
                                                        <Clock size={12} className="shrink-0 text-content-3" />
                                                        Vale hasta medianoche
                                                    </p>
                                                    <div className="flex items-start gap-1.5">
                                                        <Printer size={12} className="shrink-0 mt-0.5 text-content-3" />
                                                        <p className="text-caption text-content-3 min-w-0">
                                                            <span className="text-content-2 font-bold">Se imprimió en </span>
                                                            {c.impresoEn}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-start gap-1.5">
                                                        <UserCheck size={12} className="shrink-0 mt-0.5 text-content-3" />
                                                        <p className="text-caption text-content-3 min-w-0">
                                                            <span className="text-content-2 font-bold">Lo autorizó </span>
                                                            {c.loEntrego}
                                                        </p>
                                                    </div>
                                                </div>

                                                <Button variant="destructive" className="w-full" icon={Ban}
                                                    onClick={() => setAAnular(c)}>Anular</Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <ConfirmModal
                isOpen={!!aAnular}
                onClose={() => setAAnular(null)}
                onConfirm={anular}
                title="Anular el carné de papel"
                confirmText="Anular"
                isProcessing={anulando}
                message={`El papel de ${aAnular?.nombre ?? 'esta persona'} deja de servir en el acto: no abre el portal, no marca en el kiosco y no firma nada. Si tiene una sesión abierta con él, se le cierra. Para darle otro hay que imprimirlo de nuevo.`}
            />
        </GlassViewLayout>
    );
};

export default CarnesDelDiaView;
