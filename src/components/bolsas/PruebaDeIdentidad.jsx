import React, { useMemo } from 'react';
import { ScanLine, ShieldCheck } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import PortalInput from '../common/PortalInput';
import SegmentedControl from '../common/SegmentedControl';
import { useStaffStore as useStaff } from '../../store/staffStore';

/**
 * «¿Quién se lleva el efectivo?» — el bloque que prueba la identidad.
 *
 * Vive aparte porque lo piden DOS momentos distintos del circuito y tienen que
 * pedirlo igual: la entrega de las bolsas a quien las recolecta, y las salidas
 * cuyo motivo exige receptor (pago a proveedor, gasto, envío a otra sala,
 * anticipo). La remesa NO lo pide — quien recibe es el cliente y lo identifica
 * la boleta del POS —, y eso no se decide acá sino en el catálogo
 * (`bolsas_tipos_salida.pide_receptor`).
 *
 * ── Elegir un nombre no es identificarse ───────────────────────────────────
 * Decisión del usuario: «debe escribir el usuario y la contraseña, así nos
 * aseguramos que sí sea él». Por eso hay dos campos y no uno: la lista dice a
 * QUIÉN se le va a atribuir el dinero, y el secreto es lo que lo prueba.
 *
 * La comprobación es del SERVIDOR (`probar_identidad`): el navegador diciendo
 * «ya verifiqué» no es una verificación. El secreto viaja sólo en esa llamada y
 * no se guarda en ninguna tabla ni queda en el estado más de lo que dura el
 * envío.
 */

// Sin exportar: los dos métodos son de este bloque. Exportarlos haría que el
// archivo publique un componente y una constante, y eso rompe el recargado en
// caliente (regla `react-refresh/only-export-components`).
const METODOS_DE_IDENTIDAD = [
    { value: 'CARNE', label: 'Carné' },
    { value: 'CLAVE', label: 'Usuario y contraseña' },
];

export default function PruebaDeIdentidad({
    titulo = 'Quién se lleva el efectivo',
    quien, onQuien, metodo, onMetodo, secreto, onSecreto,
    soloDeLaSala = null,
}) {
    const empleados = useStaff((st) => st.employees);

    // Quien recolecta el efectivo suele ser de administración y no de la sala,
    // así que por defecto la lista NO se recorta por sucursal. `soloDeLaSala`
    // existe para el caso contrario.
    const gente = useMemo(() => (empleados || [])
        .filter((e) => e.status === 'ACTIVO'
            && (soloDeLaSala == null || String(e.branch_id) === String(soloDeLaSala)))
        .map((e) => ({ value: e.id, label: e.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')), [empleados, soloDeLaSala]);

    return (
        <div data-surface="card" className="p-3 space-y-3">
            <div className="flex items-center gap-2">
                <ShieldCheck size={15} className="text-content-3 shrink-0" />
                <span className="text-label font-bold text-content">{titulo}</span>
            </div>
            <LiquidSelect
                value={quien} onChange={onQuien} options={gente}
                placeholder="Buscar a la persona…" ariaLabel={titulo}
            />
            <SegmentedControl
                value={metodo}
                // Cambiar de método olvida lo tecleado: un carné escrito en el
                // campo de contraseña se mandaría como contraseña.
                onChange={(v) => { onMetodo(v); onSecreto(''); }}
                options={METODOS_DE_IDENTIDAD}
            />
            <PortalInput
                label={metodo === 'CARNE' ? 'Escanear el carné' : 'Su contraseña'}
                name="secreto"
                type={metodo === 'CARNE' ? 'text' : 'password'}
                icon={metodo === 'CARNE' ? ScanLine : undefined}
                value={secreto} onChange={(e) => onSecreto(e.target.value)}
                placeholder={metodo === 'CARNE' ? 'Pasa el carné por el lector' : '••••••••'}
                autoComplete="off"
            />
            <p className="text-caption text-content-3">
                Se comprueba contra su cuenta. No se guarda en ninguna parte.
            </p>
        </div>
    );
}
