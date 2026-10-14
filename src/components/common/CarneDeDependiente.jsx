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
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { QrCode, Camera, ExternalLink, Trash2, ShieldCheck, X, Smartphone } from 'lucide-react';
import Button from './Button';
import Notice from './Notice';
import ModalShell from './ModalShell';
import PortalInput from './PortalInput';
import QrDeCaptura from './QrDeCaptura';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import useCoarsePointer from '../../plataforma/useCoarsePointer';
import { normalizarCarne, numeroDelCarne, porQueNoSirve } from '@nucleo/utils/carneDeDependiente';
import { PROPS_CAMARA } from '@nucleo/utils/capturaDeFoto';
import { hayCamaraEnVivo } from '@plataforma/leerQrDeFoto';

// Arrastra `@zxing` y prende la cámara: sólo hace falta al apretar el botón.
const LectorDeCodigo = lazy(() => import('./LectorDeCodigo'));
const DialogoDeCaptura = lazy(() => import('./DialogoDeCaptura'));
const traspaso = () => import('@nucleo/data/capturaDeFoto');

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
    const [captura, setCaptura] = useState(null);
    const esTactil = useCoarsePointer();
    const [leyendoFoto, setLeyendoFoto] = useState(false);
    const entradaDeFoto = useRef(null);
    // Sin cámara en vivo (la vista web de una app, un navegador incrustado) el
    // lector no puede abrir: ahí el camino es una foto del código.
    const enVivo = hayCamaraEnVivo();


    const numero = numeroDelCarne(url);

    const aceptar = useCallback((texto) => {
        const bueno = normalizarCarne(texto);
        if (!bueno) { setError(porQueNoSirve(texto)); return false; }
        setError(null);
        onChange?.(bueno);
        return true;
    }, [onChange]);

    /* ── El QR desde una FOTO, en el mismo teléfono ─────────────────────────
     *
     * Reportado dos veces en Android (2026-10-13 y 14): «Escanear» daba error y
     * no abría la cámara, mientras en iPhone sí. La cámara en vivo depende del
     * navegador —y dentro de una app o del navegador de Google Lens no está—;
     * una foto con la cámara del sistema funciona en todos. Se lee aquí y se
     * guarda el ENLACE, nunca la foto. */
    const desdeUnaFoto = async (file) => {
        if (!file) return;
        setError(null);
        setLeyendoFoto(true);
        try {
            const { leerQrDeFoto } = await import('@plataforma/leerQrDeFoto');
            const texto = await leerQrDeFoto(file);
            if (!texto) setError('No se leyó ningún código en la foto. Acércate al QR, que salga nítido y sin reflejo.');
            else aceptar(texto);
        } catch {
            setError('No se pudo abrir la foto. Intenta de nuevo.');
        } finally {
            setLeyendoFoto(false);
        }
    };

    /* ── El carné, desde el teléfono ────────────────────────────────────────
     *
     * Pedido del usuario: «que permita hacerlo desde el teléfono también». En
     * una computadora sin cámara —que son casi todas las de administración— el
     * botón de escanear no sirve, y el carné está en el teléfono de la persona.
     *
     * Mismo canal que el traspaso de fotos —el QR de cinco minutos, la misma
     * pantalla `/foto/<secreto>`—, pero abierto en modo `qr`: el teléfono abre
     * el LECTOR en vivo y manda el texto del código, no una imagen.
     *
     * Hasta el 2026-10-13 mandaba una foto y la computadora intentaba leer el
     * QR en ella. El usuario: «la foto no me sirve, debe ser el enlace / qr».
     * Una foto reducida a 1600 px de un QR —muchas veces en otra pantalla, con
     * reflejo— casi nunca se deja leer; la cámara en vivo reintenta sola hasta
     * leerlo. */
    const pedirAlTelefono = useCallback(async () => {
        setError(null);
        try {
            const { abrirCaptura } = await traspaso();
            const r = await abrirCaptura(null, 'qr');
            if (!r.ok) { setError(r.motivo); return; }
            setCaptura(r);
        } catch {
            setError('No se pudo abrir el código. Revisa tu conexión e intenta de nuevo.');
        }
    }, []);

    useEffect(() => {
        if (!captura?.id) return undefined;
        let vivo = true;
        let dejarDeEscuchar = null;
        (async () => {
            const { esperarTexto } = await traspaso();
            if (!vivo) return;
            dejarDeEscuchar = esperarTexto(captura.id, (texto) => {
                setCaptura(null);
                // El texto llega tal cual lo leyó el teléfono: pasa por la MISMA
                // comprobación que el enlace pegado a mano.
                aceptar(texto);
            });
        })();
        return () => { vivo = false; dejarDeEscuchar?.(); };
    }, [captura?.id, aceptar]);

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
                        {enVivo && (
                            <Button variant="secondary" size="sm" icon={Camera}
                                onClick={() => { setError(null); setEscaneando(true); }}
                                disabled={!!captura || leyendoFoto}>
                                Escanear el QR
                            </Button>
                        )}
                        {/* En el teléfono, o donde no hay cámara en vivo. */}
                        {(esTactil || !enVivo) && (
                            <>
                                <Button variant="secondary" size="sm" icon={Camera}
                                    onClick={() => entradaDeFoto.current?.click()}
                                    disabled={!!captura || leyendoFoto} loading={leyendoFoto}>
                                    {leyendoFoto ? 'Leyendo el código…' : 'Foto del código'}
                                </Button>
                                <input ref={entradaDeFoto} type="file" {...PROPS_CAMARA} className="sr-only" onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    desdeUnaFoto(file);
                                }} />
                            </>
                        )}
                        {/* Sólo en escritorio, igual que en los adjuntos: en el
                            teléfono ya está la cámara ahí mismo y ofrecer un
                            código para escanearse a sí mismo es un rodeo. */}
                        {!esTactil && (
                            <Button variant="secondary" size="sm" icon={Smartphone}
                                onClick={pedirAlTelefono}
                                disabled={!!captura}>
                                {captura ? 'Esperando el teléfono…' : 'Con el teléfono'}
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" icon={ExternalLink}
                            onClick={() => { setError(null); setPegando(v => !v); }}
                            disabled={!!captura}>
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

            {captura && (
                <Suspense fallback={null}>
                    <DialogoDeCaptura
                        captura={captura}
                        etiqueta="el carné de dependiente"
                        modo="qr"
                        alCerrar={() => setCaptura(null)}
                        alRenovar={pedirAlTelefono} />
                </Suspense>
            )}

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
