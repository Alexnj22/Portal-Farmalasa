import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, PackageMinus, PackagePlus, Trash2 } from 'lucide-react';
import ListRow from '../../components/common/ListRow';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SearchInput from '../../components/common/SearchInput';
import { SkeletonText } from '../../components/common/StateViews';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import {
    fetchLotesPorVencer, buscarConExistencia, fetchPresentaciones,
    insertMovimientoInventario, TOPE_LISTA,
} from '../../data/inventoryMovements';

// Widget «Carga y Descarte de Inventario».
//
// El portal ya sabe qué hay vencido en cada sucursal, lote por lote, porque el
// sync lo trae cada minuto. Así que acá el trabajo va al revés que en la
// pantalla del sistema de origen: en vez de buscar producto por producto, la
// lista se propone y la persona tilda lo que va.
//
// La solicitud NO mueve nada. La crea, alguien la aprueba, y recién ahí se
// aplica —fuera del navegador, con el stock releído en ese momento—.

// Los cuatro exactos que acepta el sistema. Se validan también en la base de
// datos: un valor que no reconozca se descubriría después de aprobar.
const SUBTIPOS = [
    { value: 'VENCIMIENTO',     label: 'Vencimiento' },
    { value: 'DESCARTE',        label: 'Descarte' },
    { value: 'PRODUCTO DAÑADO', label: 'Producto dañado' },
    { value: 'CONSUMO INTERNO', label: 'Consumo interno' },
];

const PLAZOS = [
    { value: '0',  label: 'Ya vencidos' },
    { value: '30', label: 'Vencen en 30 días' },
    { value: '60', label: 'Vencen en 60 días' },
    { value: '90', label: 'Vencen en 90 días' },
];

const SUPERVISOR_ROLE_ID = 13; // Supervisor/a de Ventas

/**
 * Quién resuelve: SIEMPRE Supervisión, no la jefatura de la sucursal.
 *
 * Decidido con el usuario el 2026-08-06. La primera versión de esto buscaba al
 * jefe o subjefe y encima lo hacía sobre TODA la lista de empleados, así que una
 * solicitud de Salud 3 podía caerle al jefe de Salud 1. La jefatura sí se entera
 * —pero del RESULTADO, y por un trigger, no desde el navegador—.
 */
function findTargetEmployee(employees) {
    const disponible = employees.find(e => {
        if (e.status !== 'ACTIVO') return false;
        if (e.role_id !== SUPERVISOR_ROLE_ID && e.roleId !== SUPERVISOR_ROLE_ID) return false;
        const ev = e.activeEventType ?? e.active_event_type;
        return !ev || !['VACATION', 'DISABILITY'].includes(ev);
    });
    if (disponible) return disponible;
    return employees.find(e => ['ADMIN', 'SUPERADMIN'].includes(String(e.system_role ?? '').toUpperCase()));
}

const claveLinea = f => `${f.erp_product_id}|${f.lote ?? ''}|${f.fecha_vencimiento ?? ''}`;

const fmtFecha = (d) => {
    if (!d) return null;
    const [a, m, dd] = String(d).split('-');
    return `${dd}/${m}/${a.slice(2)}`;
};

/** Días entre hoy (El Salvador) y una fecha. Negativo = ya pasó. */
function diasHasta(fecha) {
    if (!fecha) return null;
    const hoy = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return Math.round((new Date(fecha) - new Date(hoy)) / 86400000);
}

export default function WidgetInventoryMovement({ erpSucursalId, branchId, branchName, erpUbicacionId }) {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const appendAuditLog = useStaffStore(s => s.appendAuditLog);

    const [movimiento, setMovimiento] = useState('DESCARTE');
    const [subtipo,    setSubtipo]    = useState('VENCIMIENTO');
    const [plazo,      setPlazo]      = useState('0');
    const [busqueda,   setBusqueda]   = useState('');

    const [filas,    setFilas]    = useState([]);
    const [hayMas,   setHayMas]   = useState(false);
    const [cargando, setCargando] = useState(false);

    const [elegidas, setElegidas] = useState({});   // clave → { fila, cantidad, tipo, factor }
    const [presPorProducto, setPresPorProducto] = useState(new Map());

    const [causa, setCausa]       = useState('');
    const [enviando, setEnviando] = useState('');
    const [error, setError]       = useState('');
    const [listo, setListo]       = useState(false);

    // La lista propuesta: lo vencido de esta sucursal. Solo para el descarte por
    // vencimiento — en los otros casos no hay lista que proponer y se busca.
    const porVencimiento = movimiento === 'DESCARTE' && subtipo === 'VENCIMIENTO';

    useEffect(() => {
        if (!erpSucursalId || !porVencimiento) { setFilas([]); setHayMas(false); return; }
        let cancelado = false;
        setCargando(true);
        fetchLotesPorVencer({ erpSucursalId, dias: Number(plazo) }).then(r => {
            if (cancelado) return;
            setFilas(r.filas);
            setHayMas(r.hayMas);
            setCargando(false);
        });
        return () => { cancelado = true; };
    }, [erpSucursalId, plazo, porVencimiento]);

    // Búsqueda, para todo lo que no es vencimiento.
    useEffect(() => {
        if (porVencimiento) return;
        const q = busqueda.trim();
        if (q.length < 2) { setFilas([]); return; }
        let cancelado = false;
        setCargando(true);
        const t = setTimeout(() => {
            buscarConExistencia({ erpSucursalId, texto: q }).then(r => {
                if (cancelado) return;
                setFilas(r.filas);
                setCargando(false);
            });
        }, 300);
        return () => { cancelado = true; clearTimeout(t); };
    }, [busqueda, erpSucursalId, porVencimiento]);

    // Las presentaciones de lo que se ve. Es el SIGNIFICADO —tipo y factor—, no
    // el id: el otro sistema los numera distinto y resuelve por etiqueta.
    useEffect(() => {
        const ids = filas.map(f => f.erp_product_id);
        if (!ids.length) return;
        let cancelado = false;
        fetchPresentaciones(ids).then(r => {
            if (!cancelado && !r.error) setPresPorProducto(r.porProducto);
        });
        return () => { cancelado = true; };
    }, [filas]);

    // Al cambiar de movimiento o de sucursal, lo elegido deja de tener sentido.
    useEffect(() => { setElegidas({}); setError(''); }, [movimiento, subtipo, erpSucursalId]);

    const alternar = useCallback((fila) => {
        const k = claveLinea(fila);
        setElegidas(prev => {
            if (prev[k]) { const { [k]: _, ...resto } = prev; return resto; }
            const pres = presPorProducto.get(fila.erp_product_id) ?? [];
            const unidad = pres.find(p => p.factor === 1) ?? pres[0];
            return {
                ...prev,
                [k]: {
                    fila,
                    cantidad: String(fila.cantidad ?? ''),
                    tipo:   unidad?.tipo ?? 'UNIDAD',
                    factor: unidad?.factor ?? 1,
                },
            };
        });
    }, [presPorProducto]);

    const totales = useMemo(() => {
        const vals = Object.values(elegidas);
        return {
            lineas: vals.length,
            unidades: vals.reduce((s, e) => s + (Number(e.cantidad) || 0), 0),
        };
    }, [elegidas]);

    // Una cantidad mayor a la existencia no se puede aplicar, así que se frena
    // acá en vez de dejar que falle recién al aprobar.
    const excedidas = useMemo(
        () => Object.values(elegidas).filter(e => Number(e.cantidad) > Number(e.fila.cantidad)),
        [elegidas],
    );

    const puedeEnviar = totales.lineas > 0
        && totales.unidades > 0
        && excedidas.length === 0
        && causa.trim().length > 0
        && Boolean(erpSucursalId && erpUbicacionId);

    const enviar = async () => {
        setError('');
        if (!puedeEnviar) return;
        setEnviando('si');
        try {
            const target = findTargetEmployee(employees);
            const items = Object.values(elegidas).map(e => ({
                erp_product_id:    e.fila.erp_product_id,
                descripcion:       e.fila.descripcion,
                presentacion_tipo: e.tipo,
                factor:            e.factor,
                cantidad:          Number(e.cantidad),
                lote:              e.fila.lote ?? null,
                vence:             e.fila.fecha_vencimiento ?? null,
                existencia:        e.fila.cantidad,
            }));

            const { error: errIns } = await insertMovimientoInventario({
                employee_id: user?.id,
                approver_id: target?.id ?? null,
                type: movimiento === 'CARGA' ? 'INVENTORY_LOAD_REQUEST' : 'INVENTORY_DISCARD_REQUEST',
                status: 'PENDING',
                note: causa.trim(),
                metadata: {
                    movimiento,
                    subtipo: movimiento === 'CARGA' ? undefined : subtipo,
                    reason: causa.trim(),
                    branch_id: branchId,
                    branch_name: branchName,
                    // Los ids con los que se ubica el movimiento fuera del
                    // portal. Los del portal no sirven allá: son numeraciones
                    // distintas y la equivocada apunta a otra sucursal.
                    erp_sucursal_id: erpSucursalId,
                    erp_ubicacion_id: erpUbicacionId,
                    items,
                    total_unidades: totales.unidades,
                    notified_employee_id: target?.id ?? null,
                    notified_employee: target?.name ?? 'Sin jefatura asignada',
                },
            });
            if (errIns) throw errIns;

            await appendAuditLog(
                movimiento === 'CARGA' ? 'INVENTARIO_CARGA_SOLICITADA' : 'INVENTARIO_DESCARTE_SOLICITADO',
                String(branchId ?? ''),
                { subtipo, lineas: totales.lineas, unidades: totales.unidades, causa: causa.trim() },
            );

            // El aviso a quien aprueba lo crea el trigger junto con la fila. No
            // se manda desde acá: una llamada aparte puede no ejecutarse, y esa
            // es la razón por la que este módulo existió sin avisos durante
            // toda su historia.
            setListo(true);
            setElegidas({});
            setCausa('');
            setTimeout(() => setListo(false), 2800);
        } catch (e) {
            setError(String(e?.message ?? '').includes('row-level security')
                ? 'No tienes permiso para crear solicitudes de inventario.'
                : (e?.message || 'No se pudo enviar la solicitud.'));
        } finally {
            setEnviando('');
        }
    };

    if (listo) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-3">
                <CheckCircle2 size={40} className="text-success" strokeWidth={1.5} />
                <div className="text-center">
                    <p className="text-body-lg font-black text-content">Solicitud enviada</p>
                    <p className="text-body-sm text-content-3 mt-1">
                        La jefatura fue notificada. El inventario se mueve al aprobarla.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 h-full">
            {/* Qué se hace */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
                <LiquidSelect
                    nano
                    value={movimiento}
                    onChange={setMovimiento}
                    options={[
                        { value: 'DESCARTE', label: 'Descartar' },
                        { value: 'CARGA',    label: 'Cargar' },
                    ]}
                />
                {movimiento === 'DESCARTE' && (
                    <LiquidSelect nano value={subtipo} onChange={setSubtipo} options={SUBTIPOS} />
                )}
                {porVencimiento && (
                    <LiquidSelect nano value={plazo} onChange={setPlazo} options={PLAZOS} />
                )}
                {!porVencimiento && (
                    <SearchInput
                        expandable
                        accentColor="var(--warning)"
                        value={busqueda}
                        onChange={setBusqueda}
                        placeholder="Buscar producto…"
                    />
                )}
            </div>

            {/* Lo que hay */}
            <div className="flex-1 overflow-y-auto space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {cargando && <div className="flex justify-center py-8"><SkeletonText lines={4} className="w-full max-w-md" /></div>}

                {!cargando && hayMas && (
                    <p className="text-micro text-warning-text font-semibold px-1">
                        Se muestran los {TOPE_LISTA} más próximos a vencer. Hay más: envía esta tanda y vuelve.
                    </p>
                )}

                {!cargando && filas.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3 px-4 text-center">
                        {porVencimiento ? <PackageMinus size={28} strokeWidth={1.5} /> : <PackagePlus size={28} strokeWidth={1.5} />}
                        <p className="text-body-sm font-semibold">
                            {porVencimiento
                                ? 'No hay nada por vencer en este plazo'
                                : busqueda.trim().length < 2
                                    ? 'Busca el producto que quieres mover'
                                    : `Sin coincidencias para "${busqueda}"`}
                        </p>
                    </div>
                )}

                {!cargando && filas.map(f => {
                    const k = claveLinea(f);
                    const sel = elegidas[k];
                    const dias = diasHasta(f.fecha_vencimiento);
                    const pres = presPorProducto.get(f.erp_product_id) ?? [];
                    const excede = sel && Number(sel.cantidad) > Number(f.cantidad);
                    return (
                        <ListRow
                            key={k}
                            onClick={() => alternar(f)}
                            leading={<Trash2 size={14} className={sel ? 'text-danger-text' : 'text-content-3'} strokeWidth={2} />}
                            className={`border-divider bg-surface-card ${sel ? 'border-brand/40' : 'hover:border-brand/40'}`}
                            title={f.descripcion}
                            trailing={
                                <span className="text-caption font-black text-content-3">{f.cantidad}</span>
                            }
                        >
                            <span className="block text-micro text-content-3 truncate">
                                {[
                                    f.lote && f.lote !== 'GENERICO' ? `Lote ${f.lote}` : null,
                                    f.fecha_vencimiento ? `Vence ${fmtFecha(f.fecha_vencimiento)}` : null,
                                    dias !== null && dias < 0 ? `hace ${Math.abs(dias)} días` : null,
                                ].filter(Boolean).join(' · ')}
                            </span>

                            {sel && (
                                <div
                                    className="flex flex-wrap items-center gap-2 mt-2"
                                    role="presentation"
                                    onClick={e => e.stopPropagation()}
                                >
                                    <PortalInput
                                        type="number"
                                        min="0"
                                        value={sel.cantidad}
                                        onChange={e => setElegidas(p => ({ ...p, [k]: { ...p[k], cantidad: e.target.value } }))}
                                        className="w-24"
                                    />
                                    {pres.length > 1 && (
                                        <LiquidSelect
                                            nano
                                            value={`${sel.tipo}|${sel.factor}`}
                                            onChange={v => {
                                                const [tipo, factor] = String(v).split('|');
                                                setElegidas(p => ({ ...p, [k]: { ...p[k], tipo, factor: Number(factor) } }));
                                            }}
                                            options={pres.map(p => ({
                                                value: `${p.tipo}|${p.factor}`,
                                                label: p.factor > 1 ? `${p.tipo} (${p.factor})` : p.tipo,
                                            }))}
                                        />
                                    )}
                                    {excede && (
                                        <span className="text-micro text-danger-text font-semibold">
                                            Hay {f.cantidad}
                                        </span>
                                    )}
                                </div>
                            )}
                        </ListRow>
                    );
                })}
            </div>

            {/* La causa y el envío */}
            {totales.lineas > 0 && (
                <div className="shrink-0 flex flex-col gap-2 pt-2 border-t border-divider">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-caption font-black text-content-3 uppercase tracking-widest">
                            {totales.lineas} {totales.lineas === 1 ? 'producto' : 'productos'}
                            {' · '}
                            {totales.unidades} {totales.unidades === 1 ? 'unidad' : 'unidades'}
                        </p>
                        {excedidas.length > 0 && (
                            <span className="flex items-center gap-1 text-micro text-danger-text font-semibold">
                                <AlertTriangle size={12} strokeWidth={2.5} />
                                {excedidas.length} sin existencia suficiente
                            </span>
                        )}
                    </div>

                    <PortalTextarea
                        value={causa}
                        onChange={e => setCausa(e.target.value)}
                        rows={2}
                        placeholder="Por qué se mueve — queda escrito en el movimiento"
                    />

                    {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

                    <Button
                        variant="primary"
                        onClick={enviar}
                        disabled={!puedeEnviar}
                        loading={Boolean(enviando)}
                    >
                        {movimiento === 'CARGA' ? 'Enviar solicitud de carga' : 'Enviar solicitud de descarte'}
                    </Button>
                </div>
            )}
        </div>
    );
}
