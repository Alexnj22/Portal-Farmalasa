import React, { useEffect, useState } from 'react';
import ConfirmModal from './ConfirmModal';

// ── «¿Sigues ahí?» — el aviso que existe para no perder trabajo ──────────────
//
// La sesión de una dependiente se cierra a los 5 minutos sin usarse, y hasta
// ahora se cerraba SIN AVISAR. El caso que lo motivó lo describió el usuario:
// alguien llenando la bitácora de antibióticos se va a sacar copia, vuelve, y
// encuentra la pantalla de entrada con todo lo escrito perdido — porque el
// formulario vive en memoria, no en disco.
//
// Es la mitad barata del arreglo. La otra es el borrador: éste evita la
// sorpresa, el borrador evita la pérdida cuando igual se cerró (nadie vuelve
// a tiempo si se fue diez minutos).
//
// **Un solo botón, a propósito.** «Cerrar sesión» acá sería una opción
// simétrica a «sigo aquí» y no lo es: colgada de `onClose`, Escape y el clic
// afuera ejecutarían la peligrosa. Quien quiera salir tiene el botón de
// siempre. Así, cualquier forma de descartar este diálogo significa lo mismo
// —hay alguien— que es justo lo que se está preguntando.
const AvisoDeInactividad = ({ hasta, onSeguir }) => {
    const [restante, setRestante] = useState(0);

    useEffect(() => {
        if (!hasta) return undefined;
        const calcular = () => setRestante(Math.max(0, Math.ceil((hasta - Date.now()) / 1000)));
        calcular();   // sin esto el primer segundo muestra el valor viejo
        const t = setInterval(calcular, 1000);
        return () => clearInterval(t);
    }, [hasta]);

    if (!hasta) return null;

    return (
        <ConfirmModal
            isOpen
            // Escape y el clic afuera son actividad: si hay alguien apretando
            // teclas, la respuesta a «¿sigues ahí?» ya está dada.
            onClose={onSeguir}
            onConfirm={onSeguir}
            title="¿Sigues ahí?"
            message={
                <>
                    Vamos a cerrar tu sesión en{' '}
                    <strong className="text-content">
                        {restante} segundo{restante === 1 ? '' : 's'}
                    </strong>{' '}
                    porque nadie ha usado esta pantalla.
                    <br />
                    Lo que no hayas guardado se va a perder.
                </>
            }
            confirmText="Sigo aquí"
            isDestructive={false}
            hideCancel
        />
    );
};

export default AvisoDeInactividad;
