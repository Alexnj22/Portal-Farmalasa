import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Hourglass, Users } from 'lucide-react';
import Button from '../../components/common/Button';
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
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaNumerica } from '@nucleo/utils/fecha';

/*
 * Lo pagado y sin aplicar: qué tiene cada cliente a su nombre.
 *
 * Es la pregunta del mostrador —«ya pagué tres, vengo por la segunda»— y la de
 * supervisión: una pendiente vieja es un cliente que pagó y no volvió, o una
 * aplicación que se hizo y nadie marcó. Por eso la antigüedad va a la vista.
 *
 * Quien opera una caja puede marcarlas aplicadas desde acá también, igual que
 * desde Mi caja → Aplicación de inyección → «Ya la pagó».
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
    const [elegidas, setElegidas] = useState(() => new Set());
    const [enviando, setEnviando] = useState(false);

    const cargar = useCallback(() => fetchAplicacionesPendientes({ buscar: searchTerm, sala: filterBranch || null })
        .then((d) => { setFilas(d); setError(null); setElegidas(new Set()); })
        .catch((e) => { setFilas([]); setError(mensajeAmigable(e, 'No se pudieron cargar las pendientes')); }),
    [searchTerm, filterBranch]);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al cambiar filtros

    const total = useMemo(() => (filas || []).reduce((s, p) => s + Number(p.precio || 0), 0), [filas]);
    const clientes = useMemo(() => new Set((filas || []).map((p) => p.customer_id || p.cliente)).size, [filas]);
    const viejas = useMemo(() => (filas || []).filter((p) => diasDesde(p.pagada_at) >= 7).length, [filas]);

    const cuerpo = useRef(null);
    cuerpo.current = async () => {
        setEnviando(true);
        try {
            const ids = [...elegidas];
            const n = await aplicarPendientes(ids, filterBranch || null);
            useStaffStore.getState().appendAuditLog('INYECCION_APLICADA', ids.join(','), { aplicaciones: n });
            showToast(n === 1 ? 'Aplicación marcada' : `${n} aplicaciones marcadas`, 'Quedan como aplicadas por ti.', 'success');
        } catch (e) {
            showToast('No se pudieron marcar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
            cargar();
        }
    };
    const aplicar = useMemo(() => unaSolaVez(() => cuerpo.current()), []);

    const alternar = (id) => setElegidas((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });

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

            {puedeAplicar && elegidas.size > 0 && (
                <div className="flex justify-end">
                    <Button variant="primary" icon={CheckCircle2} loading={enviando} onClick={aplicar}>
                        {elegidas.size > 1 ? `Marcar ${elegidas.size} aplicadas` : 'Marcar aplicada'}
                    </Button>
                </div>
            )}

            <DataTable
                columns={[
                    { key: 'cliente',  label: 'Cliente' },
                    { key: 'producto', label: 'Inyección' },
                    { key: 'pagada',   label: 'Pagada' },
                    { key: 'monto',    label: 'Monto', align: 'right' },
                    ...(puedeAplicar ? [{ key: 'accion', label: '' }] : []),
                ]}
                loading={filas == null}
                skeletonRows={6}
                empty={{ icon: Hourglass, message: searchTerm ? 'Nadie con ese dato tiene aplicaciones pendientes' : 'Ninguna pendiente: todo lo pagado ya se aplicó' }}
                minWidth="680px"
                /* `acciones: true`: «Elegir» es la única acción y tiene que verse en el
                   teléfono — es justo donde la sala marca lo que aplicó. */
                movil={{ identidad: 'cliente', ancla: 'monto', chips: ['producto', 'pagada'], acciones: true }}
            >
                {(filas || []).map((p, i) => {
                    const dias = diasDesde(p.pagada_at);
                    return (
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
                                <p>{fechaCorta(p.pagada_at)}
                                    {dias >= 7 && <Badge variant="warning" size="sm" className="ml-2">{dias} días</Badge>}
                                </p>
                                {p.cobrada_por && <p className="text-caption text-content-3">{shortEmployeeName(p.cobrada_por)}</p>}
                            </DataCell>
                            <DataCell align="right" className="font-semibold text-body-sm">{formatMoney(p.precio)}</DataCell>
                            {puedeAplicar && (
                                <DataCell align="right">
                                    <Button variant={elegidas.has(p.id) ? 'primary' : 'secondary'} size="sm"
                                        aria-pressed={elegidas.has(p.id)} onClick={() => alternar(p.id)}>
                                        {elegidas.has(p.id) ? 'Elegida' : 'Elegir'}
                                    </Button>
                                </DataCell>
                            )}
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}
