import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Hourglass, Minus, Plus, Save, Syringe } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
    fetchAplicacionesPendientes, fetchCatalogoDeDosis, fetchPreciosDeAplicacion,
    fijarDosis, fijarPrecioDeAplicacion,
} from '@nucleo/data/inyecciones';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaNumerica } from '@nucleo/utils/fecha';

/*
 * El control de las aplicaciones pagadas, debajo de la lista de ventas.
 *
 *   · Pendientes: lo pagado y sin aplicar, a nombre de quién y desde cuándo.
 *     Es la cifra que hay que vigilar: una pendiente vieja es un cliente que
 *     pagó y no volvió, o una aplicación que se hizo y nadie marcó.
 *   · Por producto (supervisión): cuántas aplicaciones trae cada presentación.
 *     La factura no lo sabe —un TRI PACK sale «CAJA X 3» con factor 1—, así
 *     que rige una sugerencia sacada del nombre hasta que alguien la confirma.
 *   · Precio (gerencia): lo que vale una aplicación, comprada o traída.
 */

const fechaCorta = (f) => fechaNumerica(String(f || '').slice(0, 10), { anio: false });
const factura = (c) => String(c || '').replace(/^0+/, '');

export default function InyeccionesControl({ filterBranch, nombreSala, recargar }) {
    const { hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const puedeDosis = hasPermission('ventas_inyecciones_dosis');
    const puedePrecio = hasPermission('ventas_inyecciones_precios');

    const [pendientes, setPendientes] = useState(null);
    const [errorPend, setErrorPend] = useState(null);
    const [verAjustes, setVerAjustes] = useState(false);

    useEffect(() => {
        let vivo = true;
        setPendientes(null);
        fetchAplicacionesPendientes({ sala: filterBranch || null })
            .then((d) => { if (vivo) setPendientes(d); })
            .catch((e) => { if (vivo) { setPendientes([]); setErrorPend(mensajeAmigable(e, 'No se pudieron cargar las pendientes')); } });
        return () => { vivo = false; };
    }, [filterBranch, recargar]);

    const montoPend = (pendientes || []).reduce((s, p) => s + Number(p.precio || 0), 0);

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <div>
                    <h3 className="text-title-sm font-black text-content flex items-center gap-2">
                        <Hourglass className="w-4 h-4" aria-hidden="true" /> Aplicaciones pagadas sin aplicar
                    </h3>
                    <p className="text-body-sm text-content-3">
                        {pendientes == null ? 'Cargando…'
                            : pendientes.length === 0 ? 'Ninguna: todo lo pagado ya se aplicó.'
                                : `${pendientes.length} pendientes · ${formatMoney(montoPend)} cobrados. Se canjean desde Mi caja → Aplicación de inyección → «Ya la pagó».`}
                    </p>
                </div>
                {errorPend && <Notice variant="danger">{errorPend}</Notice>}
                {(pendientes || []).length > 0 && (
                    <DataTable
                        columns={[
                            { key: 'cliente',  label: 'Cliente' },
                            { key: 'producto', label: 'Inyección' },
                            { key: 'pagada',   label: 'Pagada' },
                            { key: 'monto',    label: 'Monto', align: 'right' },
                        ]}
                        minWidth="620px"
                        movil={{ identidad: 'cliente', ancla: 'monto', chips: ['producto', 'pagada'] }}
                    >
                        {pendientes.map((p, i) => (
                            <DataRow key={p.id} index={i}>
                                <DataCell className="text-body-sm">
                                    <p className="font-semibold">{p.cliente || 'Sin nombre'}</p>
                                    <p className="text-caption text-content-3">
                                        {p.correlativo ? `Factura ${factura(p.correlativo)}` : 'Traída por el cliente'}
                                        {!filterBranch && ` · ${nombreSala(p.branch_id)}`}
                                    </p>
                                </DataCell>
                                <DataCell className="text-body-sm">{p.producto}</DataCell>
                                <DataCell className="text-body-sm whitespace-nowrap">
                                    <p>{fechaCorta(p.pagada_at)}</p>
                                    {p.cobrada_por && <p className="text-caption text-content-3">{shortEmployeeName(p.cobrada_por)}</p>}
                                </DataCell>
                                <DataCell align="right" className="font-semibold text-body-sm">{formatMoney(p.precio)}</DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}
            </div>

            {(puedeDosis || puedePrecio) && (
                <div className="space-y-3">
                    <button type="button" onClick={() => setVerAjustes((v) => !v)}
                        className="text-body-sm font-bold underline text-content-2 min-h-[var(--tap-min)]">
                        {verAjustes ? 'Ocultar los ajustes' : 'Ajustes: aplicaciones por producto y precio'}
                    </button>
                    {verAjustes && puedePrecio && <Precios showToast={showToast} />}
                    {verAjustes && puedeDosis && <CatalogoDeDosis showToast={showToast} />}
                </div>
            )}
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

function CatalogoDeDosis({ showToast }) {
    const [filas, setFilas] = useState(null);
    const [editando, setEditando] = useState({});   // clave → aplicaciones
    const [guardando, setGuardando] = useState(null);
    const [soloSinConfirmar, setSoloSinConfirmar] = useState(true);

    const cargar = useCallback(() => fetchCatalogoDeDosis()
        .then(setFilas)
        .catch((e) => { setFilas([]); showToast('No se pudo cargar el catálogo', mensajeAmigable(e), 'error'); }), [showToast]);
    useEffect(() => { cargar(); }, [cargar]);

    const clave = (f) => `${f.erp_product_id}-${f.id_presentacion}`;
    const visibles = useMemo(
        () => (filas || []).filter((f) => !soloSinConfirmar || f.confirmadas == null),
        [filas, soloSinConfirmar],
    );

    const confirmar = async (f) => {
        const n = editando[clave(f)] ?? f.confirmadas ?? f.sugeridas;
        setGuardando(clave(f));
        try {
            await fijarDosis({ erpProductId: f.erp_product_id, idPresentacion: f.id_presentacion, aplicaciones: n });
            useStaffStore.getState().appendAuditLog('INYECCION_DOSIS', `${f.erp_product_id}-${f.id_presentacion}`,
                { producto: f.descripcion, presentacion: f.presentacion, aplicaciones: n });
            await cargar();
        } catch (e) {
            showToast('No se pudo confirmar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(null);
        }
    };

    const sinConfirmar = (filas || []).filter((f) => f.confirmadas == null).length;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                    <h4 className="text-title-sm font-black text-content flex items-center gap-2">
                        <ClipboardList className="w-4 h-4" aria-hidden="true" /> Aplicaciones por producto
                    </h4>
                    <p className="text-body-sm text-content-3">
                        Cuántas aplicaciones trae UNA unidad vendida de cada presentación. Mientras no se confirma,
                        rige la sugerencia. {filas && `${sinConfirmar} sin confirmar.`}
                    </p>
                </div>
                <button type="button" onClick={() => setSoloSinConfirmar((v) => !v)}
                    className="text-caption underline text-content-3 min-h-[var(--tap-min)]">
                    {soloSinConfirmar ? 'Ver también las confirmadas' : 'Ver sólo las sin confirmar'}
                </button>
            </div>
            <DataTable
                columns={[
                    { key: 'producto', label: 'Producto' },
                    { key: 'ventas',   label: 'Ventas 90 d', align: 'right', hideBelow: 'md' },
                    { key: 'aplic',    label: 'Aplicaciones por unidad' },
                    { key: 'accion',   label: '' },
                ]}
                loading={filas == null}
                skeletonRows={5}
                empty={{ icon: Syringe, message: soloSinConfirmar ? 'Todas confirmadas' : 'Sin inyecciones vendidas en 90 días' }}
                minWidth="640px"
                movil={{ identidad: 'producto', ancla: 'aplic', chips: ['ventas'] }}
            >
                {visibles.slice(0, 150).map((f, i) => {
                    const n = editando[clave(f)] ?? f.confirmadas ?? f.sugeridas;
                    return (
                        <DataRow key={clave(f)} index={i}>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold">{f.descripcion}</p>
                                <p className="text-caption text-content-3">{f.presentacion || 'Sin presentación'}</p>
                            </DataCell>
                            <DataCell align="right" hideBelow="md" className="text-body-sm">{f.ventas}</DataCell>
                            <DataCell>
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
                            </DataCell>
                            <DataCell align="right">
                                <Button variant="primary" size="sm" loading={guardando === clave(f)}
                                    disabled={guardando != null || (f.confirmadas != null && n === f.confirmadas)}
                                    onClick={() => confirmar(f)}>
                                    Confirmar
                                </Button>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}
