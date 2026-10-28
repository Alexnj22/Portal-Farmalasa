import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, CheckCircle2 } from 'lucide-react';
import Button from '../../components/common/Button';
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
import { confirmarAplicaciones, fetchPorConfirmar } from '@nucleo/data/inyecciones';
import { unaSolaVez } from '@nucleo/utils/unaSolaVez';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fmtMl } from '@nucleo/utils/inyeccionDosis';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hoySV } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';

/*
 * Por confirmar — enfermería confirma cuáles aplicó (2026-10-28).
 *
 * Definición del usuario: cualquiera registra la aplicación; la enfermera
 * confirma las que aplicó ella; la bitácora son las confirmadas. Las que marca
 * ella misma ya entran confirmadas y no aparecen acá.
 *
 * El plazo es hasta el final del día siguiente. Lo que no se confirma a tiempo
 * sale solo de esta lista como «no aplicada por enfermería»: no entra a la
 * bitácora y sólo lo ve administración. No hay botón «no fui yo» a propósito
 * —no confirmar ES esa respuesta—.
 *
 * Quien sólo VE la pestaña (administración) ve la lista sin los botones.
 */

const factura = (c) => String(c || '').replace(/^0+/, '');

export default function TabConfirmar({ filterBranch, setFilterBranch, branchOptions, branchLocked, searchTerm }) {
    const { hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const puedeConfirmar = hasPermission('inyecciones_tab_confirmar', 'can_edit');
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const [enviando, setEnviando] = useState(false);

    const sala = branchLocked ? null : (filterBranch || null);
    const cargar = useCallback(() => fetchPorConfirmar({ sala })
        .then((d) => { setFilas(d); setError(null); })
        .catch((e) => { setFilas([]); setError(mensajeAmigable(e, 'No se pudo cargar la lista')); }),
    [sala]);
    useEffect(() => { cargar(); }, [cargar]);

    const visibles = useMemo(() => (filas || []).filter((f) => tokenMatch(searchTerm,
        f.cliente, f.producto, f.correlativo, f.aplicada_por)), [filas, searchTerm]);
    const hoy = hoySV();
    const vencenHoy = useMemo(() => visibles.filter((f) => f.confirmar_hasta === hoy).length, [visibles, hoy]);

    const confirmar = useMemo(() => unaSolaVez(async (ids) => {
        setEnviando(true);
        try {
            const n = await confirmarAplicaciones(ids);
            useStaffStore.getState().appendAuditLog('INYECCION_CONFIRMADA_ENFERMERIA', ids.join(','), { aplicaciones: n });
            showToast(n === 1 ? 'Aplicación confirmada' : `${n} aplicaciones confirmadas`, 'Quedan en la bitácora a tu nombre.', 'success');
        } catch (e) {
            showToast('No se pudo confirmar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
            cargar();
        }
    }), [cargar, showToast]);

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen por confirmar">
                    <StatCard icon={ClipboardCheck} label="Por confirmar"
                        value={filas == null ? '—' : visibles.length.toLocaleString()}
                        sub="Aplicadas que marcó otra persona" loading={filas == null} />
                    <StatCard icon={ClipboardCheck} label="Vencen hoy"
                        value={filas == null ? '—' : vencenHoy.toLocaleString()}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls="text-warning-text"
                        sub="Si no se confirman, no entran a la bitácora" loading={filas == null} />
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

            <p className="text-caption text-content-3">
                Confirma sólo las que <b className="text-content-2">aplicaste tú</b>. Las que no confirmes hasta el
                final del día siguiente no entran a la bitácora.
            </p>

            {puedeConfirmar && visibles.length > 1 && (
                <div className="flex justify-end">
                    <Button variant="secondary" icon={CheckCircle2} loading={enviando}
                        onClick={() => confirmar(visibles.map((f) => f.id))}>
                        Confirmar las {visibles.length}
                    </Button>
                </div>
            )}

            <DataTable
                columns={[
                    { key: 'cliente',  label: 'Cliente' },
                    { key: 'producto', label: 'Inyección' },
                    { key: 'marco',    label: 'La marcó' },
                    { key: 'plazo',    label: 'Plazo' },
                    ...(puedeConfirmar ? [{ key: 'accion', label: '' }] : []),
                ]}
                loading={filas == null}
                skeletonRows={5}
                empty={{ icon: ClipboardCheck, message: searchTerm ? 'Nada con ese dato por confirmar' : 'Nada por confirmar' }}
                minWidth="680px"
                /* `acciones: true`: «La apliqué yo» es la única acción y tiene que
                   verse en el teléfono, que es donde la enfermera confirma. */
                movil={{ identidad: 'cliente', ancla: 'plazo', chips: ['producto', 'marco'], acciones: true }}
            >
                {visibles.map((f, i) => (
                    <DataRow key={f.id} index={i}>
                        <DataCell className="text-body-sm">
                            <p className="font-semibold text-content">{f.cliente || 'Sin nombre'}</p>
                            <p className="text-caption text-content-3 mt-0.5">
                                {f.correlativo ? `Factura ${factura(f.correlativo)}` : 'Traída por el cliente'}
                                {!branchLocked && f.aplicada_en ? ` · ${f.aplicada_en}` : ''}
                            </p>
                        </DataCell>
                        <DataCell className="text-body-sm">
                            <p className="text-content">{f.producto}</p>
                            {(f.dosis_ml != null || f.mezclada) && (
                                <p className="flex flex-wrap gap-1.5 mt-1">
                                    {f.dosis_ml != null && <Badge variant="info" size="sm">{fmtMl(f.dosis_ml)} ml</Badge>}
                                    {f.mezclada && <Badge variant="info" size="sm">Mezcladas · una aplicación</Badge>}
                                </p>
                            )}
                        </DataCell>
                        <DataCell className="whitespace-nowrap">
                            <PersonaConFoto id={f.aplicada_por_id} nombre={f.aplicada_por} px={22} detalle={fechaHora12(f.aplicada_at)} />
                        </DataCell>
                        <DataCell className="whitespace-nowrap">
                            {f.confirmar_hasta === hoy
                                ? <Badge variant="warning" size="sm" dot>Hasta hoy</Badge>
                                : <Badge variant="neutral" size="sm">Hasta mañana</Badge>}
                        </DataCell>
                        {puedeConfirmar && (
                            <DataCell align="right">
                                <Button variant="primary" size="sm" icon={CheckCircle2} disabled={enviando}
                                    onClick={() => confirmar([f.id])}>
                                    La apliqué yo
                                </Button>
                            </DataCell>
                        )}
                    </DataRow>
                ))}
            </DataTable>
        </div>
    );
}
