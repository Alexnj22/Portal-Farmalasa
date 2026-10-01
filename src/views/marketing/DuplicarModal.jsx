import React, { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import SegmentedControl from '../../components/common/SegmentedControl';
import PeriodStepper from '../../components/common/PeriodStepper';
import Checkbox from '../../components/common/Checkbox';
import PieDeModal from '../../components/common/PieDeModal';
import Campo from '../promociones/Campo';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { correrMes, etiquetaMes, fechaTexto } from '@nucleo/utils/fecha';
import { formatoDe } from '@nucleo/utils/marketing';
import { duplicarPiezas } from '@nucleo/data/marketing';

const MODOS = [
    { value: 'semana', label: 'Mismo día de la semana' },
    { value: 'dia', label: 'Mismo número de día' },
];

/**
 * Copiar piezas a otro mes: el mes completo (lo de cada semana que se repite)
 * o una sola. Las copias nacen pendientes, sin diseños ni pauta: lo que se
 * reutiliza es la planificación, no el trabajo.
 */
export default function DuplicarModal({ mes, piezas, preseleccion = null, onClose, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [destino, setDestino] = useState(() => correrMes(mes, preseleccion ? 0 : 1));
    const [modo, setModo] = useState('semana');
    const [elegidas, setElegidas] = useState(() => new Set(preseleccion ? [preseleccion.id] : piezas.map((p) => p.id)));
    const [copiando, setCopiando] = useState(false);
    const ordenadas = useMemo(() => [...piezas].sort((a, b) => String(a.fecha).localeCompare(b.fecha)), [piezas]);
    const todas = elegidas.size === piezas.length;

    const alternar = (id, on) => setElegidas((s) => {
        const n = new Set(s);
        if (on) n.add(id); else n.delete(id);
        return n;
    });

    const copiar = async () => {
        setCopiando(true);
        try {
            const r = await duplicarPiezas([...elegidas], destino, modo);
            showToast(`${r?.copiadas ?? elegidas.size} pieza(s) copiadas`, `a ${etiquetaMes(destino)}`, 'success');
            onListo?.(destino);
        } catch (err) {
            showToast('No se pudo duplicar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setCopiando(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Duplicar piezas">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">
                    {preseleccion ? `Duplicar «${preseleccion.titulo}»` : `Duplicar piezas de ${etiquetaMes(mes)}`}
                </h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <Campo rotulo="A qué mes">
                        <PeriodStepper unit="mes" label={etiquetaMes(destino)}
                            onPrev={() => setDestino((d) => correrMes(d, -1))} onNext={() => setDestino((d) => correrMes(d, 1))} />
                    </Campo>
                    <Campo rotulo="En qué día">
                        <SegmentedControl value={modo} onChange={setModo} options={MODOS} label="En qué día" />
                    </Campo>
                    <p className="text-caption text-content-3">
                        {modo === 'semana'
                            ? 'El primer lunes cae en el primer lunes, el segundo viernes en el segundo viernes…'
                            : 'El 10 cae en el 10; si el mes no tiene ese día, en el último.'}
                        {' '}Las copias quedan pendientes, sin diseños ni pauta.
                    </p>
                    {!preseleccion && (
                        <div className="space-y-1">
                            <Checkbox label={`Todas (${piezas.length})`} checked={todas}
                                indeterminate={!todas && elegidas.size > 0}
                                onChange={(on) => setElegidas(new Set(on ? piezas.map((p) => p.id) : []))} />
                            <ul className="max-h-64 overflow-y-auto space-y-1 pl-1">
                                {ordenadas.map((p) => (
                                    <li key={p.id}>
                                        <Checkbox checked={elegidas.has(p.id)} onChange={(on) => alternar(p.id, on)}
                                            label={`${fechaTexto(p.fecha, { weekday: 'short', day: 'numeric' })} · ${formatoDe(p.formato).label} · ${p.titulo}`} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </LiquidModal.Body>
            <PieDeModal>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Copy} loading={copiando} disabled={!elegidas.size} onClick={copiar}>
                    Copiar {elegidas.size} a {etiquetaMes(destino)}
                </Button>
            </PieDeModal>
        </LiquidModal>
    );
}
