import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Clipboard } from 'lucide-react';
import Button from './Button';

// Clic derecho sobre el recuadro de una foto: pegar lo copiado. Lo comparten la
// ficha del producto y la foto del laboratorio.

export default function MenuPegarFoto({ pos, onPaste, onClose }) {
    useEffect(() => {
        const close = () => onClose();
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [onClose]);

    return createPortal(
        <div
            className="fixed z-confirm bg-surface-card rounded-xl shadow-xl border border-divider py-1 min-w-[170px] overflow-hidden"
            style={{ top: pos.y, left: pos.x }}
            onMouseDown={e => e.stopPropagation()}>
            <Button variant="secondary" icon={Clipboard} onClick={onPaste}>Pegar imagen
                <span className="ml-auto text-caption text-content-3">Ctrl+V</span></Button>
        </div>,
        document.body
    );
}
