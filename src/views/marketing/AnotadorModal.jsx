import React, { useMemo, useRef, useState } from 'react';
import { MapPin, Square, PenLine, Send, RotateCcw } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalTextarea from '../../components/common/PortalTextarea';
import PieDeModal from '../../components/common/PieDeModal';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { comentar } from '@nucleo/data/marketing';
import Marcas from './Marcas';
import { Quien } from './Historial';

const HERRAMIENTAS = [
    { value: 'punto', label: 'Punto', icon: MapPin },
    { value: 'recuadro', label: 'Recuadro', icon: Square },
    { value: 'trazo', label: 'Lápiz', icon: PenLine },
];

const acotar = (v) => Math.max(0, Math.min(1, v));

/**
 * Comentar SOBRE el diseño: se marca un punto, se encierra una zona o se
 * dibuja a lápiz, y el texto queda atado a esa marca. Las marcas que ya
 * existen se ven numeradas, con su comentario al lado.
 *
 * Las coordenadas se guardan relativas (0–1) a la imagen: caen en el mismo
 * sitio en el teléfono y en el monitor.
 */
export default function AnotadorModal({ archivo, src, mesId, piezaId, comentarios, personas, yoId, onClose, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [herramienta, setHerramienta] = useState('punto');
    const [borrador, setBorrador] = useState(null);
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [proporcion, setProporcion] = useState(archivo?.ancho && archivo?.alto ? archivo.alto / archivo.ancho : 1);
    const [resaltada, setResaltada] = useState(null);
    const lienzo = useRef(null);
    const arrastre = useRef(null);

    // Los comentarios de ESTE diseño con marca, numerados en orden.
    const marcados = useMemo(() => (comentarios || [])
        .filter((c) => c.archivo_id === archivo.id && c.marca)
        .map((c, i) => ({ ...c, numero: i + 1 })), [comentarios, archivo.id]);

    const posicion = (e) => {
        const r = lienzo.current.getBoundingClientRect();
        return [acotar((e.clientX - r.left) / r.width), acotar((e.clientY - r.top) / r.height)];
    };

    const bajar = (e) => {
        e.preventDefault();
        lienzo.current.setPointerCapture?.(e.pointerId);
        const [x, y] = posicion(e);
        if (herramienta === 'punto') {
            setBorrador({ tipo: 'punto', x, y });
            return;
        }
        arrastre.current = { x, y };
        setBorrador(herramienta === 'recuadro'
            ? { tipo: 'recuadro', x, y, w: 0, h: 0 }
            : { tipo: 'trazo', puntos: [[x, y]] });
    };

    const mover = (e) => {
        if (!arrastre.current) return;
        const [x, y] = posicion(e);
        const o = arrastre.current;
        if (herramienta === 'recuadro') {
            setBorrador({ tipo: 'recuadro', x: Math.min(o.x, x), y: Math.min(o.y, y), w: Math.abs(x - o.x), h: Math.abs(y - o.y) });
        } else {
            setBorrador((b) => (b?.tipo === 'trazo' ? { ...b, puntos: [...b.puntos, [x, y]] } : b));
        }
    };

    const soltar = () => {
        arrastre.current = null;
        // Un recuadro sin área o un trazo de un solo punto fue un toque sin
        // querer: no se guarda como marca.
        setBorrador((b) => {
            if (b?.tipo === 'recuadro' && (b.w < 0.01 || b.h < 0.01)) return null;
            if (b?.tipo === 'trazo' && b.puntos.length < 3) return null;
            if (b?.tipo === 'trazo') {
                // Menos puntos para guardar: uno de cada tres alcanza para el dibujo.
                return { ...b, puntos: b.puntos.filter((_, i) => i % 3 === 0 || i === b.puntos.length - 1)
                    .map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]) };
            }
            return b;
        });
    };

    const enviar = async () => {
        if (!borrador || !texto.trim()) return;
        setEnviando(true);
        try {
            await comentar({ mesId, piezaId, texto, autorId: yoId, archivoId: archivo.id, marca: borrador });
            setBorrador(null);
            setTexto('');
            onCambio?.();
        } catch (err) {
            showToast('No se pudo guardar el comentario', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-6xl" ariaLabel={`Comentar sobre ${archivo.nombre || 'el diseño'}`}>
            <LiquidModal.Header>
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <h2 className="text-body-xl font-semibold text-content truncate">
                        Comentar sobre el diseño{archivo.version > 1 ? ` · V${archivo.version}` : ''}
                    </h2>
                    <SegmentedControl size="sm" value={herramienta} onChange={(v) => { setHerramienta(v); setBorrador(null); }}
                        label="Herramienta" options={HERRAMIENTAS} />
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                    <div className="min-w-0 flex justify-center">
                        <div ref={lienzo} className="relative inline-block max-w-full touch-none select-none cursor-crosshair"
                            onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
                            <img src={src} alt={archivo.nombre || 'Diseño'} draggable={false}
                                onLoad={(e) => setProporcion(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
                                className="block max-w-full max-h-[70dvh] rounded-lg" />
                            <Marcas marcas={marcados.map((c) => ({ ...c.marca, numero: c.numero }))}
                                borrador={borrador} resaltada={resaltada} proporcion={proporcion} />
                        </div>
                    </div>
                    <div className="space-y-4 min-w-0">
                        <div className="space-y-2">
                            <p className="text-body-sm text-content-2">
                                {herramienta === 'punto' && 'Toca el sitio exacto del diseño.'}
                                {herramienta === 'recuadro' && 'Arrastra para encerrar la zona.'}
                                {herramienta === 'trazo' && 'Dibuja encima con el dedo o el mouse.'}
                            </p>
                            <PortalTextarea label="Qué hay que cambiar ahí" name="anotacion" value={texto}
                                onChange={(e) => setTexto(e.target.value)} rows={3}
                                placeholder={borrador ? 'Ej. este precio va en $4.99' : 'Primero marca el diseño'} />
                        </div>
                        <ol className="space-y-2">
                            {marcados.map((c) => (
                                <li key={c.id}>
                                    <Button variant="ghost" size="sm" className="w-full justify-start text-left h-auto py-2"
                                        onClick={() => setResaltada((r) => (r === c.numero ? null : c.numero))}
                                        aria-pressed={resaltada === c.numero}>
                                        <span className="flex gap-2 items-start min-w-0">
                                            <span className="text-label font-bold text-danger shrink-0 w-5">{c.numero}</span>
                                            <span className="min-w-0 space-y-0.5">
                                                <Quien id={c.autor_id} personas={personas} px={18} />
                                                <span className={`block text-body-sm whitespace-pre-wrap ${c.resuelto ? 'line-through text-content-3' : 'text-content-2'}`}>
                                                    {c.texto}
                                                </span>
                                            </span>
                                        </span>
                                    </Button>
                                </li>
                            ))}
                            {!marcados.length && <li className="text-body-sm text-content-3">Sin marcas en este diseño.</li>}
                        </ol>
                    </div>
                </div>
            </LiquidModal.Body>
            <PieDeModal izquierda={borrador && (
                <Button variant="ghost" icon={RotateCcw} onClick={() => setBorrador(null)}>Borrar la marca</Button>
            )}>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                <Button icon={Send} loading={enviando} disabled={!borrador || !texto.trim()} onClick={enviar}>Comentar</Button>
            </PieDeModal>
        </LiquidModal>
    );
}
