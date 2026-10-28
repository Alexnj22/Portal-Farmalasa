import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Pill } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useToastStore } from '@nucleo/store/toastStore';
import { exportCsv } from '@nucleo/utils/csvExport';
import { hoySV } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { GRUPOS_AWARE, confirmarMoleculaAware, fetchListadoAntibioticos } from '@nucleo/data/bitacoras';

/*
 * Listado de antibióticos con su grupo AWaRe — Guía de Verificación BPAD 1.13
 * (MAYOR), RTS 11.02.04:24 §6.1.15.
 *
 * Una fila por MOLÉCULA, porque el grupo es de la molécula y es lo que el
 * regente confirma; debajo, los productos del catálogo que la contienen. Es de
 * toda la red: no depende de la sala.
 *
 * El grupo viene del Listado Oficial de Medicamentos 2026 (cap. J01) y, donde
 * no lo marca, de la OMS AWaRe 2023. Hasta que el regente lo confirma es una
 * propuesta, y la pantalla lo dice.
 */

const MOVIL = { identidad: 'molecula', ancla: 'grupo', chips: ['productos'], acciones: true };

export default function TabAntibioticos({ busqueda = '', puedeConfirmar = false }) {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const [confirmando, setConfirmando] = useState(null);

    const cargar = useCallback(async () => {
        const r = await fetchListadoAntibioticos();
        setFilas(r.filas);
        setError(r.error);
    }, []);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al entrar a la pestaña
    useEffect(() => { cargar(); }, [cargar]);

    const moleculas = useMemo(() => {
        const m = new Map();
        for (const f of filas || []) {
            if (!m.has(f.molecula)) {
                m.set(f.molecula, { molecula: f.molecula, grupo: f.grupo, atc: f.atc, fuente: f.fuente,
                    confirmado: f.confirmado, productos: [] });
            }
            m.get(f.molecula).productos.push(f);
        }
        const lista = [...m.values()];
        if (!busqueda.trim()) return lista;
        return lista.filter(x => tokenMatch(busqueda, x.molecula, x.atc,
            ...x.productos.map(p => p.producto)));
    }, [filas, busqueda]);

    const sinConfirmar = moleculas.filter(m => !m.confirmado).length;

    const confirmar = async (m) => {
        setConfirmando(m.molecula);
        const { error: e } = await confirmarMoleculaAware(m.molecula, m.grupo);
        setConfirmando(null);
        if (e) { showToast(mensajeAmigable(e), 'error'); return; }
        showToast(`${m.molecula}: confirmado`, 'success');
        cargar();
    };

    const exportar = () => {
        const filasCsv = (filas || []).map(f => [
            f.molecula, GRUPOS_AWARE[f.grupo]?.label || 'Sin clasificar', f.atc || '', f.fuente,
            f.confirmado ? 'Sí' : 'No', f.producto, f.principio_activo || '', f.en_el_libro ? 'Sí' : 'No',
        ]);
        exportCsv(['Molécula', 'Grupo AWaRe', 'ATC', 'Fuente', 'Confirmado por el regente',
            'Producto', 'Principio activo', 'Va al libro bajo receta'],
        filasCsv, `listado_antibioticos_${hoySV()}.csv`, 'bitacoras');
    };

    return (
        <div className="space-y-4">
            <Notice variant={sinConfirmar ? 'warning' : 'success'}>
                {sinConfirmar
                    ? `${sinConfirmar} de ${moleculas.length} moléculas sin confirmar. El grupo viene del Listado Oficial de Medicamentos 2026 y, donde no lo marca, de la OMS; vale como listado cuando el regente lo confirma.`
                    : 'Listado confirmado por el regente.'}
            </Notice>
            <div className="flex justify-end">
                <Button variant="secondary" size="sm" icon={Download} onClick={exportar} disabled={!filas?.length}>
                    Exportar
                </Button>
            </div>
            {error && <Notice variant="danger">{mensajeAmigable(error)}</Notice>}
            <DataTable
                columns={[
                    { key: 'molecula',  label: 'Molécula' },
                    { key: 'grupo',     label: 'Grupo AWaRe' },
                    { key: 'productos', label: 'Productos' },
                    { key: 'accion',    label: '' },
                ]}
                loading={filas == null}
                skeletonRows={6}
                empty={{ icon: Pill, message: 'Sin antibióticos en el catálogo' }}
                minWidth="640px"
                movil={MOVIL}
            >
                {moleculas.map((m, i) => {
                    const g = GRUPOS_AWARE[m.grupo];
                    return (
                        <DataRow key={m.molecula} index={i}>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold capitalize">{m.molecula}</p>
                                <p className="text-caption text-content-3">{m.atc} · {m.fuente}</p>
                            </DataCell>
                            <DataCell>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge variant={g?.variant || 'neutral'}>{g?.label || 'Sin clasificar'}</Badge>
                                    {m.confirmado && <Badge variant="info" icon={Check}>Confirmado</Badge>}
                                </div>
                            </DataCell>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold">{m.productos.length}</p>
                                <p className="text-caption text-content-3">
                                    {m.productos.map(p => p.producto).join(' · ')}
                                </p>
                            </DataCell>
                            <DataCell align="right">
                                {puedeConfirmar && !m.confirmado && m.grupo && (
                                    <Button variant="secondary" size="sm" icon={Check}
                                        disabled={confirmando != null} onClick={() => confirmar(m)}>
                                        Confirmar
                                    </Button>
                                )}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}
