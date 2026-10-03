import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Droplet, Minus, Plus, Save, Search, Syringe } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import PortalInput from '../../components/common/PortalInput';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore } from '@nucleo/store/staffStore';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import {
    clasificarProducto, fetchCatalogoDeDosis, fetchPreciosDeAplicacion, fijarDosis, fijarMililitros, fijarPrecioDeAplicacion,
} from '@nucleo/data/inyecciones';
import { aplicacionesPorDosis, fmtMl } from '@nucleo/utils/inyeccionDosis';
import MililitrosModal from './MililitrosModal';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/*
 * Ajustes de las aplicaciones de inyección.
 *
 *   · Precio (gerencia): lo que vale una aplicación, comprada o traída.
 *   · Por producto (supervisión): cuántas aplicaciones trae cada presentación.
 *     La factura no lo sabe —un TRI PACK sale «CAJA X 3» con factor 1—, así
 *     que rige una sugerencia sacada del nombre hasta que alguien la confirma.
 *   · Por mililitros (2026-10-03): un vial no trae un número fijo —RUBRAVIDA
 *     de 10 ml son 5 a 2 ml y 4 a 2.5—. Se declara el contenido y las dosis,
 *     y al cobrar se elige cuánto se pone.
 */

export default function TabAjustes() {
    const { hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const puedeDosis = hasPermission('inyecciones_dosis');
    const puedePrecio = hasPermission('inyecciones_precios');
    return (
        <div className="p-4 md:p-6 space-y-6">
            {puedePrecio && <Precios showToast={showToast} />}
            {puedeDosis && <CatalogoDeDosis showToast={showToast} />}
        </div>
    );
}

function Precios({ showToast }) {
    const [precios, setPrecios] = useState(null);
    const [borrador, setBorrador] = useState({});
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        fetchPreciosDeAplicacion()
            .then((p) => { setPrecios(p); setBorrador({ COMPRADA: String(p.COMPRADA ?? ''), TRAIDA: String(p.TRAIDA ?? '') }); })
            .catch((e) => showToast('No se pudo leer el precio', mensajeAmigable(e), 'error'));
    }, [showToast]);

    const cambiados = precios ? ['COMPRADA', 'TRAIDA'].filter((o) => Number(borrador[o]) !== precios[o]) : [];
    const guardar = async () => {
        setGuardando(true);
        try {
            for (const origen of cambiados) {
                await fijarPrecioDeAplicacion({ origen, precio: Number(borrador[origen]) });
                useStaffStore.getState().appendAuditLog('INYECCION_PRECIO', origen,
                    { antes: precios[origen], despues: Number(borrador[origen]) });
            }
            const p = await fetchPreciosDeAplicacion();
            setPrecios(p);
            showToast('Precio guardado', 'Rige desde el próximo cobro.', 'success');
        } catch (e) {
            showToast('No se pudo guardar el precio', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div data-surface="card" className="rounded-xl p-4 space-y-3">
            <h4 className="text-caption font-black uppercase tracking-widest text-content-2">Precio por aplicación</h4>
            <div className="grid grid-cols-2 gap-3">
                <PortalInput label="Comprada aquí" inputMode="decimal" maskType="DECIMAL" prefix="$"
                    value={borrador.COMPRADA ?? ''} onChange={(e) => setBorrador((b) => ({ ...b, COMPRADA: e.target.value }))} />
                <PortalInput label="Traída por el cliente" inputMode="decimal" maskType="DECIMAL" prefix="$"
                    value={borrador.TRAIDA ?? ''} onChange={(e) => setBorrador((b) => ({ ...b, TRAIDA: e.target.value }))} />
            </div>
            <div className="flex justify-end">
                <Button variant="primary" size="sm" icon={Save} loading={guardando}
                    disabled={!cambiados.length || cambiados.some((o) => !(Number(borrador[o]) >= 0))} onClick={guardar}>
                    Guardar precio
                </Button>
            </div>
        </div>
    );
}

/* Cómo se vende el producto, para que quien confirma sepa qué es «la unidad
 * suelta»: [1, 5] → «suelta y en caja de 5». Si sólo se vende entero, la
 * unidad es el paquete (un TRI PACK, «X 3 AMPOLLAS»). */
function comoSeVende(factores) {
    const cajas = (factores || []).filter((f) => f > 1);
    if (!cajas.length) return 'Se vende sólo entero';
    return `Se vende suelta y en caja de ${cajas.join(' o ')}`;
}

function CatalogoDeDosis({ showToast }) {
    const [filas, setFilas] = useState(null);
    const [editando, setEditando] = useState({});   // clave → aplicaciones
    const [guardando, setGuardando] = useState(null);
    const [soloSinConfirmar, setSoloSinConfirmar] = useState(true);
    const [agregando, setAgregando] = useState(false);
    const [verQuitados, setVerQuitados] = useState(false);
    const [porMl, setPorMl] = useState(null);       // la fila que se está declarando por ml

    const cargar = useCallback(() => fetchCatalogoDeDosis()
        .then(setFilas)
        .catch((e) => { setFilas([]); showToast('No se pudo cargar el catálogo', mensajeAmigable(e), 'error'); }), [showToast]);
    useEffect(() => { cargar(); }, [cargar]);

    const clave = (f) => String(f.erp_product_id);
    const activas = useMemo(() => (filas || []).filter((f) => f.clasificacion !== 'quitado'), [filas]);
    const quitados = useMemo(() => (filas || []).filter((f) => f.clasificacion === 'quitado'), [filas]);
    // Contar por ml también es una confirmación: alguien dijo cuánto trae.
    const sinDecidir = (f) => f.confirmadas == null && f.contenido_ml == null;
    const visibles = useMemo(
        () => activas.filter((f) => !soloSinConfirmar || sinDecidir(f)),
        [activas, soloSinConfirmar],
    );

    /* Agregar, quitar o volver a lo automático. «Quitar» un producto que se
     * agregó a mano lo devuelve a lo automático (que no lo cuenta); quitar uno
     * que cuenta por su nombre lo marca como «no es inyección». */
    const clasificar = async (erpProductId, esInyeccion, nombre, accion) => {
        setGuardando(String(erpProductId));
        try {
            await clasificarProducto({ erpProductId, esInyeccion });
            useStaffStore.getState().appendAuditLog('INYECCION_CLASIFICAR', String(erpProductId),
                { producto: nombre, accion, es_inyeccion: esInyeccion });
            showToast(accion === 'agregar' ? 'Producto agregado' : accion === 'quitar' ? 'Producto quitado' : 'Producto incluido de nuevo',
                accion === 'quitar' ? 'Ya no se ofrece para cobrar la aplicación.' : 'Ya se ofrece para cobrar la aplicación.', 'success');
            await cargar();
        } catch (e) {
            showToast('No se pudo cambiar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(null);
        }
    };
    const quitar = (f) => clasificar(f.erp_product_id, f.clasificacion === 'incluido' ? null : false, f.descripcion, 'quitar');

    const confirmar = async (f) => {
        const n = editando[clave(f)] ?? f.confirmadas ?? f.sugeridas;
        setGuardando(clave(f));
        try {
            await fijarDosis({ erpProductId: f.erp_product_id, aplicaciones: n });
            useStaffStore.getState().appendAuditLog('INYECCION_DOSIS', String(f.erp_product_id),
                { producto: f.descripcion, aplicaciones_por_unidad: n });
            await cargar();
        } catch (e) {
            showToast('No se pudo confirmar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(null);
        }
    };

    const guardarMl = async (f, valores) => {
        setGuardando(clave(f));
        try {
            await fijarMililitros({ erpProductId: f.erp_product_id, ...valores });
            useStaffStore.getState().appendAuditLog('INYECCION_ML', String(f.erp_product_id),
                { producto: f.descripcion, contenido_ml: valores.contenidoMl, dosis_ml: valores.dosisMl ?? null });
            showToast(valores.contenidoMl == null ? 'Vuelve a contar aplicaciones' : 'Guardado por mililitros',
                valores.contenidoMl == null ? 'Rige el número de aplicaciones por unidad.' : 'Al cobrar se pregunta cuánto se pone.', 'success');
            setPorMl(null);
            await cargar();
        } catch (e) {
            showToast('No se pudo guardar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(null);
        }
    };

    const sinConfirmar = activas.filter(sinDecidir).length;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                    <h4 className="text-title-sm font-black text-content flex items-center gap-2">
                        <ClipboardList className="w-4 h-4" aria-hidden="true" /> Aplicaciones por producto
                    </h4>
                    <p className="text-body-sm text-content-3">
                        Cuántas aplicaciones trae UNA unidad suelta. Una caja multiplica por lo que trae: TRAMAL en
                        caja de 5 con 1 por unidad son 5. Lo que sólo se vende entero —un TRI PACK— es su propia
                        unidad. Un vial que rinde según la dosis se cuenta «por ml». Mientras no se confirma,
                        rige la sugerencia. {filas && `${sinConfirmar} sin confirmar.`}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setSoloSinConfirmar((v) => !v)}
                        className="text-caption underline text-content-3 min-h-[var(--tap-min)]">
                        {soloSinConfirmar ? 'Ver también las confirmadas' : 'Ver sólo las sin confirmar'}
                    </button>
                    <Button variant="secondary" size="sm" icon={Plus} onClick={() => setAgregando((v) => !v)}>
                        Agregar un producto
                    </Button>
                </div>
            </div>
            {agregando && (
                <div data-surface="card" className="rounded-xl p-3 space-y-2">
                    <p className="text-body-sm text-content-2">
                        Para un inyectable que no aparece porque su nombre no lo dice. Queda marcado a mano.
                    </p>
                    <BuscadorDeProducto
                        placeholder="Buscar en el catálogo…"
                        invitacion={{ icono: Search, texto: 'Escribe el nombre del producto que es inyección' }}
                        onElegir={(p) => { setAgregando(false); clasificar(p.id, true, p.nombre, 'agregar'); }} />
                </div>
            )}
            <DataTable
                columns={[
                    { key: 'producto', label: 'Producto' },
                    { key: 'ventas',   label: 'Ventas 90 d', align: 'right', hideBelow: 'md' },
                    { key: 'aplic',    label: 'Aplicaciones por unidad suelta' },
                    { key: 'accion',   label: '' },
                ]}
                loading={filas == null}
                skeletonRows={5}
                empty={{ icon: Syringe, message: soloSinConfirmar ? 'Todas confirmadas' : 'Sin inyecciones vendidas en 90 días' }}
                minWidth="640px"
                movil={{ identidad: 'producto', ancla: 'aplic', chips: ['ventas'], acciones: true }}
            >
                {visibles.slice(0, 150).map((f, i) => {
                    const n = editando[clave(f)] ?? f.confirmadas ?? f.sugeridas;
                    const ml = f.contenido_ml != null;
                    return (
                        <DataRow key={clave(f)} index={i}>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold">{f.descripcion}</p>
                                <p className="text-caption text-content-3">
                                    {comoSeVende(f.factores)}
                                    {f.clasificacion === 'incluido' && ` · agregado a mano${f.clasificado_por ? ` por ${shortEmployeeName(f.clasificado_por)}` : ''}`}
                                </p>
                            </DataCell>
                            <DataCell align="right" hideBelow="md" className="text-body-sm">{f.ventas}</DataCell>
                            <DataCell>
                                {ml ? (
                                    <div className="space-y-0.5">
                                        <p className="text-body-sm font-semibold text-content">
                                            {fmtMl(f.contenido_ml)} ml · {(f.opciones_ml || []).map((d) => `${fmtMl(d)} ml`).join(' o ')}
                                        </p>
                                        <p className="text-caption text-content-3">
                                            {(f.opciones_ml || []).map((d) => aplicacionesPorDosis(f.contenido_ml, d)).join(' o ')} aplicaciones
                                            por unidad, según la dosis{f.ml_por ? ` · ${shortEmployeeName(f.ml_por)}` : ''}
                                        </p>
                                    </div>
                                ) : (
                                <div className="flex items-center gap-2">
                                    <Button variant="secondary" size="sm" iconOnly icon={Minus} title="Una menos"
                                        disabled={n <= 1} onClick={() => setEditando((e) => ({ ...e, [clave(f)]: n - 1 }))} />
                                    <span className="w-6 text-center font-black tabular-nums">{n}</span>
                                    <Button variant="secondary" size="sm" iconOnly icon={Plus} title="Una más"
                                        disabled={n >= 20} onClick={() => setEditando((e) => ({ ...e, [clave(f)]: n + 1 }))} />
                                    {f.confirmadas == null
                                        ? <Badge variant="warning" size="sm">Sugerida</Badge>
                                        : <Badge variant="success" size="sm">{f.confirmado_por ? shortEmployeeName(f.confirmado_por) : 'Confirmada'}</Badge>}
                                </div>
                                )}
                            </DataCell>
                            <DataCell align="right">
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" size="sm" disabled={guardando != null}
                                        title="No es una inyección: deja de ofrecerse para cobrar la aplicación"
                                        onClick={() => quitar(f)}>
                                        Quitar
                                    </Button>
                                    <Button variant="secondary" size="sm" icon={Droplet} disabled={guardando != null}
                                        title="Para un vial que rinde según cuánto se pone"
                                        onClick={() => setPorMl(f)}>
                                        {ml ? 'Cambiar ml' : 'Por ml'}
                                    </Button>
                                    {!ml && (
                                        <Button variant="primary" size="sm" loading={guardando === clave(f)}
                                            disabled={guardando != null || (f.confirmadas != null && n === f.confirmadas)}
                                            onClick={() => confirmar(f)}>
                                            Confirmar
                                        </Button>
                                    )}
                                </div>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {porMl && (
                <MililitrosModal fila={porMl} guardando={guardando === clave(porMl)} onClose={() => setPorMl(null)}
                    onGuardar={(v) => guardarMl(porMl, v)}
                    onQuitar={() => guardarMl(porMl, { contenidoMl: null })} />
            )}

            {quitados.length > 0 && (
                <div className="space-y-2">
                    <button type="button" onClick={() => setVerQuitados((v) => !v)}
                        className="text-body-sm font-bold underline text-content-2 min-h-[var(--tap-min)]">
                        {verQuitados ? 'Ocultar los quitados' : `Quitados a mano (${quitados.length})`}
                    </button>
                    {verQuitados && (
                        <ul className="space-y-2">
                            {quitados.map((f) => (
                                <li key={clave(f)} data-surface="card"
                                    className="rounded-xl p-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-semibold text-content truncate">{f.descripcion}</p>
                                        <p className="text-caption text-content-3">
                                            No cuenta como inyección
                                            {f.clasificado_por ? ` · lo quitó ${shortEmployeeName(f.clasificado_por)}` : ''}
                                        </p>
                                    </div>
                                    <Button variant="secondary" size="sm" disabled={guardando != null}
                                        onClick={() => clasificar(f.erp_product_id, null, f.descripcion, 'incluir')}>
                                        Volver a incluir
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
