import React, { useCallback, useState } from 'react';
import { Printer } from 'lucide-react';
import Button from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { entregarCarneDePapel } from '../../utils/entregarCarneDePapel';

/**
 * Imprime un carné de papel del día para esa persona.
 *
 * El trabajo lo hace `entregarCarneDePapel` — acá sólo viven el botón y su
 * estado de ocupado. Es a propósito: el alta de personal hace lo MISMO sin
 * ningún botón (lo imprime sola al guardar), y esa pieza no puede ser una copia.
 */
export default function BotonCarneDePapel({
    employeeId, nombre, cargo = '', sala = '', motivo = null, alImprimir,
    children = 'Imprimir carné del día', ...rest
}) {
    const { user } = useAuth();
    const [ocupado, setOcupado] = useState(false);

    const imprimir = useCallback(async () => {
        if (!employeeId || ocupado) return;
        setOcupado(true);
        try {
            const r = await entregarCarneDePapel({
                employeeId, nombre, cargo, sala, motivo,
                salaId: user?.branchId ?? null,
                emitidoPor: user?.name || '',
            });
            // Se avisa aunque el papel no haya salido: el carné YA quedó
            // emitido y el anterior YA murió, así que la pantalla que lista los
            // vigentes está desactualizada en los dos casos.
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
    }, [employeeId, ocupado, motivo, nombre, cargo, sala, user, alImprimir]);

    return (
        <Button tone="chart-8" icon={Printer} loading={ocupado} onClick={imprimir} {...rest}>
            {children}
        </Button>
    );
}
