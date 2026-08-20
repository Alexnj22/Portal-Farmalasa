import React, { useCallback, useState } from 'react';
import { Printer } from 'lucide-react';
import Button from '../common/Button';
import ElegirSalaDeImpresion from './ElegirSalaDeImpresion';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { entregarCarneDePapel } from '../../utils/entregarCarneDePapel';
import { fetchSalasConCaja } from '../../data/impresion';

/**
 * Imprime un carné de papel del día para esa persona, **preguntando en qué sala
 * sale**.
 *
 * Lo pidió el usuario el 2026-08-20: «que me pregunte a qué sucursal mandarlo,
 * así se imprime en esa ticketera». Antes salía siempre por la ticketera de la
 * sucursal de quien apretaba el botón — sirve cuando la persona está enfrente, y
 * no sirve justamente en el caso que motivó todo esto: administración emitiendo
 * un carné para alguien que está en una sala.
 *
 * **La lista de salas se lee en el CLIC**, no al montar: una caja se apaga en
 * cualquier momento, y ofrecer una que dejó de latir hace media hora es mandar
 * a alguien a buscar un papel que no salió.
 *
 * El trabajo de emitir e imprimir lo hace `entregarCarneDePapel` — acá viven el
 * botón, su estado y la pregunta. Es a propósito: el alta de personal hace lo
 * MISMO sin ningún botón (lo imprime sola al guardar), y esa pieza no puede ser
 * una copia.
 */
export default function BotonCarneDePapel({
    employeeId, nombre, cargo = '', sala = '', motivo = null, alImprimir,
    children = 'Imprimir carné del día', ...rest
}) {
    const { user } = useAuth();
    const [ocupado, setOcupado] = useState(false);
    const [preguntando, setPreguntando] = useState(false);
    const [salas, setSalas] = useState([]);
    const [cargandoSalas, setCargandoSalas] = useState(false);
    const [falloSalas, setFalloSalas] = useState(false);

    const preguntar = useCallback(async () => {
        if (!employeeId || ocupado) return;
        setPreguntando(true);
        setCargandoSalas(true);
        try {
            const { salas: s, error } = await fetchSalasConCaja();
            setSalas(s);
            setFalloSalas(!!error);
        } catch {
            // Que no se pueda leer la lista NO deja el diálogo mudo: se abre
            // igual, marcado como que falló, con «Esta computadora» todavía
            // disponible. Un selector vacío sin explicación se lee como
            // «ninguna sala imprime», que es un estado legítimo y distinto.
            setSalas([]);
            setFalloSalas(true);
        } finally {
            setCargandoSalas(false);
        }
    }, [employeeId, ocupado]);

    const imprimir = useCallback(async ({ salaId, nombreSala }) => {
        setPreguntando(false);
        setOcupado(true);
        try {
            const r = await entregarCarneDePapel({
                employeeId, nombre, cargo, motivo,
                // El nombre que va IMPRESO en el papel es el de la sucursal de
                // esa persona; el destino es otra cosa y puede ser otra sala.
                sala: nombreSala || sala,
                salaId,
                // Sin sala elegida (esta computadora) la cascada vuelve a ser la
                // de siempre. Con sala elegida, un rechazo se reporta en vez de
                // imprimirse acá — quien lo espera está en la otra punta.
                salaElegida: salaId != null,
                emitidoPor: user?.name || '',
            });
            alImprimir?.(r);
        } catch (err) {
            // `entregarCarneDePapel` avisa de sus propios fallos; lo que llega
            // acá es lo que ni siquiera pudo intentarlo. Sin este aviso el botón
            // dejaría de girar y no habría pasado nada, que es indistinguible de
            // un papel que salió en otra sala.
            useToastStore.getState().showToast(
                'No se pudo imprimir el carné',
                mensajeAmigable(err, 'Intenta de nuevo.'),
                'error',
            );
        } finally {
            setOcupado(false);
        }
    }, [employeeId, nombre, cargo, sala, motivo, user, alImprimir]);

    return (
        <>
            <Button tone="chart-8" icon={Printer} loading={ocupado} onClick={preguntar} {...rest}>
                {children}
            </Button>

            <ElegirSalaDeImpresion
                open={preguntando}
                onClose={() => setPreguntando(false)}
                onElegir={imprimir}
                salas={salas}
                cargando={cargandoSalas}
                fallo={falloSalas}
                titulo={nombre ? `Carné del día — ${nombre}` : 'Carné del día'}
            />
        </>
    );
}
