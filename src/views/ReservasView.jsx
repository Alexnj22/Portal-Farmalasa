import React, { useState } from 'react';
import { PackageCheck, PackageSearch, Plus, ShoppingBag, Wallet } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import WidgetReservas from './dashboard/WidgetReservas';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import CarrilCards from '../components/common/CarrilCards';
import StatCard from '../components/common/StatCard';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';

// ═══════════════════════════════════════════════════════════════════════════
// Reservas — la pantalla del menú, en Comercial (2026-10-21).
//
// Pedido del dueño: «las reservas que estén en Comercial, como pantalla
// principal». Hasta ese día vivían en dos sitios: el widget del Inicio (la sala
// propia) y una pestaña de Ofertas para clientes (todas las salas), que es la
// vitrina de la app y no el lugar donde se trabaja una venta por terminar.
//
// El contenido es el MISMO componente del widget, sin la baldosa: apartar,
// entregar, recetas por revisar, saldos a favor y encargos están escritos una
// sola vez. Dos copias de esa lógica terminarían diciendo cosas distintas de la
// misma reserva.
//
// ── El alcance decide qué salas ────────────────────────────────────────────
// Con alcance «todas» se ven las de toda la red; con «su sala» (o sin alcance
// declarado), sólo la propia. Sin pestañas a propósito: abiertas, saldos a
// favor y encargos son una sola lista de trabajo y el buscador por código
// cruza las tres —partirlas obligaría a saber de antemano en cuál está el
// código que el cliente muestra en el teléfono—.
//
// ── Ver y editar ───────────────────────────────────────────────────────────
// `reservas.can_view` deja mirar; `can_edit` deja apartar, entregar, cancelar y
// aplicar un saldo a favor. Sin editar, la lista sale sin esos botones. La
// receta de la app tiene su propio permiso (`recetas_app`) y no cambia acá.
// ═══════════════════════════════════════════════════════════════════════════
// Las métricas del carril (§17.0): lo que hay que hacer, lo que espera al cliente y lo que se le debe.
const METRICAS = [
    { clave: 'preparar', label: 'Por preparar', icon: PackageSearch, iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
    { clave: 'listas', label: 'Listas para retirar', icon: PackageCheck, iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
    { clave: 'saldos', label: 'Saldos a favor', icon: Wallet, iconBg: 'bg-brand/10', iconCls: 'text-brand-text', valueCls: 'text-content' },
];

export default function ReservasView() {
    const { user, hasPermission, getScope } = useAuth();
    const todas = getScope('reservas') === 'ALL';
    const puedeEditar = hasPermission('reservas', 'can_edit');
    const miSala = user?.branchId ?? user?.branch_id ?? null;
    const branches = useStaff((st) => st.branches);
    const salas = (branches || []).filter((b) => b.type === 'FARMACIA')
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true }));
    // Con alcance «todas», la sucursal es un filtro de la píldora (§17) y vive
    // en la dirección: F5 o un enlace compartido vuelven a la misma.
    const opciones = [{ value: 'todas', label: 'Sucursales' }, ...salas.map((b) => ({ value: String(b.id), label: b.name }))];
    const [sala, setSala] = usePestanaEnUrl(opciones, 'todas', 'sala');
    const fija = todas && sala !== 'todas' ? Number(sala) : undefined;
    const [codigo, setCodigo] = useState('');
    const [nueva, setNueva] = useState(false);
    const [conteo, setConteo] = useState(null);
    // Se aparta en la caja de la sala propia: con otra sucursal elegida, no.
    const salaVista = fija ?? (todas ? null : miSala);
    const puedeApartar = puedeEditar && miSala != null && (salaVista == null ? !todas : String(salaVista) === String(miSala));

    return (
        <GlassViewLayout icon={ShoppingBag} title="Reservas" transparentBody
            filtersContent={(
                <ViewTabBar tabs={[]} searchValue={codigo} onSearchChange={setCodigo}
                    placeholder="Escanea o escribe el código (R-… o P-…)" />
            )}>
            <div className="p-4 md:p-6 space-y-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen de reservas">
                        {METRICAS.map((m) => (
                            <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                label={m.label} value={conteo?.[m.clave] ?? 0} valueCls={m.valueCls} loading={!conteo} />
                        ))}
                    </CarrilCards>
                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={() => setSala('todas')} activeCount={fija != null ? 1 : 0}
                            acciones={puedeApartar ? [{ key: 'nueva', icon: Plus, label: 'Reservar con anticipo', variant: 'primary', onClick: () => setNueva(true) }] : []}>
                            {todas && salas.length > 0 && (
                                <FilterBar.Section active={fija != null} onClear={() => setSala('todas')} label="sucursal">
                                    <FilterBar.Sucursal value={sala} onChange={(v) => setSala(v || 'todas')} options={opciones} />
                                </FilterBar.Section>
                            )}
                        </FilterBar>
                    </div>
                </div>
                <WidgetReservas key={sala} todas={todas && fija == null} sala={fija} completa soloLectura={!puedeEditar}
                    codigo={codigo} nueva={nueva} onNuevaCerrada={() => setNueva(false)} onConteo={setConteo} />
            </div>
        </GlassViewLayout>
    );
}
