import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

/**
 * useFotoDelTelefono — el QR para mandar UNA foto desde el teléfono a esta
 * pantalla, para los sitios que no usan `FileField`.
 *
 * Nació el 2026-10-29 de un reporte de sala: «están solicitando descarte de un
 * producto por daño, pero no aparece para subir la foto desde el teléfono». El
 * QR vivía sólo en `FileField` (y escrito a mano en la ficha del empleado), así
 * que la tira de evidencia —descarte por daño, devolución, envío con daño,
 * apartado— y la foto del catálogo pedían la foto en una computadora que no
 * tiene cámara, sin ningún camino hacia el teléfono que sí la tiene.
 *
 * El circuito es el mismo de `FileField` (`capturaDeFoto.js`): abrir la
 * captura, pintar el QR, esperar la foto y soltar el buzón. Lo único que cambia
 * es qué se hace con el archivo, y eso lo decide quien llama en `alLlegar`.
 *
 * Desde el teléfono se pueden juntar varias hojas y llegan como UN PDF. Acá se
 * espera una foto, así que un PDF se rechaza con un aviso en vez de colarse en
 * un bucket que sólo acepta imágenes.
 *
 * @param {(file: File) => void} alLlegar  recibe la foto (siempre una imagen)
 * @param {{ etiqueta?: string, onError?: (msg: string) => void }} opciones
 * @returns {{ pedir: () => void, esperando: boolean, pidiendo: boolean, dialogo: React.ReactNode }}
 */
const traspaso = () => import('@nucleo/data/capturaDeFoto');
const DialogoDeCaptura = lazy(() => import('./DialogoDeCaptura'));

export default function useFotoDelTelefono(alLlegar, { etiqueta = '', onError } = {}) {
    const [captura, setCaptura] = useState(null);
    const [pidiendo, setPidiendo] = useState(false);
    // En refs: quien llama suele pasar flechas nuevas en cada render, y con
    // ellas en las dependencias el canal se volvería a abrir a cada tecla.
    const llegar = useRef(alLlegar);
    const avisar = useRef(onError);
    llegar.current = alLlegar;
    avisar.current = onError;

    const pedir = useCallback(async () => {
        setPidiendo(true);
        try {
            const { abrirCaptura } = await traspaso();
            const r = await abrirCaptura(null);
            if (!r.ok) { avisar.current?.(r.motivo); return; }
            avisar.current?.('');
            setCaptura(r);
        } catch {
            avisar.current?.('No se pudo abrir el código. Revisa tu conexión e intenta de nuevo.');
        } finally {
            setPidiendo(false);
        }
    }, []);

    useEffect(() => {
        if (!captura?.id) return undefined;
        let vivo = true;
        let dejarDeEscuchar = null;
        (async () => {
            const { esperarFoto, fotoComoArchivo, soltarCaptura } = await traspaso();
            if (!vivo) return;
            dejarDeEscuchar = esperarFoto(captura.id, async (urlFirmada) => {
                setCaptura(null);
                try {
                    const file = await fotoComoArchivo(urlFirmada, 'foto.jpg');
                    soltarCaptura(captura.id);
                    if (!file.type.startsWith('image/')) {
                        avisar.current?.('Llegaron varias fotos juntas. Mándalas de una en una desde el teléfono.');
                        return;
                    }
                    llegar.current(file);
                } catch {
                    avisar.current?.('La foto llegó pero no se pudo abrir. Intenta de nuevo desde el teléfono.');
                }
            });
        })();
        return () => { vivo = false; dejarDeEscuchar?.(); };
    }, [captura?.id]);

    const dialogo = captura ? (
        <Suspense fallback={null}>
            <DialogoDeCaptura captura={captura} etiqueta={etiqueta}
                alCerrar={() => setCaptura(null)} alRenovar={pedir} />
        </Suspense>
    ) : null;

    return { pedir, esperando: !!captura, pidiendo, dialogo };
}
