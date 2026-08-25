import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, CameraOff, Loader2 } from 'lucide-react';
import ModalShell from './ModalShell';
import Notice from './Notice';
import Button from './Button';

/**
 * Lee un código de barras con la cámara y lo devuelve.
 *
 * Nació el 2026-08-23 para el Conteo de inventario —«escaneo la caja y me lleva
 * al producto»— pero no vive en esa vista a propósito: desde v2.710.0 se puede
 * buscar por código en diez pantallas, y todas quieren el mismo botón. El
 * lector del login (`LoginView`) hace esto mismo desde hace tiempo, escrito
 * adentro de la vista; éste es el mismo procedimiento como pieza suelta.
 *
 * ── La librería entra por `await import()` ────────────────────────────────
 * `@zxing/browser` + `@zxing/library` pesan y sólo hacen falta al apretar el
 * botón, así que viajan fuera del chunk de la vista (CLAUDE.md, «librerías
 * pesadas SOLO por await import()»). No hace falta guardar la promesa a mano
 * —el registro de módulos ya devuelve la misma en el segundo escaneo— y por eso
 * tampoco hay que acordarse de borrarla si falló: un `import()` que rechaza no
 * queda cacheado, así que el segundo intento vuelve a pedirla de verdad.
 *
 * ── Apagar la cámara es más difícil que prenderla ─────────────────────────
 * Hay que soltar el lector Y las pistas del stream Y limpiar el `srcObject`:
 * con dejar una sola, la luz de la cámara se queda encendida después de cerrar
 * el diálogo. Se hace en `apagar()`, y se llama desde los tres caminos —leyó,
 * cerró, se desmontó— porque el que se olvide es el que deja la luz prendida.
 *
 * ── Los 500 ms de calentamiento no son cosmética ──────────────────────────
 * Los primeros cuadros de una cámara vienen borrosos y zxing les inventa
 * lecturas: sin la espera, abrir el lector delante de un estante devolvía un
 * código de algo que no se estaba apuntando. El `cooldown` cumple lo mismo del
 * otro lado — una vez que leyó, deja de leer, porque el callback sigue
 * llegando mientras la cámara se apaga.
 *
 * @param {boolean}  abierto
 * @param {Function} onCerrar
 * @param {Function} onLeer      recibe el texto del código y el diálogo se cierra
 * @param {string}   [titulo]
 */
export default function LectorDeCodigo({ abierto, onCerrar, onLeer, titulo = 'Escanear código' }) {
    const videoRef = useRef(null);
    const lectorRef = useRef(null);
    const streamRef = useRef(null);
    const enfriandoRef = useRef(false);
    const [error, setError] = useState(null);
    const [preparando, setPreparando] = useState(true);

    const apagar = useCallback(() => {
        if (lectorRef.current) {
            try { lectorRef.current.reset(); } catch { /* mejor esfuerzo: ya puede estar suelto */ }
            lectorRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
        const v = videoRef.current;
        if (v?.srcObject) {
            try {
                v.srcObject.getTracks().forEach((t) => t.stop());
                v.srcObject = null;
                v.removeAttribute('src');
            } catch { /* mejor esfuerzo */ }
        }
    }, []);

    useEffect(() => () => apagar(), [apagar]);

    useEffect(() => {
        if (!abierto) { apagar(); return undefined; }
        let cancelado = false;
        let calentando = true;
        const finCalentamiento = setTimeout(() => { calentando = false; }, 500);
        setError(null);
        setPreparando(true);
        enfriandoRef.current = false;

        (async () => {
            try {
                const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
                    import('@zxing/browser'),
                    import('@zxing/library'),
                ]);
                if (cancelado) return;
                // Sólo los formatos que trae una caja de farmacia. La lista
                // acotada no es purismo: con todos habilitados, zxing prueba
                // cada decodificador en cada cuadro y en un teléfono de gama
                // media eso se siente como que «no lee».
                const hints = new Map();
                hints.set(DecodeHintType.POSSIBLE_FORMATS, [
                    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
                    BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
                    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
                ]);
                hints.set(DecodeHintType.TRY_HARDER, true);
                const lector = new BrowserMultiFormatReader(hints);
                lectorRef.current = lector;
                if (cancelado || !videoRef.current) return;
                // `undefined` = que el navegador elija la cámara. En un teléfono
                // eso es la trasera, que es la que apunta al estante.
                await lector.decodeFromVideoDevice(undefined, videoRef.current, (resultado) => {
                    if (!resultado || cancelado || calentando || enfriandoRef.current) return;
                    enfriandoRef.current = true;
                    const codigo = resultado.getText().trim();
                    if (videoRef.current?.srcObject) streamRef.current = videoRef.current.srcObject;
                    apagar();
                    onLeer?.(codigo);
                    onCerrar?.();
                });
                if (!cancelado) setPreparando(false);
            } catch {
                if (cancelado) return;
                apagar();
                setPreparando(false);
                setError('No se pudo abrir la cámara. Revisa que el navegador tenga permiso.');
            }
        })();

        return () => { cancelado = true; clearTimeout(finCalentamiento); apagar(); };
    }, [abierto, apagar, onLeer, onCerrar]);

    return (
        <ModalShell open={abierto} onClose={onCerrar} ariaLabel={titulo} maxWidthClass="max-w-md">
            <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Camera size={16} className="text-content-2 shrink-0" />
                    <p className="text-body-sm font-bold text-content">{titulo}</p>
                </div>

                {error ? (
                    <Notice variant="danger" icon={CameraOff}>{error}</Notice>
                ) : (
                    <>
                        {/* `aspect-[4/3]` y no una altura fija: con altura fija el
                            vídeo se recorta distinto en cada teléfono y el
                            encuadre que la persona ve no es el que se decodifica. */}
                        <div className="relative w-full aspect-[4/3] rounded-card overflow-hidden bg-black">
                            <video
                                ref={videoRef}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                aria-label="Vista de la cámara"
                            />
                            {/* La guía: un rectángulo ancho y bajo, que es la forma
                                de un código de barras. Sin ella la gente encuadra
                                la caja entera y el código queda demasiado chico
                                para decodificar. */}
                            <div className="absolute inset-0 grid place-items-center pointer-events-none">
                                <div className="w-[78%] h-[28%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                            </div>
                            {preparando && (
                                <div className="absolute inset-0 grid place-items-center bg-black/50">
                                    <Loader2 size={22} className="animate-spin text-white" />
                                </div>
                            )}
                        </div>
                        <p className="text-caption text-content-3 text-center">
                            Acerca el código de barras al recuadro.
                        </p>
                    </>
                )}

                <div className="flex justify-end">
                    <Button variant="secondary" onClick={onCerrar}>Cerrar</Button>
                </div>
            </div>
        </ModalShell>
    );
}
