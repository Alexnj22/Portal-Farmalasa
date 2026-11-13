import React, { useCallback, useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { fetchBitacoraDia, pendientesDelDia } from '@nucleo/data/bitacoras';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/*
 * La bitácora del día de TODA la red, una sucursal por fila (2026-11-13).
 * Para quien ve todas las salas: antes había que abrirlas una por una para
 * saber cuál iba atrasada. La cuenta de cada fila es `pendientesDelDia` —la
 * misma que las tarjetas de arriba— para que los dos números nunca difieran.
 * Tocar una fila elige esa sucursal.
 */
export default function TablaDeLaRed({ salas, fecha, salaActual, onElegir, recarga = 0 }) {
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);

    const cargar = useCallback(async () => {
        const res = await Promise.all(salas.map(async (s) => {
            const { dia, error: e } = await fetchBitacoraDia(s.value, fecha);
            return { ...s, cuenta: pendientesDelDia(dia), error: e };
        }));
        setFilas(res);
        setError(res.find(r => r.error)?.error ?? null);
    }, [salas, fecha]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al cambiar la fecha o al recargar
    useEffect(() => { cargar(); }, [cargar, recarga]);

    return (
        <div className="space-y-2">
            <TituloDeSeccion nivel="tarjeta">Toda la red</TituloDeSeccion>
            {error && <Notice variant="danger">{mensajeAmigable(error)}</Notice>}
            <DataTable
                columns={[
                    { key: 'sala',     label: 'Sucursal' },
                    { key: 'hechas',   label: 'Anotadas' },
                    { key: 'abiertas', label: 'Tocan ahora' },
                    { key: 'vencidas', label: 'Se pasaron' },
                    { key: 'desvios',  label: 'Fuera de rango' },
                ]}
                loading={!filas}
                movil={{ usarAccionDeFila: true, identidad: 'sala', ancla: 'hechas' }}
                empty={{ icon: Network, message: 'Sin sucursales con bitácora' }}
            >
                {(filas || []).map((f, i) => {
                    const c = f.cuenta;
                    const completa = c.total > 0 && c.hechas === c.total;
                    return (
                        <DataRow key={f.value} index={i} onClick={() => onElegir(f.value)}
                            className={String(f.value) === String(salaActual) ? 'bg-info/10' : ''}>
                            <DataCell><span className="font-bold text-content">{f.label}</span></DataCell>
                            <DataCell>
                                <span className={`font-black tabular-nums ${completa ? 'text-success-text' : 'text-content'}`}>
                                    {`${c.hechas}/${c.total}`}
                                </span>
                            </DataCell>
                            <DataCell>
                                {c.abiertas > 0 ? <Badge variant="warning" size="sm">{c.abiertas}</Badge> : <span className="text-content-3">—</span>}
                            </DataCell>
                            <DataCell>
                                {c.vencidas > 0 ? <Badge variant="danger" size="sm">{c.vencidas}</Badge> : <span className="text-content-3">—</span>}
                            </DataCell>
                            <DataCell>
                                {c.desvios > 0 ? <Badge variant="danger" size="sm">{c.desvios}</Badge> : <span className="text-content-3">—</span>}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}
