import React, { useMemo, useState } from 'react';
import { Printer, Laptop } from 'lucide-react';
import ModalShell from '../common/ModalShell';
import CuerpoDialogo from '../common/CuerpoDialogo';
import Button from '../common/Button';
import LiquidSelect from '../common/LiquidSelect';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';

const VACIO = [];

// El valor que representa «acá, en la computadora que tengo enfrente». No es
// una sucursal, así que no puede ser un id: sería el id de alguna sala.
export const ESTA_COMPUTADORA = 'aqui';

/**
 * «¿En qué sala lo imprimo?» — pedido del usuario el 2026-08-20.
 *
 * Antes el papel salía siempre por la ticketera de la sucursal de quien apretaba
 * el botón. Sirve cuando la persona está enfrente; no sirve cuando el carné se
 * emite desde administración para alguien que está en una sala, que es
 * justamente el caso de alguien que todavía no tiene carné.
 *
 * ── Sólo se ofrecen las salas que PUEDEN recibirlo ──────────────────────────
 * La lista sale de `salas_con_caja_de_impresion`, no de todas las sucursales.
 * Ofrecer una sala sin caja sería ofrecer un destino que va a rechazar el
 * documento — y el rechazo se vería recién después de emitir el carné, o sea
 * con el anterior ya muerto.
 *
 * Se dice además si la caja **está despierta**: una registrada pero apagada
 * acepta el documento y lo deja esperando. Es un estado legítimo (sale cuando
 * despierta) pero no es «sale en unos segundos», y quien elige tiene que poder
 * distinguirlos antes de mandar a alguien a buscar el papel.
 *
 * ── Las salas llegan de AFUERA, ya leídas ───────────────────────────────────
 * La lectura la hace quien abre este diálogo, en el manejador del clic, y no un
 * efecto de acá. Así la lista es de ESE momento —una caja se apaga en cualquier
 * momento— y el componente no tiene que sincronizar «estoy abierto» con «estoy
 * pidiendo»: dos estados que se desfasan en cuanto alguien abre y cierra rápido.
 */
export default function ElegirSalaDeImpresion({
    open, onClose, onElegir, salas = VACIO, cargando = false, fallo = false,
    titulo = 'Imprimir el carné del día',
}) {
    const branches = useStaff(s => s.branches) || VACIO;
    const { user } = useAuth();
    const miSala = user?.branchId ?? null;

    // La sala propia viene elegida SÓLO si puede recibir el papel. Un destino
    // puesto por defecto que además está mal es peor que ninguno: nadie relee lo
    // que ya venía puesto. `undefined` = todavía nadie tocó el selector.
    const propia = salas.some(x => String(x.branch_id) === String(miSala)) ? String(miSala) : null;
    const [tocada, setTocada] = useState(undefined);
    const elegida = tocada === undefined ? propia : tocada;

    const opciones = useMemo(() => {
        const nombre = (id) => branches.find(b => String(b.id) === String(id))?.name || `Sucursal ${id}`;
        const deSalas = salas
            .map(s => ({
                value: String(s.branch_id),
                label: s.latiendo ? nombre(s.branch_id) : `${nombre(s.branch_id)} — la caja no responde`,
                orden: nombre(s.branch_id),
            }))
            .sort((a, b) => a.orden.localeCompare(b.orden));
        return [
            ...deSalas,
            // Siempre disponible y siempre al final: es la salida cuando la sala
            // que hace falta no tiene caja, y no debería ser lo primero que se
            // elige por estar arriba.
            { value: ESTA_COMPUTADORA, label: 'Esta computadora' },
        ];
    }, [salas, branches]);

    const confirmar = () => {
        if (!elegida) return;
        setTocada(undefined);
        onElegir(elegida === ESTA_COMPUTADORA
            ? { salaId: null, nombreSala: '' }
            : {
                salaId: Number(elegida),
                nombreSala: branches.find(b => String(b.id) === elegida)?.name || '',
            });
    };

    return (
        <ModalShell open={open} onClose={onClose} surface={null} maxWidthClass="max-w-sm" ariaLabel={titulo}>
            <CuerpoDialogo
                titulo={titulo}
                subtitulo="El papel sale en la ticketera de la sala que elijas."
                icono={Printer}
                pie={<>
                    <Button onClick={confirmar} disabled={!elegida || cargando} icon={Printer}>Imprimir</Button>
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                </>}
            >
                <LiquidSelect
                    value={elegida ?? ''}
                    onChange={setTocada}
                    options={opciones}
                    placeholder={cargando ? 'Buscando las cajas…' : 'Elige dónde sale el papel'}
                    icon={Laptop}
                />
                {/* Un fallo de lectura NO se pinta como «ninguna sala imprime»:
                    con seis cajas latiendo, ese texto manda a reinstalar agentes
                    sanos. Es la misma lección de `fetchCajasDeImpresion`. */}
                {!cargando && fallo && (
                    <p className="text-caption font-bold text-danger-text mt-3">
                        No se pudo leer qué salas pueden imprimir. Puedes mandarlo a esta computadora.
                    </p>
                )}
                {!cargando && !fallo && salas.length === 0 && (
                    <p className="text-caption font-bold text-content-3 mt-3">
                        Ninguna sala tiene una caja registrada todavía.
                    </p>
                )}
            </CuerpoDialogo>
        </ModalShell>
    );
}
