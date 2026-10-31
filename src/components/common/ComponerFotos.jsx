import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ImagePlus, Trash2, BringToFront, SendToBack, Loader2, Check, ClipboardPaste } from 'lucide-react';
import Button from './Button';
import Notice from './Notice';
import Checkbox from './Checkbox';
import { quitarFondo } from '../../plataforma/fotoDeProducto';

// Varias fotos en una (2026-10-31): la caja y el blíster juntos. La foto que
// se venía editando es la primera capa; se agregan otras encima, se mueven
// arrastrando y se cambian de tamaño con la barra. «Listo» las aplana en un
// cuadro de LADO px — con fondo blanco en el catálogo, transparente si no — y
// el editor sigue con ese resultado (encuadre, guardar) como con cualquier foto.
const LADO = 1200;
const VISTA = 340;

function cargar(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Recorta lo transparente de alrededor: una foto sin fondo trae mucho aire y
// así su tamaño en el cuadro es el del producto, no el del rectángulo.
async function ajustarAlContenido(src) {
    const img = await cargar(src);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 10) {
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === width - 1 && y1 === height - 1)) return { img, w: width, h: height };
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const r = document.createElement('canvas');
    r.width = w; r.height = h;
    r.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
    return { img: await cargar(r.toDataURL('image/png')), w, h };
}

let siguienteId = 1;

export default function ComponerFotos({ base, producto = false, onListo, onCancelar }) {
    const [capas, setCapas] = useState([]);       // [{id, img, w, h, cx, cy, escala}] — la última va arriba
    const [elegida, setElegida] = useState(null);
    const [sinFondo, setSinFondo] = useState(true);
    const [agregando, setAgregando] = useState(false);
    const [error, setError] = useState('');
    const [listo, setListo] = useState(false);
    const arrastre = useRef(null);
    const inputRef = useRef(null);

    const agregar = useCallback(async (src, { escala = 0.6, desplazar = true } = {}) => {
        const { img, w, h } = await ajustarAlContenido(src);
        const id = siguienteId++;
        setCapas(cs => [...cs, {
            id, img, w, h, escala,
            cx: desplazar ? 0.62 : 0.5, cy: desplazar ? 0.62 : 0.5,
        }]);
        setElegida(id);
    }, []);

    useEffect(() => {
        agregar(base, { escala: 0.9, desplazar: false }).catch(() => setError('No se pudo abrir la foto.'));
    }, [base, agregar]);

    const elegirArchivo = (e) => {
        const archivo = e.target.files?.[0];
        e.target.value = '';
        if (archivo) agregarArchivo(archivo);
    };

    // Pegar (⌘V / Ctrl+V): una imagen copiada de internet o de otra foto entra
    // como capa nueva, igual que elegida del disco.
    useEffect(() => {
        const alPegar = (e) => {
            const item = [...(e.clipboardData?.items ?? [])].find(it => it.type.startsWith('image/'));
            const archivo = item?.getAsFile();
            if (!archivo) return;
            // En captura y sin seguir: la pantalla de atrás (catálogo, Fotos
            // de productos) también escucha el pegado y abriría el editor de
            // nuevo con esa imagen, tirando la composición.
            e.preventDefault(); e.stopPropagation();
            agregarArchivo(archivo);
        };
        window.addEventListener('paste', alPegar, true);
        return () => window.removeEventListener('paste', alPegar, true);
    });
    // El botón «Pegar»: lee el portapapeles (el navegador puede pedir permiso).
    const pegar = async () => {
        setError('');
        try {
            const items = await navigator.clipboard.read();
            for (const it of items) {
                const tipo = it.types.find(t => t.startsWith('image/'));
                if (tipo) { agregarArchivo(await it.getType(tipo)); return; }
            }
            setError('No hay una imagen copiada. Copia la imagen (clic derecho › Copiar imagen) y vuelve a pegar.');
        } catch {
            setError('Este navegador no deja leer lo copiado desde el botón: pega con ⌘V (o Ctrl+V).');
        }
    };

    async function agregarArchivo(archivo) {
        setAgregando(true); setError('');
        const url = URL.createObjectURL(archivo);
        try {
            let src = url;
            if (sinFondo) {
                try { src = URL.createObjectURL(await quitarFondo(url)); }
                catch { setError('No se pudo quitar el fondo de esa foto: se agregó como está. Retócala después.'); }
            }
            await agregar(src);
        } catch {
            setError('No se pudo abrir esa foto.');
        } finally {
            setAgregando(false);
        }
    };

    const cambiar = (id, cambios) => setCapas(cs => cs.map(c => (c.id === id ? { ...c, ...cambios } : c)));
    const capa = capas.find(c => c.id === elegida);

    // Tamaño en la vista: el lado mayor de la capa ocupa `escala` del cuadro.
    const medida = (c) => {
        const k = (c.escala * VISTA) / Math.max(c.w, c.h);
        return { w: c.w * k, h: c.h * k };
    };

    const empezar = (e, c) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setElegida(c.id);
        arrastre.current = { id: c.id, x: e.clientX, y: e.clientY, cx: c.cx, cy: c.cy };
    };
    const mover = (e) => {
        const a = arrastre.current;
        if (!a || a.tamano) return;
        cambiar(a.id, {
            cx: Math.min(1, Math.max(0, a.cx + (e.clientX - a.x) / VISTA)),
            cy: Math.min(1, Math.max(0, a.cy + (e.clientY - a.y) / VISTA)),
        });
    };
    const soltar = () => { arrastre.current = null; };

    // La esquina de la foto elegida: arrastrarla agranda o achica desde el
    // centro, guardando la proporción.
    const empezarTamano = (e, c) => {
        e.preventDefault(); e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const caja = e.currentTarget.parentElement.getBoundingClientRect();
        arrastre.current = { id: c.id, tamano: true, caja, cx: c.cx, cy: c.cy, escala: c.escala,
            d0: Math.hypot(e.clientX - (caja.left + c.cx * VISTA), e.clientY - (caja.top + c.cy * VISTA)) };
    };
    const moverTamano = (e) => {
        const a = arrastre.current;
        if (!a?.tamano) return;
        const d = Math.hypot(e.clientX - (a.caja.left + a.cx * VISTA), e.clientY - (a.caja.top + a.cy * VISTA));
        if (a.d0 > 0) cambiar(a.id, { escala: Math.min(1.2, Math.max(0.08, a.escala * d / a.d0)) });
    };

    const alFrente = () => setCapas(cs => [...cs.filter(c => c.id !== elegida), cs.find(c => c.id === elegida)]);
    const atras = () => setCapas(cs => [cs.find(c => c.id === elegida), ...cs.filter(c => c.id !== elegida)]);
    const quitar = () => { setCapas(cs => cs.filter(c => c.id !== elegida)); setElegida(null); };

    const terminar = () => {
        setListo(true);
        const lienzo = document.createElement('canvas');
        lienzo.width = LADO; lienzo.height = LADO;
        const ctx = lienzo.getContext('2d');
        if (producto) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, LADO, LADO); }
        for (const c of capas) {
            const k = (c.escala * LADO) / Math.max(c.w, c.h);
            const w = c.w * k, h = c.h * k;
            ctx.drawImage(c.img, c.cx * LADO - w / 2, c.cy * LADO - h / 2, w, h);
        }
        lienzo.toBlob(b => {
            setListo(false);
            if (b) onListo(URL.createObjectURL(b));
        }, 'image/png');
    };

    return (
        <>
            <div className="relative shrink-0 flex items-center justify-center" style={{ height: VISTA }}>
                <div
                    className={`relative overflow-hidden ${producto ? 'bg-[#fff]' : ''}`}
                    style={{ width: VISTA, height: VISTA, touchAction: 'none', ...(producto ? {} : {
                        backgroundImage: 'repeating-conic-gradient(#d0d0d0 0% 25%, #f8f8f8 0% 50%)', backgroundSize: '18px 18px',
                    }) }}
                    onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
                    onPointerDown={(e) => { if (e.target === e.currentTarget) setElegida(null); }}
                >
                    {capas.map(c => {
                        const { w, h } = medida(c);
                        return (
                            <img key={c.id} src={c.img.src} alt="" draggable={false}
                                onPointerDown={(e) => empezar(e, c)}
                                className={`absolute select-none cursor-move ${elegida === c.id ? 'outline outline-2 outline-dashed outline-brand' : ''}`}
                                style={{ left: c.cx * VISTA - w / 2, top: c.cy * VISTA - h / 2, width: w, height: h, maxWidth: 'none' }} />
                        );
                    })}
                    {capa && (() => {
                        const { w, h } = medida(capa);
                        return (
                            <span role="presentation" aria-hidden="true"
                                onPointerDown={(e) => empezarTamano(e, capa)} onPointerMove={moverTamano}
                                onPointerUp={soltar} onPointerCancel={soltar}
                                className="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow cursor-nwse-resize"
                                style={{ left: capa.cx * VISTA + w / 2, top: capa.cy * VISTA + h / 2, touchAction: 'none' }} />
                        );
                    })()}
                </div>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto">
                <div className="flex flex-wrap items-center gap-2">
                    <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={elegirArchivo} />
                    <Button variant="secondary" icon={agregando ? Loader2 : ImagePlus} disabled={agregando} onClick={() => inputRef.current?.click()}>
                        {agregando ? 'Agregando…' : 'Agregar foto'}
                    </Button>
                    <Button variant="secondary" icon={ClipboardPaste} disabled={agregando} onClick={pegar}>Pegar</Button>
                    <Checkbox checked={sinFondo} onChange={setSinFondo} label="Quitarle el fondo" />
                </div>
                {capa ? (
                    <>
                        <div className="flex items-center gap-3">
                            <span className="text-caption font-bold text-content-3 shrink-0">Tamaño</span>
                            <input type="range" min={10} max={100} step={1} value={Math.round(capa.escala * 100)}
                                onChange={e => cambiar(capa.id, { escala: Number(e.target.value) / 100 })}
                                className="flex-1 accent-brand cursor-pointer" aria-label="Tamaño de la foto elegida" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" size="sm" icon={BringToFront} onClick={alFrente}>Al frente</Button>
                            <Button variant="secondary" size="sm" icon={SendToBack} onClick={atras}>Atrás</Button>
                            {capas.length > 1 && <Button variant="secondary" size="sm" icon={Trash2} onClick={quitar}>Quitar</Button>}
                        </div>
                    </>
                ) : (
                    <p className="text-caption text-content-3">Toca una foto para moverla; su esquina azul le cambia el tamaño. También puedes pegar una imagen con ⌘V.</p>
                )}
                {error && <Notice variant="warning" compact>{error}</Notice>}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-divider shrink-0">
                <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
                <Button icon={listo ? Loader2 : Check} disabled={listo || !capas.length || agregando} onClick={terminar}>Listo</Button>
            </div>
        </>
    );
}
