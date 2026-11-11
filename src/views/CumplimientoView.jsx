import React, { useMemo, useState, lazy, Suspense } from 'react';
import {
    AlertOctagon, BadgeCheck, CalendarClock, ClipboardCheck, GraduationCap, LayoutGrid, PackageX, ShieldCheck, Undo2,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import { SkeletonText } from '../components/common/StateViews';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import TabResumen from './cumplimiento/TabResumen';

const TabRegistros = lazy(() => import('./cumplimiento/TabRegistros'));
const TabVencimientos = lazy(() => import('./cumplimiento/TabVencimientos'));
const TabDependientes = lazy(() => import('./cumplimiento/TabDependientes'));

// ═══════════════════════════════════════════════════════════════════════════
// Cumplimiento sanitario (2026-11-11, auditoría de sucursales).
//
// Lo que la norma pide llevar en cada sala y el portal no llevaba: las
// sospechas de reacción adversa y el reporte cero, las bajas y las actas de
// destrucción, los retiros de lote, la autoinspección anual y la revisión de
// lo que debe estar a la vista, las capacitaciones, quién atiende sin
// acreditación y el calendario de vencimientos del expediente. Las
// bitácoras diarias y la regencia siguen en Bitácoras.
//
// Quien ve una sola sala (el regente y el referente trabajan con la que
// eligen en el menú) no elige sala aquí: la base ya se lo resolvió.
// ═══════════════════════════════════════════════════════════════════════════

const VACIO = [];

const REGISTROS = {
    farmacovigilancia: {
        tipos: [{ tipo: 'farmacovigilancia', boton: 'Sospecha de reacción adversa', principal: true }, { tipo: 'reporte_cero', boton: 'Reporte cero del semestre' }],
        aviso: 'Toda sospecha se notifica al Centro Nacional de Farmacovigilancia: 30 días si no es grave, 15 si es grave y 72 horas si fue mortal o puso en riesgo la vida. Si en el semestre no hubo ninguna, se envía el reporte cero.',
        vacio: { titulo: 'Sin sospechas anotadas', subtitulo: 'Si un cliente cuenta una reacción a un medicamento, se anota aquí el mismo día.' },
    },
    vencidos: {
        tipos: [{ tipo: 'vencido', boton: 'Dar de baja un producto', principal: true }, { tipo: 'destruccion', boton: 'Acta de destrucción' }],
        aviso: 'Lo vencido o dañado sale del área de venta, se separa en el área rotulada de no aptos y se anota. Para destruirlo se avisa a la SRS 72 horas antes y lo retira una gestora autorizada por el MARN, que entrega su certificado.',
        vacio: { titulo: 'Sin bajas anotadas' },
    },
    retiros: {
        tipos: [{ tipo: 'retiro', boton: 'Anotar retiro en esta sala', principal: true }],
        aviso: 'Cuando la SRS o un laboratorio ordena retirar un lote, cada sala dice cuántas unidades tenía, las separa y anota a quién las devolvió.',
        vacio: { titulo: 'Sin retiros de lote' },
    },
    autoinspeccion: {
        tipos: [{ tipo: 'autoinspeccion', boton: 'Hacer autoinspección', principal: true }, { tipo: 'a_la_vista', boton: 'Revisar lo que debe estar a la vista' }],
        aviso: 'Una autoinspección al año con la guía de la SRS, con su informe y su plan de acción. Un punto crítico sin cumplir basta para no aprobar.',
        vacio: { titulo: 'Sin autoinspecciones', subtitulo: 'La norma pide una al año en cada sala.' },
    },
    capacitacion: {
        tipos: [{ tipo: 'capacitacion', boton: 'Anotar capacitación', principal: true }],
        aviso: 'El personal recibe capacitación según un programa anual; cada una se registra con su tema, quién la dio, quiénes asistieron y cómo se evaluó.',
        vacio: { titulo: 'Sin capacitaciones anotadas' },
    },
};

export default function CumplimientoView() {
    const { user, hasPermission, getScope } = useAuth();
    const branches = useStaff((s) => s.branches) || VACIO;
    const alcanceTodas = getScope('cumplimiento') === 'ALL';
    const miSala = salaDelUsuario(user);
    const [sala, setSala] = useState(() => (alcanceTodas ? '' : String(miSala ?? '')));

    const ver = (k) => hasPermission(`cumplimiento_tab_${k}`, 'can_view');
    const editar = (k) => hasPermission('cumplimiento', 'can_edit') && hasPermission(`cumplimiento_tab_${k}`, 'can_edit');

    const tabs = useMemo(() => ([
        ver('resumen') && { key: 'resumen', label: 'Resumen', icon: LayoutGrid },
        ver('vencimientos') && { key: 'vencimientos', label: 'Vencimientos', icon: CalendarClock },
        ver('farmacovigilancia') && { key: 'farmacovigilancia', label: 'Farmacovigilancia', icon: AlertOctagon },
        ver('vencidos') && { key: 'vencidos', label: 'Bajas y destrucción', icon: PackageX },
        ver('retiros') && { key: 'retiros', label: 'Retiros de lote', icon: Undo2 },
        ver('autoinspeccion') && { key: 'autoinspeccion', label: 'Autoinspección', icon: ClipboardCheck },
        ver('capacitacion') && { key: 'capacitacion', label: 'Capacitación', icon: GraduationCap },
        ver('dependientes') && { key: 'dependientes', label: 'Acreditaciones', icon: BadgeCheck },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ver` sale de hasPermission
    ].filter(Boolean)), [hasPermission]);
    const pestanas = useMemo(() => new Set(tabs.map((t) => t.key)), [tabs]);

    const [tab, setTab] = usePestanaEnUrl(tabs, tabs[0]?.key || 'resumen');
    const salaOptions = useMemo(() => salasDeBitacora(branches), [branches]);
    const nombreSala = salaOptions.find((o) => o.value === String(sala))?.label || '';
    const salaOVacio = sala || null;

    const filtersContent = <ViewTabBar tabs={tabs} activeTab={tab} onTabChange={setTab} showSearch={false} />;
    const def = REGISTROS[tab];

    return (
        <GlassViewLayout icon={ShieldCheck} title="Cumplimiento sanitario" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">
                {alcanceTodas && tab !== 'resumen' && (
                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={() => setSala('')} activeCount={sala ? 1 : 0}>
                            <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                                <FilterBar.Sucursal value={String(sala || '')} onChange={(v) => setSala(v || '')} options={salaOptions} />
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                )}

                <Suspense fallback={<SkeletonText lines={4} className="w-full" />}>
                    {tab === 'resumen' ? (
                        <TabResumen pestanas={pestanas} onIr={(t, b) => { if (alcanceTodas) setSala(String(b)); setTab(t); }} />
                    ) : tab === 'vencimientos' ? (
                        <TabVencimientos branches={branches} branchId={salaOVacio} />
                    ) : tab === 'dependientes' ? (
                        <TabDependientes branchId={salaOVacio} />
                    ) : def ? (
                        <TabRegistros key={tab} tipos={def.tipos} aviso={def.aviso} vacio={def.vacio}
                            branchId={salaOVacio} sala={nombreSala} puedeEditar={editar(tab)}
                            retiroATodas={tab === 'retiros' && alcanceTodas && editar('retiros')} />
                    ) : null}
                </Suspense>
            </div>
        </GlassViewLayout>
    );
}
