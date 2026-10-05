import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Hourglass, Users } from 'lucide-react';
import Button from '../../components/common/Button';
import Contador from '../../components/caja/Contador';
import PersonaConFoto from '../../components/caja/PersonaConFoto';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { aplicarPendientes, fetchAplicacionesPendientes } from '@nucleo/data/inyecciones';
import { unaSolaVez } from '@nucleo/utils/unaSolaVez';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fmtMl } from '@nucleo/utils/inyeccionDosis';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';

/*
 * Lo pagado y sin aplicar: qué tiene cada cliente a su nombre.
 *
 * Es la pregunta del mostrador —«ya pagué tres, vengo por la segunda»— y la de
 * supervisión: una pendiente vieja es un cliente que pagó y no volvió, o una
 * aplicación que se hizo y nadie marcó. Por eso la antigüedad va a la vista.
 *
 * Quien opera una caja puede marcarlas aplicadas desde acá también, igual que
 * desde Mi caja → Aplicación de inyección → «Ya la pagó».
 *
 * Una fila por PAGO y producto, no por aplicación (2026-10-03): pagó 5 y hoy
 * se aplica 2 → «2 de 5» con un contador, y debajo el historial de lo que ya
 * se aplicó de ese pago — dónde, quién (con su foto) y cuándo. Pedidos del
 * usuario: «¿la card muestra el historial de cada una?».
 *
 * De TODAS las salas, también para quien sólo ve la suya (2026-10-05): el
 * filtro de sala comparaba la sala del PAGO, así que el cliente que pagó en
 * Salud 1 no aparecía en Salud 2, que es donde vino a aplicarse. La sala
 * propia sirve para marcar lo que es de otra sucursal, no para esconderlo.
 */

const fechaCorta = (f) => fechaNumerica(String(f || '').slice(0, 10), { anio: false });
const factura = (c) => String(c || '').replace(/^0+/, '');
const diasDesde = (f) => Math.max(0, Math.floor((Date.now() - new Date(f).getTime()) / 86_400_000));

export default function TabPendientes({ filterBranch, setFilterBranch, branchOptions, branchLocked, searchTerm, nombreSala }) {
    const { hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const puedeAplicar = hasPermission('caja_vales', 'can_edit');
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const [cuantas, setCuantas] = useState({});   // grupo → cuántas se aplican ahora
    const [enviando, setEnviando] = useState(false);

    // Con la sala fija (quien sólo ve la suya) NO se filtra: ver arriba.
    const salaFiltro = branchLocked ? null : (filterBranch || null);
    const salaPropia = branchLocked ? Number(filterBranch) || null : null;
    const cargar = useCallback(() => fetchAplicacionesPendientes({ buscar: searchTerm, sala: salaFiltro })
        .then((d) => { setFilas(d); setError(null); setCuantas({}); })
        .catch((e) => { setFilas([]); setError(mensajeAmigable(e, 'No se pudieron cargar las pendientes')); }),
    [searchTerm, salaFiltro]);
    useEffect(() => { cargar(); }, [cargar]);

    const grupos = useMemo(() => {
        const m = new Map();
        for (const p of filas || []) {
            const k = `${p.cobro_id}|${p.producto}|${p.dosis_ml ?? ''}`;
            if (!m.has(k)) m.set(k, { clave: k, p, ids: [] });
            m.get(k).ids.push(p.id);
        }
        return [...m.values()];
    }, [filas]);
    const elegidas = useMemo(() => grupos.flatMap((g) => g.ids.slice(0, cuantas[g.clave] || 0)), [grupos, cuantas]);

    const total = useMemo(() => (filas || []).reduce((s, p) => s + Number(p.precio || 0), 0), [filas]);
    const clientes = useMemo(() => new Set((filas || []).map((p) => p.customer_id || p.cliente)).size, [filas]);
    const viejas = useMemo(() => (filas || []).filter((p) => diasDesde(p.pagada_at) >= 7).length, [filas]);
    const deOtras = useMemo(() => (salaPropia ? (filas || []).filter((p) => p.branch_id !== salaPropia).length : 0),
        [filas, salaPropia]);

    // Los ids viajan como argumento: así la acción no lee estado viejo ni
    // necesita una ref que se reescribe en cada render.
    const aplicar = useMemo(() => unaSolaVez(async (ids, sala) => {
        setEnviando(true);
        try {
            const n = await aplicarPendientes(ids, sala || null);
            useStaffStore.getState().appendAuditLog('INYECCION_APLICADA', ids.join(','), { aplicaciones: n });
            showToast(n === 1 ? 'Aplicación marcada' : `${n} aplicaciones marcadas`, 'Quedan como aplicadas por ti.', 'success');
        } catch (e) {
            showToast('No se pudieron marcar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
            cargar();
        }
    }), [cargar, showToast]);


    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de pendientes">
                    <StatCard icon={Hourglass} label="Aplicaciones pendientes"
                        value={filas == null ? '—' : filas.length.toLocaleString()}
                        sub={filas == null ? undefined : `${formatMoney(total)} cobrados`} loading={filas == null} />
                    <StatCard icon={Users} label="Clientes" value={filas == null ? '—' : clientes.toLocaleString()}
                        sub="Con algo pagado sin aplicar" loading={filas == null} />
                    <StatCard icon={Hourglass} label="Con 7 días o más"
                        value={filas == null ? '—' : viejas.toLocaleString()}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls="text-warning-text"
                        sub="Revisar: ¿volvió el cliente?" loading={filas == null} />
                </CarrilCards>
                {!branchLocked && (
                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={() => setFilterBranch('')} activeCount={filterBranch ? 1 : 0}>
                            <FilterBar.Section active={!!filterBranch} onClear={() => setFilterBranch('')} label="sucursal">
                                <FilterBar.Sucursal value={filterBranch} onChange={setFilterBranch} options={branchOptions} />
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                )}
            </div>

            {error && <Notice variant="danger">{error}</Notice>}

            {salaPropia && (
                <p className="text-caption text-content-3">
                    Se ven las de <b className="text-content-2">todas las sucursales</b>: el cliente puede venir a
                    aplicarse aquí aunque haya pagado en otra.
                    {deOtras > 0 && ` ${deOtras === 1 ? '1 es' : `${deOtras} son`} de otra sucursal.`}
                </p>
            )}

            {puedeAplicar && elegidas.length > 0 && (
                <div className="flex justify-end">
                    <Button variant="primary" icon={CheckCircle2} loading={enviando} onClick={() => aplicar(elegidas, filterBranch)}>
                        {elegidas.length > 1 ? `Marcar ${elegidas.length} aplicadas` : 'Marcar aplicada'}
                    </Button>
                </div>
            )}

            <DataTable
                columns={[
                    { key: 'cliente',  label: 'Cliente' },
                    { key: 'producto', label: 'Inyección' },
                    { key: 'pagada',   label: 'Pagada' },
                    { key: 'monto',    label: 'Pendientes', align: 'right' },
                    ...(puedeAplicar ? [{ key: 'accion', label: 'Aplicar ahora' }] : []),
                ]}
                loading={filas == null}
                skeletonRows={6}
                empty={{ icon: Hourglass, message: searchTerm ? 'Nadie con ese dato tiene aplicaciones pendientes' : 'Ninguna pendiente: todo lo pagado ya se aplicó' }}
                minWidth="680px"
                /* `acciones: true`: «Elegir» es la única acción y tiene que verse en el
                   teléfono — es justo donde la sala marca lo que aplicó. */
                movil={{ identidad: 'cliente', ancla: 'monto', chips: ['producto', 'pagada'], acciones: true }}
            >
                {grupos.map(({ clave, p, ids }, i) => {
                    const dias = diasDesde(p.pagada_at);
                    const n = cuantas[clave] || 0;
                    const otraSala = salaPropia && p.branch_id !== salaPropia;
                    return (
                        <DataRow key={clave} index={i}>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold text-content">{p.cliente || 'Sin nombre'}</p>
                                <p className="text-caption text-content-3 flex flex-wrap items-center gap-1.5 mt-0.5">
                                    <span>{p.correlativo ? `Factura ${factura(p.correlativo)}` : 'Traída por el cliente'}</span>
                                    {/* La sala del pago: siempre que no sea la propia, y en
                                        «todas» para todas. Una de otra sucursal se marca. */}
                                    {otraSala
                                        ? <Badge variant="warning" size="sm">Pagada en {nombreSala(p.branch_id)}</Badge>
                                        : !salaFiltro && !salaPropia && <span>· pagada en {nombreSala(p.branch_id)}</span>}
                                    {p.venta_sala && <Badge variant="info" size="sm">Venta de {p.venta_sala}</Badge>}
                                </p>
                            </DataCell>
                            <DataCell className="text-body-sm">
                                <p className="text-content">{p.producto}</p>
                                {(p.dosis_ml != null || p.mezclada) && (
                                    <p className="flex flex-wrap gap-1.5 mt-1">
                                        {/* La dosis, para quien la aplique (se cobró por ml). */}
                                        {p.dosis_ml != null && <Badge variant="info" size="sm">{fmtMl(p.dosis_ml)} ml por aplicación</Badge>}
                                        {p.mezclada && <Badge variant="info" size="sm">Mezcladas · una aplicación</Badge>}
                                    </p>
                                )}
                                {(p.historial || []).length > 0 && (
                                    <div className="mt-2 space-y-1">
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3">
                                            Ya aplicadas · {p.historial.length}
                                        </p>
                                        {p.historial.map((h, j) => (
                                            <PersonaConFoto key={j} id={h.aplicada_por_id} nombre={h.aplicada_por} px={20}
                                                detalle={`${h.aplicada_en ? `${h.aplicada_en} · ` : ''}${fechaHora12(h.aplicada_at)}`} />
                                        ))}
                                    </div>
                                )}
                            </DataCell>
                            <DataCell className="whitespace-nowrap">
                                <PersonaConFoto id={p.cobrada_por_id} nombre={p.cobrada_por} detalle={fechaCorta(p.pagada_at)} />
                                {dias >= 7 && <Badge variant="warning" size="sm" className="mt-1">{dias} días</Badge>}
                            </DataCell>
                            <DataCell align="right" className="text-body-sm whitespace-nowrap">
                                <p className="font-black tabular-nums text-content">{ids.length}</p>
                                <p className="text-caption text-content-3 tabular-nums">{formatMoney(Number(p.precio || 0) * ids.length)}</p>
                            </DataCell>
                            {puedeAplicar && (
                                <DataCell align="right">
                                    <Contador etiqueta={`aplicar ahora · ${p.producto}`} valor={n} max={ids.length}
                                        onChange={(v) => setCuantas((c) => ({ ...c, [clave]: v }))} />
                                </DataCell>
                            )}
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}
