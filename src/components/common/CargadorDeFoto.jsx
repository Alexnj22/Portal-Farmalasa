import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Camera, ClipboardPaste, Eye, Globe, ImagePlus, Loader2, Scissors, Smartphone, Trash2, X } from 'lucide-react';
import Badge from './Badge';
import Button from './Button';
import PhotoLightbox from './PhotoLightbox';
import useFotoDelTelefono from './useFotoDelTelefono';
import useCoarsePointer from '../../plataforma/useCoarsePointer';
import { fotoDeCatalogo } from '../../plataforma/imagenes';
import { precargarQuitarFondo } from '../../plataforma/fotoDeProducto';
import { PROPS_CAMARA } from '@nucleo/utils/capturaDeFoto';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

const PhotoEditorModal = lazy(() => import('./PhotoEditorModal'));

const LADO_GUARDADO = 800;
const CALIDAD_GUARDADO = 0.85;

/**
 * CargadorDeFoto — EL mecanismo para poner la foto de algo del catálogo.
 *
 * Nació de Fotos de productos (2026-10-30) y es el mismo en esa pantalla, en la
 * ficha del producto y en Laboratorios. Entra por archivo, arrastrando, pegando
 * (⌘V, clic derecho sobre el cuadro o el botón), con la cámara o desde el
 * teléfono; y siempre pasa por el editor en modo automático: limpia el fondo,
 * encuadra y no deja guardar una imagen vacía o diminuta.
 *
 * `onFoto(blob)` recibe la foto ya lista para subir (JPEG de 800 px). Quien
 * llama sólo decide dónde se guarda; un cambio al mecanismo se hace acá.
 *
 * @param {string|null} foto         lo que se muestra en el cuadro
 * @param {boolean} nueva            `foto` todavía no está guardada
 * @param {string} busqueda          texto para «Buscar en internet»
 * @param {string} etiqueta          cómo se anuncia en el teléfono
 * @param {(blob: Blob) => any} onFoto
 * @param {() => void} [onDescartar] descartar una foto `nueva`
 * @param {() => any} [onQuitar]     quitar la foto guardada
 * @param {boolean} [horizontal]     cuadro chico con los botones al lado
 * @param {boolean} [redondo]        se muestra en círculo: cuadro y recorte
 *                                   redondos, y encuadra para que no se corte
 */
export default function CargadorDeFoto({
    foto: imagen = null, nueva = false, busqueda = '', etiqueta = 'Foto', puedeEditar = true,
    onFoto, onDescartar, onQuitar, redondo = false, horizontal = false,
}) {
    const forma = redondo ? 'rounded-full' : 'rounded-2xl';
    const esTactil = useCoarsePointer();
    const archivoRef = useRef(null);
    const camaraRef = useRef(null);
    const [pendiente, setPendiente] = useState(null);   // elegida, todavía sin editar
    const [encima, setEncima] = useState(false);        // arrastrando una imagen sobre el cuadro
    const [ocupado, setOcupado] = useState(false);
    const [abriendo, setAbriendo] = useState(false);
    const [verGrande, setVerGrande] = useState(false);
    const avisar = (titulo, texto, tipo = 'error') => useToastStore.getState().showToast(titulo, texto, tipo);

    const fotoDelTelefono = useFotoDelTelefono(setPendiente, {
        etiqueta,
        onError: (msg) => { if (msg) avisar('Foto', msg); },
    });

    // En computadora, el modelo de quitar fondo se baja mientras nadie lo usa:
    // así la primera foto no espera la descarga.
    useEffect(() => {
        if (esTactil || !puedeEditar) return undefined;
        const id = setTimeout(() => { precargarQuitarFondo(); }, 3000);
        return () => clearTimeout(id);
    }, [esTactil, puedeEditar]);

    // Pegar en cualquier parte de la pantalla. Sólo se toma una IMAGEN: el
    // texto pegado en un campo sigue llegando al campo.
    useEffect(() => {
        if (!puedeEditar) return undefined;
        const alPegar = (e) => {
            for (const item of e.clipboardData?.items || []) {
                if (item.type.startsWith('image/')) {
                    const f = item.getAsFile();
                    if (f) { e.preventDefault(); setPendiente(f); return; }
                }
            }
        };
        document.addEventListener('paste', alPegar);
        return () => document.removeEventListener('paste', alPegar);
    }, [puedeEditar]);

    const elegirArchivo = (e) => {
        const f = e.target.files?.[0];
        if (f) setPendiente(f);
        e.target.value = '';
    };

    const soltar = (e) => {
        e.preventDefault();
        setEncima(false);
        const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
        if (f) setPendiente(f);
        else avisar('Foto', 'Suelta una imagen (JPG, PNG o WebP).', 'warning');
    };

    // El botón lee el portapapeles por la API, que pide permiso y algunos
    // navegadores niegan. El camino que siempre anda es el clic derecho › Pegar
    // sobre el cuadro, o ⌘V / Ctrl+V.
    const pegarImagen = async () => {
        try {
            if (!navigator.clipboard?.read) throw new Error('sin-lectura');
            for (const item of await navigator.clipboard.read()) {
                const tipo = item.types.find((t) => t.startsWith('image/'));
                if (tipo) { const b = await item.getType(tipo); setPendiente(new File([b], 'pegada.png', { type: tipo })); return; }
            }
            avisar('Pegar imagen', 'No hay una imagen copiada. En la búsqueda: clic derecho sobre la imagen › Copiar imagen.', 'warning');
        } catch (err) {
            console.error('CargadorDeFoto: leer el portapapeles', err);
            avisar('Pegar imagen', 'El navegador no deja leer lo copiado desde el botón. Haz clic derecho sobre el cuadro de la foto › Pegar, o ⌘V / Ctrl+V.', 'warning');
        }
    };

    const buscarEnInternet = () => {
        window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(busqueda)}`, '_blank', 'noopener');
    };

    // La foto que ya está vuelve al editor sin tener que buscar el archivo.
    const editarActual = async () => {
        setAbriendo(true);
        try {
            const r = await fetch(imagen, { signal: AbortSignal.timeout(15000) });
            if (!r.ok) throw new Error('No se pudo abrir la foto guardada.');
            setPendiente(new File([await r.blob()], 'foto.jpg', { type: 'image/jpeg' }));
        } catch (err) {
            avisar('Foto', mensajeAmigable(err));
        } finally {
            setAbriendo(false);
        }
    };

    const confirmar = async (blob) => {
        setPendiente(null);
        setOcupado(true);
        try {
            await onFoto(await fotoDeCatalogo(blob, LADO_GUARDADO, CALIDAD_GUARDADO));
        } catch (err) {
            avisar('No se pudo guardar', mensajeAmigable(err));
        } finally {
            setOcupado(false);
        }
    };

    const quitar = async () => {
        setOcupado(true);
        try {
            await onQuitar();
        } catch (err) {
            avisar('No se pudo guardar', mensajeAmigable(err));
        } finally {
            setOcupado(false);
        }
    };

    return (
        <div className={horizontal ? 'flex flex-col sm:flex-row sm:items-center gap-4 min-w-0' : 'space-y-2 min-w-0'}>
            <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={elegirArchivo} />
            <input ref={camaraRef} type="file" {...PROPS_CAMARA} className="hidden" aria-hidden="true" tabIndex={-1} onChange={elegirArchivo} />
            <div className={`relative w-full shrink-0 ${horizontal ? 'max-w-[176px]' : 'max-w-[240px]'}`}>
                <button type="button" disabled={!puedeEditar}
                    onClick={() => (esTactil ? camaraRef : archivoRef).current?.click()}
                    onDragOver={(e) => { e.preventDefault(); if (!encima) setEncima(true); }}
                    onDragLeave={() => setEncima(false)}
                    onDrop={puedeEditar ? soltar : undefined}
                    className={`relative w-full aspect-square max-w-[240px] ${forma} border-2 border-dashed overflow-hidden bg-surface-card active:scale-[0.97] transition-[transform,border-color] ${encima ? 'border-brand' : 'border-divider'}`}>
                    {imagen ? (
                        <img src={imagen} alt="" className="w-full h-full object-contain p-2" />
                    ) : (
                        <span className="w-full h-full flex flex-col items-center justify-center gap-2 px-4 text-center text-content-3">
                            <ImagePlus size={32} />
                            <span className="text-caption font-semibold">{esTactil ? 'Tomar foto' : 'Subir, arrastrar o clic derecho › Pegar'}</span>
                        </span>
                    )}
                    {nueva && <Badge variant="success" className="absolute top-2 left-2">Nueva</Badge>}
                    {ocupado && (
                        <span className="absolute inset-0 flex items-center justify-center bg-scrim">
                            <Loader2 size={24} className="text-white animate-spin" />
                        </span>
                    )}
                </button>
                {/* Zona de pegado: el navegador sólo ofrece «Pegar» en el clic
                    derecho sobre algo editable. Esta capa invisible lo es; lo
                    pegado sube como evento `paste` al oyente de arriba, y
                    cualquier texto que se cuele se borra. El clic sigue abriendo
                    el selector de archivos. */}
                {puedeEditar && !esTactil && (
                    <span contentEditable suppressContentEditableWarning role="textbox" aria-label="Pegar imagen aquí"
                        className={`absolute inset-0 ${forma} text-transparent caret-transparent outline-none cursor-pointer`}
                        onClick={(e) => { e.preventDefault(); archivoRef.current?.click(); }}
                        onDragOver={(e) => { e.preventDefault(); if (!encima) setEncima(true); }}
                        onDragLeave={() => setEncima(false)}
                        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); soltar(e); }}
                        onPaste={(e) => {
                            if (![...(e.clipboardData?.items || [])].some((i) => i.type.startsWith('image/'))) {
                                e.preventDefault();
                                avisar('Pegar imagen', 'Lo copiado no es una imagen. En la búsqueda: clic derecho sobre la imagen › Copiar imagen.', 'warning');
                            }
                        }}
                        onInput={(e) => { e.currentTarget.textContent = ''; }} />
                )}
            </div>
            {puedeEditar && (
                <div className="flex flex-wrap gap-1.5">
                    {esTactil && <Button variant="secondary" size="sm" icon={Camera} onClick={() => camaraRef.current?.click()}>Tomar foto</Button>}
                    {!esTactil && (
                        <Button variant="secondary" size="sm" icon={Smartphone}
                            loading={fotoDelTelefono.pidiendo} disabled={fotoDelTelefono.esperando}
                            onClick={fotoDelTelefono.pedir}>
                            {fotoDelTelefono.esperando ? 'Esperando el teléfono…' : 'Con el teléfono'}
                        </Button>
                    )}
                    {!esTactil && <Button variant="ghost" size="sm" icon={ClipboardPaste} onClick={pegarImagen}>Pegar imagen</Button>}
                    {busqueda && (
                        <Button variant="ghost" size="sm" icon={Globe} onClick={buscarEnInternet}
                            title="Abre la búsqueda de imágenes: copia una y pégala aquí">
                            Buscar en internet
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" icon={ImagePlus} onClick={() => archivoRef.current?.click()}>Elegir archivo</Button>
                    {imagen && <Button variant="ghost" size="sm" icon={Scissors} loading={abriendo} disabled={ocupado} onClick={editarActual}>Editar foto</Button>}
                    {nueva && onDescartar && <Button variant="ghost" size="sm" icon={X} onClick={onDescartar}>Descartar</Button>}
                    {imagen && <Button variant="ghost" size="sm" icon={Eye} onClick={() => setVerGrande(true)}>Ver grande</Button>}
                    {imagen && !nueva && onQuitar && <Button variant="ghost" size="sm" icon={Trash2} disabled={ocupado} onClick={quitar}>Quitar</Button>}
                </div>
            )}
            {fotoDelTelefono.dialogo}
            {pendiente && (
                <Suspense fallback={null}>
                    <PhotoEditorModal file={pendiente} producto redondo={redondo} onConfirm={confirmar} onCancel={() => setPendiente(null)} />
                </Suspense>
            )}
            <PhotoLightbox src={verGrande ? imagen : null} alt="Foto" onClose={() => setVerGrande(false)} />
        </div>
    );
}
