import React, { useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';

/**
 * «¿Cierras el día ahora?» — la pregunta que sigue al ÚLTIMO corte.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * Confirmar el último corte y cerrar el día son dos actos y estaban en dos
 * momentos, así que el segundo se olvidaba. Pasó en Salud 4 el 5-sep: el corte
 * quedó confirmado a las 21:00 —su hora de cierre— y el día siguió abierto
 * hasta las 22:37, que es cuando alguien lo notó desde afuera y lo cerró.
 *
 * El aviso de la noche no alcanza: llega cuando la sala ya se fue. La única
 * ocasión en que la persona que puede cerrar está mirando la pantalla es el
 * instante en que acaba de firmar el conteo.
 *
 * ── Cuándo se pregunta ────────────────────────────────────────────────────
 * En la MISMA ventana en que el corte deja de pedir entrega de caja: dentro de
 * los 15 minutos previos al cierre de esa sala, que es cuando `sala_ya_cerro`
 * contesta que sí. No es una segunda regla — es la misma, y por eso la decide
 * el servidor y no esta pantalla. Si hubiera dos, un día una diría «éste es el
 * último» y la otra no.
 *
 * ── No cierra solo, y no es una formalidad ────────────────────────────────
 * El cierre **no se deshace**: esa caja no se vuelve a abrir. Así que se
 * pregunta y se dice qué queda del otro lado del botón. «Ahora no» es una
 * salida de verdad — el día se puede cerrar después desde Mi caja.
 *
 * Un fallo NO cierra el diálogo: el motivo se muestra acá y se puede volver a
 * intentar. Cerrarlo obligaría a buscar la pantalla de la caja para reintentar
 * algo que ya se había decidido.
 */
export default function CerrarElDiaAhora({ sala = '', hora = '', ocupado = false, error = null,
    onCerrar, onDespues }) {
    const [pedido, setPedido] = useState(false);

    return (
        <LiquidModal open onClose={ocupado ? undefined : onDespues} maxWidth="max-w-md"
            className="h-fit" ariaLabel="Cerrar el día">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">¿Cierras el día ahora?</h3>
                    <p className="text-caption text-content-3 truncate">
                        {[sala, hora && `corte de las ${hora} confirmado`].filter(Boolean).join(' · ')}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-3">
                <Notice variant="info" icon={Lock}>
                    Es la hora de cierre de esta sala y el conteo ya quedó firmado. Cerrar el
                    día emite el cierre y termina la jornada de esta caja.
                </Notice>
                <Notice variant="danger" icon={AlertTriangle}>
                    <span className="font-bold">No se puede deshacer.</span>
                    <span className="block mt-0.5 font-normal">
                        La caja de este día no se vuelve a abrir: lo que quede sin anotar ya no se
                        podrá anotar, y las bolsas de hoy pasan a ser de un día cerrado.
                    </span>
                </Notice>
                {/* El motivo del rechazo se dice acá y no en un aviso que se va
                    solo: es lo que hay que leer para saber si reintentar o ir a
                    arreglar otra cosa. */}
                {error && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        <span className="font-bold">El día no se cerró.</span>
                        <span className="block mt-0.5 font-normal">{error}</span>
                    </Notice>
                )}
                <Button variant="primary" size="md" icon={Lock} className="w-full"
                    loading={ocupado} disabled={ocupado}
                    onClick={() => { setPedido(true); onCerrar?.(); }}>
                    {pedido && error ? 'Volver a intentar' : 'Cerrar el día'}
                </Button>
                <Button variant="ghost" size="sm" className="w-full"
                    disabled={ocupado} onClick={onDespues}>
                    Ahora no
                </Button>
            </LiquidModal.Body>
        </LiquidModal>
    );
}
