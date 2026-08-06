import React, { useRef, useState, useCallback, memo } from 'react';
import { UploadCloud, FileCheck2, Eye, X, Loader2 } from 'lucide-react';
import ListRow from './ListRow';
import { openStoredFile } from '../../utils/storageFiles';

/**
 * FileField — adjuntar un archivo a un formulario.
 *
 * Canónico creado el 2026-07-27 (decisión 2c). Hay 21 inputs de archivo en el
 * portal y **ninguno se ve como el control nativo**: todos lo esconden y le
 * dibujan encima su propia envoltura. Ese era justamente el problema — no el
 * botón gris del navegador, sino que cada formulario resolvió lo mismo a su
 * manera y quedaron **ocho envolturas distintas** para una sola idea: caja
 * punteada de 112px, caja de 28px, fila con acciones, `<label>` centrado con
 * ícono de 48px, y así.
 *
 * (Al medirlo la primera vez conté "10 nativos visibles" porque busqué las
 * clases `hidden`/`sr-only` y el truco más usado acá es `opacity-0
 * absolute inset-0`, que también esconde el control. El diagnóstico cambió;
 * la conclusión —falta un canónico— no.)
 *
 * Por qué la forma de FILA y no una zona de arrastre grande: en estos
 * formularios —expediente de empleado, documentos de sucursal— el archivo casi
 * siempre **ya está**, y lo que más se hace es verlo o reemplazarlo. Una caja
 * punteada de 120px optimiza el caso menos frecuente, y en un formulario con
 * seis adjuntos deja una pared de cajas.
 *
 * Pero se arrastra igual. Arrastrar no necesita una caja grande, necesita un
 * blanco válido y una señal clara de que lo es — y eso la fila lo puede dar.
 *
 * Sobre "saber si trae un archivo": el navegador no deja leer el contenido de
 * lo que se arrastra hasta que se suelta (por seguridad), pero sí expone los
 * TIPOS durante el arrastre. Así que la fila se ilumina cuando lo que viene son
 * archivos y **se queda quieta si es texto o un link** — que es la diferencia
 * que importa. Y si el archivo no es de un tipo aceptado, lo dice al soltarlo
 * en vez de tragárselo en silencio.
 */

const formatearPeso = bytes => {
    if (!Number.isFinite(bytes)) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// `accept` viene en el mismo formato que el input nativo ("image/*,.pdf"), así
// que la validación al soltar tiene que entender las dos formas: comodín de
// MIME y extensión.
const aceptaArchivo = (archivo, accept) => {
    if (!accept) return true;
    const nombre = (archivo.name || '').toLowerCase();
    const tipo = (archivo.type || '').toLowerCase();
    return accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(regla => {
        if (regla.startsWith('.')) return nombre.endsWith(regla);
        if (regla.endsWith('/*')) return tipo.startsWith(regla.slice(0, -1));
        return tipo === regla;
    });
};

// Literales, no plantilla: Tailwind escanea texto (misma nota que en Badge).
const VACIO = {
    neutral: { icono: 'text-brand-text', caja: 'bg-brand/10 border-brand/20',       titulo: 'Elegir o arrastrar archivo' },
    pending: { icono: 'text-warning',    caja: 'bg-warning/10 border-warning/25',   titulo: 'Documento pendiente' },
    missing: { icono: 'text-danger',     caja: 'bg-danger/10 border-danger/30',     titulo: 'Falta el documento' },
};

const FileField = memo(({
    label,
    file,
    url,
    // Nombre del archivo YA guardado en el servidor. Sin esto la fila decía
    // "Documento guardado" y perdía el nombre real, que varios formularios ya
    // mostraban (`EmployeeFormModal` guarda `file_name` justamente para eso).
    // Un expediente con seis adjuntos donde los seis dicen lo mismo no sirve.
    name,
    onChange,
    accept,
    // `maxSizeMB` no es una prop inventada: `FormPharmacovigilance` ya validaba
    // 10 MB a mano dentro de su `onChange`, y era el único de los 21 que lo
    // hacía. Subir un archivo de 40 MB y que el error aparezca recién al
    // guardar es peor que rechazarlo acá.
    maxSizeMB,
    hint,
    // Qué significa que esté vacío. No es decoración: en sucursales un
    // documento faltante es un requisito legal sin cumplir (naranja), y en
    // `FormAddCustomDocument` editando un registro que ya existe es un error
    // que bloquea (rojo). Los dos formularios ya codificaban eso con color, y
    // unificar borrando la distinción habría sido perder un dato a cambio de
    // consistencia — que es justo lo que no hay que hacer.
    //   'neutral'  todavía no se subió, y está bien
    //   'pending'  falta y debería estar
    //   'missing'  falta y eso es un error
    emptyState = 'neutral',
    // Estado "trabajando". No es adorno: `EmployeeFormModal` sube el documento
    // y lo manda a analizar con IA en el mismo paso ("Subiendo y analizando…"),
    // y `EmployeeRequestsView` sube apenas se elige el archivo. En los dos, sin
    // esta señal la fila se queda muda varios segundos y el usuario vuelve a
    // hacer clic. Bloquea la interacción mientras dura, que es lo que hacían
    // los dos a mano.
    busy = false,
    busyLabel = 'Subiendo…',
    disabled = false,
    density = 'md',
    className = '',
}) => {
    const inputRef = useRef(null);
    // Contador de profundidad: `dragleave` dispara también al pasar de la fila
    // a un hijo suyo, así que un booleano parpadea. Y va en un ref, no en
    // estado: `dragover` se dispara decenas de veces por segundo y actualizar
    // estado ahí sería re-renderizar todo el formulario mientras se arrastra.
    const profundidad = useRef(0);
    const [encima, setEncima] = useState(false);
    const [rechazo, setRechazo] = useState(null);

    const hayArchivo = !!file || !!url;

    const inactivo = disabled || busy;
    const traeArchivos = e => Array.from(e.dataTransfer?.types || []).includes('Files');

    const abrirSelector = useCallback(() => {
        if (!inactivo) inputRef.current?.click();
    }, [inactivo]);

    const aceptar = useCallback(archivo => {
        if (!archivo) return;
        if (!aceptaArchivo(archivo, accept)) {
            setRechazo(`Ese archivo no es válido (se acepta ${accept})`);
            return;
        }
        if (maxSizeMB && archivo.size > maxSizeMB * 1024 * 1024) {
            setRechazo(`El archivo pesa ${formatearPeso(archivo.size)} y el máximo son ${maxSizeMB} MB`);
            return;
        }
        setRechazo(null);
        onChange?.(archivo);
    }, [accept, maxSizeMB, onChange]);

    const alEntrar = useCallback(e => {
        if (inactivo || !traeArchivos(e)) return;
        e.preventDefault();
        profundidad.current += 1;
        if (profundidad.current === 1) setEncima(true);
    }, [inactivo]);

    const alSalir = useCallback(e => {
        if (inactivo || !traeArchivos(e)) return;
        e.preventDefault();
        profundidad.current = Math.max(0, profundidad.current - 1);
        if (profundidad.current === 0) setEncima(false);
    }, [inactivo]);

    // Sin `preventDefault` acá el navegador nunca dispara `drop` — abre el
    // archivo en una pestaña nueva y el formulario se pierde. Es el error
    // clásico de drag & drop y por eso no lleva ninguna condición de más.
    const alPasar = useCallback(e => {
        if (inactivo || !traeArchivos(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }, [inactivo]);

    const alSoltar = useCallback(e => {
        if (inactivo || !traeArchivos(e)) return;
        e.preventDefault();
        profundidad.current = 0;
        setEncima(false);
        aceptar(e.dataTransfer.files?.[0]);
    }, [inactivo, aceptar]);

    const limpiar = useCallback(e => {
        e.preventDefault(); e.stopPropagation();
        setRechazo(null);
        onChange?.(null);
        if (inputRef.current) inputRef.current.value = '';
    }, [onChange]);

    const ver = useCallback(e => {
        e.preventDefault(); e.stopPropagation();
        if (file) window.open(URL.createObjectURL(file), '_blank', 'noopener');
        else if (url) openStoredFile(url);
    }, [file, url]);

    const peso = file ? formatearPeso(file.size) : null;

    // El texto de ayuda se DERIVA del límite en vez de escribirse aparte.
    // `FormPharmacovigilance` decía "Máx 5MB" mientras el código rechazaba a
    // los 10 MB: dos fuentes de verdad para el mismo número, y la que ve el
    // usuario era la equivocada.
    const ayuda = hint || (maxSizeMB
        ? `Soltalo acá o hacé clic · máx ${maxSizeMB} MB`
        : 'Soltalo acá o hacé clic');

    return (
        <div className={`w-full ${className}`}
            onDragEnter={alEntrar} onDragOver={alPasar}
            onDragLeave={alSalir} onDrop={alSoltar}>

            {label && (
                <label className="block text-caption font-black uppercase tracking-[0.15em] text-content-3 ml-1 mb-1.5">
                    {label}
                </label>
            )}

            <ListRow
                density={density}
                disabled={disabled || busy}
                // Con archivo cargado la fila NO es un botón: lleva "Ver" y
                // "Quitar" adentro, y un botón dentro de otro botón es HTML
                // inválido —el navegador desarma el marcado y el clic queda
                // impredecible—. `ListRow` ya resuelve esto solo: sin `onClick`
                // se dibuja como `div`.
                onClick={(hayArchivo || busy) ? undefined : abrirSelector}
                icon={busy ? Loader2 : (hayArchivo ? FileCheck2 : UploadCloud)}
                iconClass={busy ? 'text-brand-text animate-spin'
                    : (hayArchivo ? 'text-success' : VACIO[emptyState].icono)}
                iconBoxClass={busy ? 'bg-brand/10 border-brand/20'
                    : (hayArchivo ? 'bg-success/12 border-success/25' : VACIO[emptyState].caja)}
                title={busy ? busyLabel
                    : (file ? file.name
                        : (url ? (name || 'Documento guardado') : VACIO[emptyState].titulo))}
                subtitle={busy ? null : (peso || (hayArchivo ? null : ayuda))}
                trailing={busy ? null : hayArchivo ? (
                    <>
                        <button type="button" onClick={ver} title="Ver archivo"
                            className="w-8 h-8 rounded-btn flex items-center justify-center text-content-3
                                hover:text-brand-text hover:bg-surface-card-hover transition-colors duration-[var(--dur-base)]">
                            <Eye size={15} strokeWidth={2.5} />
                        </button>
                        {!disabled && (
                            <button type="button" onClick={limpiar} title="Quitar archivo"
                                className="w-8 h-8 rounded-btn flex items-center justify-center text-content-3
                                    hover:text-danger-text hover:bg-danger/10 transition-colors duration-[var(--dur-base)]">
                                <X size={15} strokeWidth={2.5} />
                            </button>
                        )}
                    </>
                ) : (
                    <span className="text-micro font-black uppercase tracking-widest text-brand-text pr-1">
                        Elegir
                    </span>
                )}
                // El resaltado del arrastre es un aro, no un cambio de fondo:
                // el fondo ya codifica "tiene archivo / no tiene", y pisarlo
                // mientras se arrastra borraría justo el dato que hace falta
                // para saber si se está por reemplazar algo.
                className={encima
                    ? 'ring-2 ring-brand/45 border-brand/40'
                    : ''}
            />

            <input
                ref={inputRef}
                type="file"
                accept={accept}
                disabled={inactivo}
                // Se limpia el valor SIEMPRE, apenas se leyó el archivo. Sin
                // esto, elegir un archivo, quitarlo y volver a elegir el mismo
                // no dispara nada: el input conserva el valor anterior y el
                // navegador no considera que haya cambiado. Varios formularios
                // lo parchaban desde afuera con un ref (`fileInputRef.current
                // .value = ''`); resolverlo acá los deja sin ese trabajo.
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; aceptar(f); }}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
            />

            {rechazo && (
                <p role="status" className="mt-1.5 ml-1 text-label font-bold text-danger-text">
                    {rechazo}
                </p>
            )}
        </div>
    );
});

FileField.displayName = 'FileField';

export default FileField;
