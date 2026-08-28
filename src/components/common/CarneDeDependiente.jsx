/**
 * El carné digital de dependiente de farmacia: escanearlo, verlo y quitarlo.
 *
 * ── Por qué no se adjunta un archivo ───────────────────────────────────────
 *
 * Porque el CSSP dejó de entregar una tarjeta. Hoy entrega un QR que lleva a la
 * ficha en línea, y lo que se conserva es esa dirección. Ver el detalle en
 * `src/utils/carneDeDependiente.js`.
 *
 * ── Por qué «ver el carné» abre una pestaña y no un marco embebido ─────────
 *
 * Se pidió «que muestre en un modal o algo». El modal está, y muestra lo que
 * este portal PUEDE mostrar con honestidad: el QR redibujado —para enseñarlo en
 * pantalla y que otro lo escanee, que es para lo que sirve un carné—, el número
 * y la dirección completa.
 *
 * Lo que NO hace es meter el sitio del Consejo dentro de un `<iframe>`. Un sitio
 * de gobierno casi siempre manda `X-Frame-Options`, así que el marco quedaría en
 * blanco: una caja vacía que parece un error del portal y que además nadie puede
 * arreglar desde acá. Un botón que abre la ficha de verdad cumple lo mismo y no
 * miente.
 *
 * ── Dos caminos para entrar el dato, y ninguno es opcional ─────────────────
 *
 * Escanear con la cámara es el camino natural cuando se tiene el QR delante.
 * Pero el carné llega muchas veces como un enlace —en un correo, en un
 * mensaje—, y ahí no hay nada que escanear: obligar a imprimirlo para poder
 * fotografiarlo sería pedir un rodeo. Los dos caminos terminan en la misma
 * comprobación.
 */
import React, { useState, lazy, Suspense } from 'react';
import { QrCode, Camera, ExternalLink, Trash2, ShieldCheck, X } from 'lucide-react';
import Button from './Button';
import Notice from './Notice';
import ModalShell from './ModalShell';
import PortalInput from './PortalInput';
import QrDeCaptura from './QrDeCaptura';
import { rotuloCampo } from '../../utils/rotuloDeCampo';
import { normalizarCarne, numeroDelCarne, porQueNoSirve } from '../../utils/carneDeDependiente';

// Arrastra `@zxing` y prende la cámara: sólo hace falta al apretar el botón.
const LectorDeCodigo = lazy(() => import('./LectorDeCodigo'));

/**
 * @param {string|null} url      lo guardado hoy
 * @param {Function}    onChange recibe la dirección nueva, o `null` al quitarla
 * @param {boolean}     [soloLectura]
 */
export default function CarneDeDependiente({ url, onChange, soloLectura = false }) {
    const [escaneando, setEscaneando] = useState(false);
    const [viendo, setViendo] = useState(false);
    const [pegando, setPegando] = useState(false);
    const [textoPegado, setTextoPegado] = useState('');
    const [error, setError] = useState(null);

    const numero = numeroDelCarne(url);

    const aceptar = (texto) => {
        const bueno = normalizarCarne(texto);
        if (!bueno) { setError(porQueNoSirve(texto)); return false; }
        setError(null);
        onChange?.(bueno);
        return true;
    };

    return (
        <div className="flex flex-col gap-2">
            <label className={rotuloCampo('text-content-2', { denso: true })}>
                <span>Carné digital del Consejo</span>
                {!url && <span className="text-warning font-black">Pendiente</span>}
            </label>

            {url ? (
                <div data-surface="card" className="p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-btn bg-success/12 border border-success/25
                                    flex items-center justify-center shrink-0">
                        <ShieldCheck size={16} className="text-success" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-label font-black text-content truncate">
                            {numero ? `Carné N° ${numero}` : 'Carné registrado'}
                        </p>
                        <p className="text-micro text-content-3 font-medium truncate">{url}</p>
                    </div>
                    <Button variant="secondary" size="sm" icon={QrCode} onClick={() => setViendo(true)}>
                        Ver
                    </Button>
                    {!soloLectura && (
                        <Button variant="ghost" size="sm" icon={Trash2} iconOnly
                            title="Quitar el carné" onClick={() => { onChange?.(null); setError(null); }} />
                    )}
                </div>
            ) : soloLectura ? (
                <p className="text-label text-content-3 font-medium">Sin carné registrado.</p>
            ) : (
                <>
                    <p className="text-micro text-content-3 font-medium leading-snug">
                        Ya no es una tarjeta: el Consejo entrega un código QR que lleva a la ficha
                        en línea. Escanéalo y el portal guarda su dirección.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" icon={Camera}
                            onClick={() => { setError(null); setEscaneando(true); }}>
                            Escanear el QR
                        </Button>
                        <Button variant="ghost" size="sm" icon={ExternalLink}
                            onClick={() => { setError(null); setPegando(v => !v); }}>
                            {pegando ? 'Cancelar' : 'Pegar el enlace'}
                        </Button>
                    </div>

                    {/* El enlace pegado. Se confirma con un botón y no al teclear:
                        una dirección a medio escribir no es una dirección
                        inválida, y marcarla en rojo mientras se escribe es
                        contradecir a alguien que todavía no terminó. */}
                    {pegando && (
                        <div className="flex items-end gap-2 mt-1">
                            <div className="flex-1 min-w-0">
                                <PortalInput
                                    label="Dirección del carné"
                                    value={textoPegado}
                                    onChange={(e) => setTextoPegado(e.target.value)}
                                    placeholder="https://expedientes.srs.gob.sv/carnets/dependientes/…"
                                />
                            </div>
                            <Button size="md" onClick={() => {
                                if (aceptar(textoPegado)) { setTextoPegado(''); setPegando(false); }
                            }}>
                                Guardar
                            </Button>
                        </div>
                    )}
                </>
            )}

            {error && <Notice variant="warning" compact>{error}</Notice>}

            {escaneando && (
                <Suspense fallback={null}>
                    <LectorDeCodigo
                        abierto
                        formatos="qr"
                        titulo="Escanear el carné de dependiente"
                        onCerrar={() => setEscaneando(false)}
                        onLeer={(texto) => { setEscaneando(false); aceptar(texto); }}
                    />
                </Suspense>
            )}

            {viendo && url && (
                <ModalShell open onClose={() => setViendo(false)} maxWidthClass="max-w-sm"
                    ariaLabel="Carné de dependiente de farmacia">
                    <div className="p-5 pt-3 flex flex-col items-center gap-4">
                        <div className="w-full flex items-center justify-between gap-2">
                            <p className="min-w-0 text-body-sm font-black uppercase tracking-widest text-content-3">
                                Carné de dependiente
                            </p>
                            <Button variant="ghost" size="sm" icon={X} iconOnly
                                title="Cerrar" onClick={() => setViendo(false)} />
                        </div>

                        {numero && (
                            <p className="text-body-lg font-black text-content">N° {numero}</p>
                        )}

                        {/* El QR se REDIBUJA desde la dirección guardada. Por eso se
                            guarda la dirección y no una foto: de la dirección sale el
                            dibujo, del dibujo no sale la dirección. */}
                        <QrDeCaptura enlace={url} leyenda="El carné vigente del Consejo" />

                        <p className="text-micro text-content-3 font-medium text-center break-all leading-snug max-w-[260px]">
                            {url}
                        </p>

                        <Button variant="secondary" size="sm" icon={ExternalLink}
                            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
                            Abrir la ficha del Consejo
                        </Button>
                    </div>
                </ModalShell>
            )}
        </div>
    );
}
