/**
 * El diálogo del QR para tomar la foto con el teléfono.
 *
 * ── Por qué es un archivo aparte y no vive dentro de `FileField` ────────────
 *
 * Porque `FileField` está en los 21 adjuntos del portal, y todo lo que importe
 * viaja en el cierre estático de CADA vista que adjunte algo — la use o no.
 * Con el diálogo adentro, `ModalShell` y el dibujante del QR se bajaban al
 * entrar a Bitácoras y a Bolsas aunque nadie apretara nunca el botón: medido
 * con `gate:bundle`, **+2 kB en Bitácoras y +3 kB en Bolsas**.
 *
 * Y el diálogo no se puede ver hasta que alguien aprieta, así que no hay ningún
 * motivo para que esté ahí antes. `FileField` lo carga por `lazy` en ese
 * momento; para cuando termina de bajar, la persona todavía está agarrando el
 * teléfono.
 *
 * `@zxing` —que es lo pesado de verdad— ya viajaba diferido dentro de
 * `QrDeCaptura`. Esto cierra el resto.
 */
import React from 'react';
import { X } from 'lucide-react';
import ModalShell from './ModalShell';
import QrDeCaptura from './QrDeCaptura';
import Button from './Button';
import { enlaceDeCaptura } from '../../data/capturaDeFoto';

/**
 * @param {{id: string, secreto: string, vence_el: string}} captura  la captura viva
 * @param {string}   etiqueta  el rótulo del adjunto, para decir QUÉ foto se espera
 * @param {function} alCerrar
 * @param {function} alRenovar pide un código nuevo cuando el anterior venció
 */
export default function DialogoDeCaptura({ captura, etiqueta, alCerrar, alRenovar }) {
    return (
        <ModalShell open onClose={alCerrar} maxWidthClass="max-w-sm"
            ariaLabel="Tomar la foto con el teléfono">
            <div className="p-5 pt-3 flex flex-col items-center gap-4">
                {/* Una salida EXPLÍCITA. Escape y el clic en el fondo ya cierran,
                    pero los dos son gestos que hay que saber: quien decide no
                    usar el teléfono se queda mirando un código sin ninguna
                    salida a la vista. */}
                <div className="w-full flex items-center justify-between gap-2">
                    <p className="min-w-0 text-body-sm font-black uppercase tracking-widest text-content-3">
                        Tomar con el teléfono
                    </p>
                    <Button variant="ghost" size="sm" icon={X} iconOnly
                        title="Cerrar" onClick={alCerrar} />
                </div>

                {/* Dice QUÉ foto se espera. Con el QR viviendo en cada adjunto,
                    una pantalla con seis documentos puede tener seis botones
                    iguales, y sin el rótulo no hay forma de saber cuál se abrió. */}
                <p className="text-label text-content-2 font-medium text-center leading-snug max-w-[260px]">
                    Escanea este código con la cámara del teléfono.
                    {etiqueta ? ` La foto de «${etiqueta}» va a aparecer aquí sola.` : ' La foto va a aparecer aquí sola.'}
                </p>

                <QrDeCaptura
                    enlace={enlaceDeCaptura(captura.secreto)}
                    venceEl={captura.vence_el}
                    alRenovar={alRenovar} />

                <Button variant="secondary" size="sm" onClick={alCerrar}>
                    Cerrar — la subo desde aquí
                </Button>
            </div>
        </ModalShell>
    );
}
