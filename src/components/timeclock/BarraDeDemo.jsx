import React from 'react';
import { ScanBarcode } from 'lucide-react';
import Button from '../common/Button';
import { EVENTO_CARNE_DEMO } from './demoDelKiosco';

// Sólo en `?demo`: hace de carné en un equipo sin lector.
export default function BarraDeDemo() {
    return (
        <div data-surface="dropdown" className="fixed bottom-3 right-3 z-modal px-2 py-1.5">
            <Button size="sm" variant="secondary" icon={ScanBarcode}
                onClick={() => window.dispatchEvent(new CustomEvent(EVENTO_CARNE_DEMO))}>Simular carné</Button>
        </div>
    );
}
