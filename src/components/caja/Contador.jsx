import React from 'react';
import { Minus, Plus } from 'lucide-react';
import Button from '../common/Button';

/** − n + con blanco de dedo; `max` 0 lo apaga entero. Lo usan el cobro y el canje de aplicaciones. */
export default function Contador({ valor, min = 0, max, onChange, etiqueta }) {
    return (
        <div className="flex items-center gap-1.5" role="group" aria-label={etiqueta}>
            <Button variant="secondary" size="sm" iconOnly icon={Minus} title={`Una menos · ${etiqueta}`}
                disabled={valor <= min} onClick={() => onChange(Math.max(min, valor - 1))} />
            <span className="w-7 text-center text-body font-black tabular-nums text-content">{valor}</span>
            <Button variant="secondary" size="sm" iconOnly icon={Plus} title={`Una más · ${etiqueta}`}
                disabled={valor >= max} onClick={() => onChange(Math.min(max, valor + 1))} />
        </div>
    );
}
