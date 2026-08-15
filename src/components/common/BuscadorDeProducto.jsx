import React, { useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import SearchInput from './SearchInput';
import ListRow from './ListRow';
import { SkeletonText } from './StateViews';
import { HerramientasModal } from '../../views/dashboard/LanzadorSolicitud';
import { buscarProductosMinMax } from '../../data/minmaxRequests';

// Elegir un producto del catálogo, para un formulario que empieza por ahí.
//
// ── Por qué existe ────────────────────────────────────────────────────────
// Vivía dentro de `WidgetMinMaxRequest`, y el 2026-08-15 hizo falta un segundo:
// pedirle producto a otra sala desde Solicitudes empieza igual —hay que decir
// cuál—, y hasta entonces ese formulario sólo podía abrirse desde la consulta de
// inventario, con el producto ya elegido. Ésa era, textualmente, la razón
// escrita en `familiasOperativas` para dejar el traslado fuera de «Nueva
// solicitud»: «sin ese producto no tiene primera pantalla».
//
// Se extrajo en vez de copiarse porque acá lo que se comparte no es el dibujo
// sino tres decisiones medidas que un copiar/pegar pierde en la primera
// corrección que se aplique a un solo lado:
//
//  · **150 ms de debounce, medidos** — no un número redondo. Con 250 ms el A/B
//    daba PEOR que bajarse el catálogo entero (mín 504 ms contra 394); a 150
//    empata en reloj y se queda con lo demás: una petición en vez de seis, unos
//    kB en vez de ~1,4 MB. Es más corto que sus hermanos (300 ms en Ajuste de
//    Inventario, 380 en la Consulta) a propósito: acá la respuesta son 20 filas
//    de texto, no la existencia de siete salas.
//  · **Dos letras de piso**, y con menos no se limpia la pantalla a medias: se
//    vuelve al estado de invitación.
//  · **El buscador va ABIERTO**, no plegado detrás de una lupa. Reportado el
//    2026-08-07: en una pantalla cuyo único trabajo es buscar, el control
//    plegado obliga a descubrirlo antes de poder empezar.
//
// El RPC es `buscar_productos_minmax` —el nombre quedó de dónde nació— y busca
// en TODO el catálogo activo: no tiene nada de Min/Max adentro.
//
// @param onElegir     Recibe la fila cruda del catálogo:
//                     `{ id, nombre, foto_url, principio_activo, laboratorio_nombre }`.
//                     El `id` es el del producto en el sistema de origen.
// @param invitacion   `{ icono, texto }` — lo que se ve antes de escribir. Cada
//                     pantalla dice para qué está buscando; un texto genérico
//                     no ayuda a nadie.
export default function BuscadorDeProducto({
    onElegir, placeholder, invitacion, accentColor = 'var(--brand)',
}) {
    const [search,  setSearch]  = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) { setResults([]); setLoading(false); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- limpia resultados cuando la búsqueda es muy corta
        let cancelado = false;
        setLoading(true);
        const t = setTimeout(async () => {
            const { filas } = await buscarProductosMinMax(q, 20);
            if (cancelado) return;
            setResults(filas);
            setLoading(false);
        }, 150);
        return () => { cancelado = true; clearTimeout(t); };
    }, [search]);

    const corto = search.trim().length < 2;
    const IconoInvitacion = invitacion?.icono ?? Package;

    return (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
            <HerramientasModal>
                <SearchInput accentColor={accentColor} value={search} onChange={setSearch}
                    placeholder={placeholder} />
            </HerramientasModal>

            <div className="flex-1 overflow-y-auto overscroll-contain space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {loading && <div className="flex justify-center py-8"><SkeletonText lines={4} className="w-full max-w-md" /></div>}

                {!loading && !corto && results.length === 0 && (
                    <div className="py-8 text-center text-body-sm text-content-3 font-medium">
                        Sin resultados para &quot;{search}&quot;
                    </div>
                )}

                {!loading && corto && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-content-3">
                        <IconoInvitacion size={28} strokeWidth={1.5} />
                        <p className="text-body-sm font-semibold text-content-3 text-center px-4">
                            {invitacion?.texto ?? 'Busca un producto'}
                        </p>
                    </div>
                )}

                {!loading && results.map(p => (
                    <ListRow
                        key={p.id}
                        onClick={() => onElegir(p)}
                        leading={p.foto_url
                            ? <img src={p.foto_url} alt="" className="w-full h-full object-contain" />
                            : <Package size={14} className="text-content-3" strokeWidth={2} />}
                        iconBoxClass="bg-surface-card-hover border-border-card overflow-hidden"
                        className="border-divider bg-surface-card hover:border-brand/40"
                        title={p.nombre}
                    >
                        {p.principio_activo && <span className="block text-micro text-success-text font-semibold truncate">{p.principio_activo}</span>}
                        {p.laboratorio_nombre && <span className="block text-micro text-content-3 truncate">{p.laboratorio_nombre}</span>}
                    </ListRow>
                ))}
            </div>
        </div>
    );
}
