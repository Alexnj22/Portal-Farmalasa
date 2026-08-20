import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IdCard, Ban, Clock, Search, ShieldCheck } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import SearchInput from '../components/common/SearchInput';
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

/**
 * Sistema → Carnés del día: emitir uno y ver los que están vivos para matarlos.
 *
 * Pedido del usuario el 2026-08-20, después de probarlo desde el perfil: «dame
 * una vista en sistema donde pueda generarlo, y donde vea los activos para
 * anularlos de ser necesario».
 *
 * ── Por qué hace falta si el perfil ya lo hace ─────────────────────────────
 * Desde el perfil se atiende a UNA persona, y hay que saber a quién buscar.
 * Acá la pregunta es la otra: **cuántos papeles andan sueltos ahora mismo**. Un
 * carné de papel abre el portal y marca en el kiosco igual que el de plástico,
 * y vence solo a medianoche — así que «quién tiene uno vivo» es una lista que
 * alguien tiene que poder mirar entera, no una consulta ficha por ficha.
 *
 * ── Lo que esta pantalla NO puede hacer ───────────────────────────────────
 * Mostrar el código. El secreto existió entre la respuesta del servidor y el
 * papel; en la base sólo queda su huella. Un carné traspapelado no se «vuelve a
 * ver»: se anula y se imprime otro, que es exactamente lo que ofrecen los dos
 * botones de acá.
 */
const CarnesDelDiaView = () => {
    const employees = useStaff(s => s.employees) || VACIO;
    const branches = useStaff(s => s.branches) || VACIO;

    const [vigentes, setVigentes] = useState(VACIO);
    const [cargando, setCargando] = useState(true);
    const [fallo, setFallo] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [filtro, setFiltro] = useState('');
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

    const porId = useMemo(
        () => new Map(employees.map(e => [e.id, e])),
        [employees]);

    const filas = useMemo(() => vigentes.map(c => {
        const emp = porId.get(c.employee_id);
        const quien = porId.get(c.emitido_por);
        return {
            ...c,
            nombre: emp ? shortEmployeeName(emp) : 'Alguien que ya no está en la lista',
            cargo: emp?.role || '',
            foto: emp?.photo || null,
            sala: branches.find(b => String(b.id) === String(c.branch_id))?.name || '',
            loEntrego: quien ? shortEmployeeName(quien) : '—',
        };
    }), [vigentes, porId, branches]);

    // Sólo personal activo: a alguien de baja el servidor no le emite carné, así
    // que ofrecerlo sería ofrecer un botón que siempre falla.
    //
    // Desde UNA letra, no dos: escribir «e» y no ver nada se lee como que el
    // buscador no funciona, que es lo que reportó el usuario. El tope de 12 es
    // para que la cuadrícula no se vuelva la nómina entera.
    const candidatos = useMemo(() => {
        if (!busqueda.trim()) return VACIO;
        return employees
            .filter(e => (e.status ?? 'ACTIVO') === 'ACTIVO')
            .filter(e => tokenMatch(busqueda, e.name, e.first_names, e.last_names, e.role, e.username))
            .slice(0, 12);
    }, [busqueda, employees]);

    // La lista de vigentes también se busca: hoy son pocos, pero el día que una
    // sala entera trabaje con papel —que es justo el día en que esta pantalla
    // importa— hay que poder encontrar a UNO sin leerlos todos.
    const filasVisibles = useMemo(() => {
        if (!filtro.trim()) return filas;
        return filas.filter(c => tokenMatch(filtro, c.nombre, c.sala, c.loEntrego));
    }, [filas, filtro]);

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

    return (
        <GlassViewLayout icon={IdCard} title="Carnés del día">
            <div className="p-4 md:p-6 space-y-4">
                <Notice variant="info" icon={ShieldCheck}>
                    Un carné del día es un papel que sale de la ticketera y sirve hasta medianoche
                    de hoy: abre el portal, marca en el kiosco y firma igual que el carné de
                    plástico. Después de esa hora deja de servir solo. El código no se puede volver
                    a ver — si un papel se pierde, se anula y se imprime otro.
                </Notice>

                {/* ── Emitir uno ──────────────────────────────────────────── */}
                <div data-surface="card" className="p-4 md:p-5">
                    <h3 className="text-body-sm font-black uppercase tracking-widest text-content mb-3">
                        Imprimir un carné
                    </h3>
                    <SearchInput
                        value={busqueda}
                        onChange={setBusqueda}
                        placeholder="Escribe el nombre de la persona"
                    />

                    {busqueda.trim() && (
                        <div className="mt-4">
                            {/* «No hay nadie cargado» y «nadie se llama así» son
                                dos cosas distintas y se ven igual si las dos
                                dicen «nadie con ese nombre». La primera manda a
                                revisar cómo escribiste un nombre que está bien.
                                Es la misma lección de `fetchCajasDeImpresion`. */}
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
                            {/* Tarjetas y no renglones (pedido del usuario,
                                2026-08-20). Una fila con la foto de 36px a la
                                izquierda y el botón perdido a la derecha se lee
                                como una tabla: hay que recorrerla con el dedo
                                para saber a quién le estás imprimiendo. La
                                tarjeta pone la cara y el nombre arriba y la
                                acción abajo, del ancho de la tarjeta — se
                                reconoce a la persona antes de apretar. */}
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {candidatos.map(e => (
                                    <div key={e.id} data-surface="card" className="p-4 flex flex-col gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <LiquidAvatar src={e.photo} alt={e.name} fallbackText={e.name}
                                                className="w-12 h-12 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-body-sm font-black text-content truncate">{shortEmployeeName(e)}</p>
                                                <p className="text-caption text-content-3 truncate">{e.role || 'Sin cargo'}</p>
                                                <p className="text-micro text-content-3 truncate">
                                                    {branches.find(b => String(b.id) === String(e.branchId))?.name || 'Sin sucursal'}
                                                </p>
                                            </div>
                                        </div>
                                        <BotonCarneDePapel
                                            className="w-full"
                                            employeeId={e.id}
                                            nombre={shortEmployeeName(e)}
                                            cargo={e.role || ''}
                                            sala={branches.find(b => String(b.id) === String(e.branchId))?.name || ''}
                                            motivo="Desde Sistema"
                                            alImprimir={releer}
                                        >Imprimir carné</BotonCarneDePapel>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Los que andan sueltos ───────────────────────────────── */}
                <div data-surface="card" className="p-4 md:p-5">
                    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                        <h3 className="text-body-sm font-black uppercase tracking-widest text-content">
                            Vigentes ahora {!cargando && !fallo && `(${filas.length})`}
                        </h3>
                        <Button variant="secondary" size="sm" onClick={releer} loading={cargando}>
                            Actualizar
                        </Button>
                    </div>

                    {/* El buscador aparece cuando hay suficientes como para
                        perderse. Con dos tarjetas en pantalla, un campo de
                        búsqueda es un control que estorba. */}
                    {!cargando && !fallo && filas.length > 4 && (
                        <div className="mb-3">
                            <SearchInput value={filtro} onChange={setFiltro}
                                placeholder="Buscar entre los vigentes" />
                        </div>
                    )}

                    {cargando && <SkeletonText lines={3} />}

                    {!cargando && fallo && (
                        <EmptyState compact icon={Ban}
                            title="No se pudo leer la lista"
                            subtitle={fallo} iconClass="text-danger" />
                    )}

                    {!cargando && !fallo && filas.length === 0 && (
                        <EmptyState compact icon={ShieldCheck}
                            title="Nadie tiene un carné de papel vigente"
                            subtitle="Los que se imprimieron antes de hoy ya dejaron de servir." />
                    )}

                    {!cargando && !fallo && filas.length > 0 && filasVisibles.length === 0 && (
                        <EmptyState compact icon={Search}
                            title="Ninguno coincide"
                            subtitle="Prueba con otro nombre o con la sala." />
                    )}

                    {!cargando && !fallo && filasVisibles.length > 0 && (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {filasVisibles.map(c => (
                                <div key={c.id} data-surface="card" className="p-4 flex flex-col gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <LiquidAvatar src={c.foto} alt={c.nombre} fallbackText={c.nombre}
                                            className="w-12 h-12 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-body-sm font-black text-content truncate">{c.nombre}</p>
                                            <p className="text-caption text-content-3 truncate">{c.cargo || 'Sin cargo'}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <p className="text-caption text-content-2 flex items-center gap-1.5">
                                            <Clock size={12} className="shrink-0 text-content-3" />
                                            Vale hasta medianoche
                                        </p>
                                        {c.sala && (
                                            <p className="text-caption text-content-3 truncate">Salió en {c.sala}</p>
                                        )}
                                        <p className="text-caption text-content-3 truncate">Lo entregó {c.loEntrego}</p>
                                    </div>

                                    <Button variant="destructive" className="w-full" icon={Ban}
                                        onClick={() => setAAnular(c)}>Anular</Button>
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
