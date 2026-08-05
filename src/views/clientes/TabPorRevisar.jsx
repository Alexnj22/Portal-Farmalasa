import React, { useState, useEffect, useCallback } from 'react';
import { Snowflake, CopyX, AlertTriangle, Check, Undo2, FileWarning } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import TabBarAction from '../../components/common/TabBarAction';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { fetchClientesPorRevisar, descartarClientePorRevisar } from '../../data/customers';

// Los rótulos hablan del PORTAL, nunca del sistema de origen ni de la tubería:
// "congelado" y "repetido" son términos del negocio; "SALTADO (categoría
// Contribuyente)" es jerga del script que llenó la tabla y no sale a pantalla.
const MOTIVO = {
    fiscal_congelado: { label: 'Fiscal congelado', variant: 'info'    },
    nombre_repetido:  { label: 'Nombre repetido',  variant: 'warning' },
    dui_repetido:     { label: 'DUI repetido',     variant: 'warning' },
    nit_repetido:     { label: 'NIT repetido',     variant: 'warning' },
};

const COLS = [
    { key: 'nombre',  label: 'Cliente', align: 'left' },
    { key: 'motivo',  label: 'Motivo',  align: 'left' },
    { key: 'accion',  label: '',        align: 'right' },
];

export default function TabPorRevisar({ openModal }) {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('clientes', 'can_edit');

    const [familia,  setFamilia]  = useState('');
    const [datos,    setDatos]    = useState({ total: 0, congelado: 0, repetido: 0, rows: [] });
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState('');

    const cargar = useCallback(async () => {
        setLoading(true); setError('');
        try {
            setDatos(await fetchClientesPorRevisar({ familia, pageSize: 200 }));
        } catch (e) {
            setError(e?.message || 'No se pudo cargar la lista.');
        } finally {
            setLoading(false);
        }
    }, [familia]);

    useEffect(() => { cargar(); }, [cargar]);

    const descartar = useCallback(async (fila, deshacer = false) => {
        try {
            await descartarClientePorRevisar(fila.id, deshacer);
            useStaff.getState().appendAuditLog(
                deshacer ? 'CLIENTES_REVISAR_DESHACER' : 'CLIENTES_REVISAR_DESCARTAR',
                String(fila.id), { nombre: fila.name, motivo: fila.motivo });
            cargar();
        } catch (e) {
            setError(e?.message || 'No se pudo guardar la decisión.');
        }
    }, [cargar]);

    // Solo tiene sentido para las que SÍ tienen ficha en el portal. Las otras
    // no existen en `customers` — es exactamente por eso que están acá.
    const abrirFicha = useCallback((fila) => {
        if (!fila.customer_id) return;
        openModal?.('editCliente', {
            id: fila.customer_id,
            nombre: fila.nombre_portal || fila.name,
            canEdit,
            onSaved: cargar,
        });
        useStaff.getState().appendAuditLog('CLIENTES_VER_FICHA', String(fila.customer_id),
            { nombre: fila.name, desde: 'por-revisar' });
    }, [openModal, canEdit, cargar]);

    const pildora = (
        <FilterBar onClear={() => setFamilia('')} activeCount={familia ? 1 : 0}>
            <FilterBar.Chip
                active={familia === 'congelado'}
                onToggle={() => setFamilia(v => (v === 'congelado' ? '' : 'congelado'))}
                tone="brand"
            >
                Fiscales congelados {datos.congelado ? `(${datos.congelado})` : ''}
            </FilterBar.Chip>
            <FilterBar.Chip
                active={familia === 'repetido'}
                onToggle={() => setFamilia(v => (v === 'repetido' ? '' : 'repetido'))}
                tone="warning"
            >
                Posible repetido {datos.repetido ? `(${datos.repetido})` : ''}
            </FilterBar.Chip>
        </FilterBar>
    );

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col gap-3">
                <CarrilCards ariaLabel="Resumen de fichas por revisar">
                    <StatCard icon={FileWarning} label="Por revisar"
                        value={(datos.congelado + datos.repetido).toLocaleString()}
                        iconBg="bg-warning/10" iconCls="text-warning"
                        sub="Necesitan una decisión" loading={loading} />
                    <StatCard icon={Snowflake} label="Fiscales congelados"
                        value={datos.congelado.toLocaleString()}
                        sub="Se completan a mano" loading={loading} />
                    <StatCard icon={CopyX} label="Posible repetido"
                        value={datos.repetido.toLocaleString()}
                        sub="Nombre, DUI o NIT ya usado" loading={loading} />
                </CarrilCards>
                <div className="flex justify-end min-w-0">{pildora}</div>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <Notice variant="info">
                Estas fichas no se completaron solas a propósito. Las <strong>fiscales</strong>
                {' '}se congelan porque cada dato que se declara a Hacienda necesita una persona
                que lo confirme. Las de <strong>posible repetido</strong> no se crearon porque
                ya hay un cliente con ese nombre, DUI o NIT, y crearlas partiría al cliente en dos.
            </Notice>

            <DataTable columns={COLS} loading={loading} minWidth="320px"
                /* El contrato de `empty` es { icon, message, subtext } — NO
                   lleva `title`. Un `title` de más no rompe nada: simplemente
                   no se pinta, y el texto se pierde sin que nadie se entere. */
                empty={familia
                    ? { icon: Check, message: 'Sin pendientes en este grupo',
                        subtext: 'Prueba con el otro grupo o quita el filtro.' }
                    : { icon: Check, message: 'Sin fichas por revisar',
                        subtext: 'Todas las pendientes fueron resueltas o descartadas.' }}
            >
                {datos.rows.map((fila, i) => {
                    const m = MOTIVO[fila.motivo] || { label: fila.motivo, variant: 'neutral' };
                    return (
                        <DataRow key={fila.id} index={i}
                            onClick={fila.customer_id ? () => abrirFicha(fila) : undefined}>
                            <DataCell>
                                <div className="min-w-0">
                                    <div className="truncate text-content-1">{fila.name}</div>
                                    <div className="text-caption text-content-3 truncate">
                                        {fila.detalle}
                                    </div>
                                    {!fila.customer_id && (
                                        <div className="text-caption text-content-3">
                                            Sin ficha en el portal
                                        </div>
                                    )}
                                </div>
                            </DataCell>
                            <DataCell>
                                <Badge size="sm" variant={m.variant}>{m.label}</Badge>
                            </DataCell>
                            <DataCell align="right">
                                {canEdit && (
                                    <TabBarAction
                                        icon={fila.descartado_at ? Undo2 : Check}
                                        onClick={(e) => { e.stopPropagation(); descartar(fila); }}
                                    >
                                        Ya lo revisé
                                    </TabBarAction>
                                )}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}
