import React, { useEffect, useState } from 'react';
import { RectangleHorizontal, RectangleVertical } from 'lucide-react';
import Notice from '../../components/common/Notice';
import { FORMATOS_DE_IMAGEN, revisarMedidaDeImagen } from '@nucleo/utils/ofertasClientes';

/**
 * El formato correcto de una imagen para la app, y si la que se eligió lo
 * cumple (2026-10-07). Lo usan las historias (vertical, como un estado) y los
 * banners (horizontal, arriba del catálogo). Mide la imagen en el navegador
 * antes de subirla: una foto con otra forma se recorta en el teléfono y lo
 * importante puede quedar afuera.
 */
// Los números y la regla salen del núcleo (`ofertasClientes`), los mismos que
// usa la app; acá sólo se le pone el ícono.
const ICONOS = { historia: RectangleVertical, banner: RectangleHorizontal };

export default function FormatoImagen({ tipo, archivo }) {
    const f = FORMATOS_DE_IMAGEN[tipo];
    const [medida, setMedida] = useState(null);
    useEffect(() => {
        if (!archivo) { setMedida(null); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- sin archivo no hay medida
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => setMedida({ ancho: img.naturalWidth, alto: img.naturalHeight });
        img.onerror = () => setMedida(null);
        img.src = url;
        return () => URL.revokeObjectURL(url);
    }, [archivo]);

    const Icono = ICONOS[tipo];
    const { formaMal, chica } = revisarMedidaDeImagen(tipo, medida);

    return (
        <div className="space-y-2">
            <div className="flex items-start gap-3 rounded-xl border border-border-subtle px-3 py-2.5">
                <Icono size={18} className="text-content-3 shrink-0 mt-0.5" />
                <div className="text-caption text-content-2 space-y-0.5">
                    <p><b className="text-content">Formato de {f.nombre.toLowerCase()}:</b> {f.ancho} × {f.alto} px ({f.proporcion}), JPG, PNG o WebP, hasta 3 MB.</p>
                    <p className="text-content-3">{f.zona}</p>
                </div>
            </div>
            {medida && (formaMal || chica) && (
                <Notice variant="warning">
                    Esta imagen mide {medida.ancho} × {medida.alto} px.
                    {formaMal ? ` No tiene la forma de ${f.nombre.toLowerCase()} (${f.proporcion}): en la app se va a recortar.` : ''}
                    {chica ? ' Es pequeña: puede verse borrosa.' : ''}
                </Notice>
            )}
            {medida && !formaMal && !chica && (
                <p className="text-caption text-success-text">✓ {medida.ancho} × {medida.alto} px: tiene el formato correcto.</p>
            )}
        </div>
    );
}
