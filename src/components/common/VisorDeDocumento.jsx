/**
 * Ver un documento adjunto SIN salir de la pantalla — y poder arreglarlo.
 *
 * ── Por qué deja de abrirse una pestaña ────────────────────────────────────
 *
 * Pedido del usuario: *«que los documentos se puedan ver en la misma pantalla,
 * no abrir otra pestaña»*. Y el motivo no es sólo comodidad: la pestaña nueva
 * saca a la persona del formulario que estaba llenando, y volver es acordarse
 * de que había un formulario abierto. Si además el documento está mal —torcido,
 * chiquito, ilegible— el camino para arreglarlo empezaba por cerrar la pestaña,
 * volver, quitar el archivo y subirlo de nuevo.
 *
 * ── Editar lo YA GUARDADO ──────────────────────────────────────────────────
 *
 * Hasta hoy el editor sólo existía ANTES de subir: una vez guardado, un
 * documento torcido se quedaba torcido para siempre. Lo trajo una foto real —un
 * DUI acostado ocupando un tercio de una foto vertical, el resto escritorio— que
 * ya estaba en el expediente.
 *
 * Acá el archivo guardado se trae de vuelta como un `File` normal y entra al
 * MISMO editor que usa una subida nueva. Lo que sale de ahí se entrega por
 * `onEditado`, y el formulario lo sube por su camino de siempre: no hay una
 * segunda forma de guardar un documento, que es como dos caminos se
 * desincronizan.
 *
 * ── Lo que no se puede editar, y se dice ───────────────────────────────────
 *
 * Un PDF se ve pero no se edita: recortarlo exigiría rasterizarlo —o sea
 * convertirlo en una imagen y perder el texto seleccionable— para arreglar algo
 * que un PDF casi nunca tiene, porque viene de un escáner y ya está encuadrado.
 * El botón no aparece, en vez de aparecer y fallar.
 */
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { X, Pencil, ExternalLink, Download, Loader2, FileText } from 'lucide-react';
import ModalShell from './ModalShell';
import Button from './Button';
import Notice from './Notice';
import { getSignedFileUrl, downloadStoredFile } from '../../utils/storageFiles';

const EditorDeDocumento = lazy(() => import('./EditorDeDocumento'));

/* ── Qué es el archivo NO se pregunta al nombre ────────────────────────────
 *
 * Se preguntaba, y falló en el primer documento real: el nombre llegó vacío
 * —la fila no lo tenía guardado— así que cayó en «Documento», el visor lo dio
 * por PDF y lo puso en un marco. Dos síntomas de una sola causa: la foto se
 * veía AMPLIADA (un marco muestra la imagen a tamaño natural, no ajustada) y el
 * botón de recortar no aparecía, porque un PDF no se edita.
 *
 * El tipo autoritativo es el del CONTENIDO, que llega en el `Content-Type` del
 * propio archivo. El nombre y la extensión quedan de respaldo para cuando el
 * servidor no dice nada útil (`application/octet-stream`), que pasa. */
const porExtension = (texto = '') =>
    /\.(jpe?g|png|webp|gif|heic|heif)(\?|$)/i.test(texto);

export const esImagen = (tipoReal, nombre, url) => {
    if (tipoReal && /^image\//i.test(tipoReal)) return true;
    if (tipoReal && /^application\/pdf/i.test(tipoReal)) return false;
    return porExtension(nombre) || porExtension(url);
};

/**
 * @param {string}   url        lo guardado (URL formato-público del bucket)
 * @param {File|null} file      un archivo todavía sin subir, si lo hay
 * @param {string}   nombre     el nombre del archivo, para el título y la descarga
 * @param {string}   tipo       clave de `DOCS` para el editor (`documento`, `dui`…)
 * @param {Function} alCerrar
 * @param {Function} [onEditado] recibe el `File` corregido. Sin esto no se ofrece editar.
 */
export default function VisorDeDocumento({ url, file, nombre, tipo = 'documento', alCerrar, onEditado }) {
    /* El nombre real si lo hay; si no, el del archivo en el bucket. «Documento»
     * a secas es lo que se vio en pantalla la primera vez, y no distingue un
     * adjunto de otro cuando el expediente tiene seis. */
    const titulo = nombre?.trim()
        || (url ? decodeURIComponent(String(url).split('?')[0].split('/').pop() || '') : '')
        || 'Documento';
    const [verLo, setVerLo] = useState(null);      // la URL con la que se pinta
    const [tipoReal, setTipoReal] = useState(null); // lo que dice el CONTENIDO
    const [comoArchivo, setComoArchivo] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [fallo, setFallo] = useState(null);
    const [editando, setEditando] = useState(null);

    /* Un archivo sin subir se ve del disco. Uno guardado se TRAE entero, no sólo
     * se firma su URL: así el tipo sale del contenido y no de adivinarlo, y de
     * paso el archivo ya está acá para editarlo sin una segunda descarga —el
     * bucket es privado y cada firma es una llamada más. */
    useEffect(() => {
        let vivo = true;
        let objeto = null;
        const soltar = () => { if (objeto) URL.revokeObjectURL(objeto); };

        if (file) {
            objeto = URL.createObjectURL(file);
            setVerLo(objeto); setTipoReal(file.type || null);
            setComoArchivo(file); setCargando(false);
            return () => { vivo = false; soltar(); };
        }

        (async () => {
            try {
                const firmada = await getSignedFileUrl(url);
                if (!firmada) throw new Error('sin firma');
                const r = await fetch(firmada);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const blob = await r.blob();
                if (!vivo) return;
                objeto = URL.createObjectURL(blob);
                setVerLo(objeto);
                setTipoReal(blob.type || null);
                setComoArchivo(new File([blob], nombre || 'documento', { type: blob.type || '' }));
            } catch {
                if (vivo) setFallo('No se pudo abrir el documento.');
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; soltar(); };
    }, [url, file, nombre]);

    const laImagen = esImagen(tipoReal, nombre, url);

    // Ya está en memoria: editar no vuelve a bajar nada.
    const editar = () => { if (comoArchivo) setEditando(comoArchivo); };

    return (
        <>
            {/* ── Un visor se mide por lo que deja LEER ────────────────────
                `max-w-3xl` son 768px: a un DUI escaneado eso lo deja del tamaño
                de una tarjeta de crédito en un monitor de 1512, y el número que
                uno vino a verificar no se lee. Pedido del usuario el
                2026-09-04: *«que lo pueda abrir en un modal grande para ver
                bien el documento»*.

                `max-w-6xl` (1152px) y no la pantalla entera: un documento tiene
                proporción de papel, así que pasado cierto ancho lo que crece es
                el margen gris de los lados, no el documento. El alto es el que
                manda —de ahí los `90dvh` del panel— porque una hoja carta es
                más alta que ancha, y el lienzo se queda con lo que sobra.

                En el teléfono no cambia nada: `ModalShell` lo dibuja como hoja
                y el ancho máximo no llega a aplicar. */}
            <ModalShell open onClose={alCerrar} maxWidthClass="max-w-6xl"
                panelClassName="overflow-hidden" ariaLabel={titulo}>
                {/* ── Alto DEFINIDO, no un tope ────────────────────────────
                    Reportado el 2026-09-04 con captura: *«¿por qué hay 2
                    scrolls?»*. Eran el del panel y el del propio PDF, uno al
                    lado del otro.

                    La causa es aritmética. Con `max-h-[90dvh]` el panel mide lo
                    que mida su contenido, y el lienzo pedía `78dvh` fijos: al
                    lienzo le quedaban `90dvh − 122px` (el encabezado y el pie),
                    o sea **778px de 804 en una ventana de 1000** — 26px de más.
                    Ese sobrante lo absorbía el `overflow-auto` del panel, y
                    aparecía una segunda barra para recorrer 26 píxeles.

                    Con el alto DEFINIDO el lienzo es `flex-1` y mide exactamente
                    lo que sobra: no hay resto, no hay segunda barra, y la única
                    que queda es la del documento — que es la que sirve, porque
                    es la que pasa las páginas.

                    `fallo` es la excepción: un aviso de dos renglones dentro de
                    una caja de 90dvh es una pantalla vacía. Mientras CARGA sí va
                    alto, porque lo que viene es un documento y así el panel no
                    salta de tamaño al llegar. */}
                <div className={`flex flex-col ${fallo ? 'max-h-[90dvh]' : 'h-[90dvh]'}`}>
                    <div className="flex items-center gap-2 p-4 pb-3 border-b border-divider shrink-0">
                        <FileText size={16} className="text-content-3 shrink-0" strokeWidth={2.5} />
                        <p className="min-w-0 flex-1 truncate text-body-sm font-bold text-content">
                            {titulo}
                        </p>
                        <Button variant="ghost" size="sm" icon={X} iconOnly title="Cerrar" onClick={alCerrar} />
                    </div>

                    <div className="flex-1 min-h-0 bg-surface-card-hover p-3 flex">
                        {cargando ? (
                            <Loader2 size={22} className="m-auto animate-spin text-content-3" />
                        ) : fallo ? (
                            <div className="m-auto p-6 max-w-md"><Notice variant="warning">{fallo}</Notice></div>
                        ) : laImagen ? (
                            // `object-contain` y no `cover`: recortar un documento
                            // para que llene la caja esconde justo el borde que
                            // hay que mirar para saber si entró completo.
                            //
                            // Y `max-h-full` en vez de `max-h-[78dvh]`: el tope
                            // tiene que ser la caja que la contiene, no una
                            // fracción de la ventana calculada aparte — dos
                            // medidas del mismo alto es cómo aparecía el resto
                            // que producía la segunda barra.
                            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center">
                                <img src={verLo} alt={titulo}
                                    className="max-w-full max-h-full object-contain rounded-card shadow-[var(--shadow-glass-2)]" />
                            </div>
                        ) : (
                            /* Sin fondo propio: el visor de PDF del navegador
                               pinta el suyo, y forzarle uno blanco a mano es un
                               color crudo que además no dice nada — el papel ya
                               viene dibujado adentro del documento.

                               `flex-1 min-h-0` y no un alto propio: así el marco
                               mide lo que sobra y el único que scrollea es el
                               documento de adentro. */
                            <iframe src={verLo} title={titulo}
                                className="flex-1 min-h-0 w-full rounded-card border-0 bg-surface-card" />
                        )}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 p-4 pt-3 border-t border-divider shrink-0">
                        {/* Editar sólo si es una imagen y si quien abrió el visor
                            sabe qué hacer con el resultado. Ver el encabezado. */}
                        {laImagen && onEditado && !fallo && (
                            <Button variant="secondary" size="sm" icon={Pencil}
                                onClick={editar} disabled={cargando || !comoArchivo}>
                                Recortar y enderezar
                            </Button>
                        )}
                        {url && (
                            <Button variant="ghost" size="sm" icon={Download}
                                onClick={() => downloadStoredFile(url, titulo)}>
                                Descargar
                            </Button>
                        )}
                        {/* La pestaña aparte deja de ser el camino y pasa a ser
                            una salida más: para imprimirlo, o para verlo grande
                            en otra ventana. */}
                        {verLo && !fallo && (
                            <Button variant="ghost" size="sm" icon={ExternalLink}
                                onClick={() => window.open(verLo, '_blank', 'noopener,noreferrer')}>
                                Abrir aparte
                            </Button>
                        )}
                    </div>
                </div>
            </ModalShell>

            {editando && (
                <Suspense fallback={null}>
                    <EditorDeDocumento
                        tipo={tipo}
                        // Se abre sobre algo YA guardado: la imagen es el
                        // documento, no una foto por encuadrar.
                        yaRecortado
                        file={editando}
                        onCancel={() => setEditando(null)}
                        onConfirm={(corregido) => {
                            setEditando(null);
                            onEditado?.(corregido);
                            alCerrar?.();
                        }}
                    />
                </Suspense>
            )}
        </>
    );
}
