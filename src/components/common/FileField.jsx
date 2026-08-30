import React, { useRef, useState, useCallback, useEffect, memo, lazy, Suspense } from 'react';
import { UploadCloud, FileCheck2, Eye, X, Loader2, Camera, Smartphone } from 'lucide-react';
import ListRow from './ListRow';
import Button from './Button';
import useCoarsePointer from '../../hooks/useCoarsePointer';
import { PROPS_CAMARA, aceptaImagenes } from '../../utils/capturaDeFoto';
import { rotuloCampo } from '../../utils/rotuloDeCampo';
/* Los dos por `lazy`, y por el mismo motivo: este componente está en los 21
   adjuntos del portal, así que TODO lo que importe viaja en el cierre estático
   de cada vista que adjunte algo, la use o no.

   El editor arrastra `react-easy-crop`. El diálogo del QR arrastra `ModalShell`
   y el dibujante del código — medido con `gate:bundle`: incrustados costaban
   +2 kB en Bitácoras y +3 kB en Bolsas para algo que no se puede ver hasta que
   alguien aprieta un botón. */
const EditorDeDocumento = lazy(() => import('./EditorDeDocumento'));
const DialogoDeCaptura = lazy(() => import('./DialogoDeCaptura'));
/* El visor: mira el documento SIN salir de la pantalla, y desde ahí se puede
   recortar y enderezar lo que ya estaba guardado. Antes «Ver» abría una pestaña
   —que saca a la persona del formulario que estaba llenando— y arreglar un
   documento torcido pasaba por quitarlo y subirlo de nuevo. */
const VisorDeDocumento = lazy(() => import('./VisorDeDocumento'));
/* Y el módulo del traspaso también, por `await import()`. Es la misma cuenta:
   `abrirCaptura` no se llama hasta que alguien aprieta el botón, y `esperarFoto`
   no escucha nada hasta que hay un código vivo. Estáticos costaban 1 kB en cada
   vista que adjunta algo — medido con `gate:bundle`. */
const traspaso = () => import('../../data/capturaDeFoto');
/* Preguntar dónde está el papel dentro de la foto. Por `await import()` como
   todo lo demás: sólo corre cuando alguien eligió una imagen. */
const sugerencia = () => import('../../data/recorteSugerido');
/* La tubería automática: detectar las esquinas, enderezar, ajustar al papel y
   dar el acabado, sin preguntarle nada a nadie. */
const preparado = () => import('../../data/prepararDocumento');

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
    /* ── Las dos ayudas para adjuntar, y por qué vienen ENCENDIDAS ──────────
     *
     * `conTelefono` — el QR para tomar la foto con el teléfono.
     * `conEditor`   — recortar, enderezar y aclarar la imagen antes de subirla.
     *
     * Las dos nacieron el 27/28-ago pegadas a un sitio: el QR sólo estaba en la
     * foto del empleado y el editor sólo en el DUI, en la receta y en la
     * boleta. El pedido del usuario fue que salgan «en cualquier lugar donde
     * solicite documento a adjuntar», y de paso señaló el defecto exacto que
     * produce pegarlas a un sitio: *«en dui no está en su área, está por la
     * foto»* — el botón vivía junto al avatar, así que para adjuntar el DUI
     * había que ir a buscarlo a otra parte de la pantalla.
     *
     * Por eso viven ACÁ y por eso el default es `true`: son 21 adjuntos, y una
     * prop opt-in es una prop olvidada — ya pasó con `usarAccionDeFila`, que
     * quedó sin declarar en 16 de 59 tablas. Encendidas, cada adjunto las tiene
     * en SU área por construcción, y quien no las quiera lo dice y escribe por
     * qué.
     *
     * Ninguna de las dos se ofrece cuando no aplica: el QR sólo si el campo
     * acepta imágenes, y el editor sólo cuando lo elegido ES una imagen — un
     * PDF pasa derecho, ya viene encuadrado. */
    conTelefono = true,
    conEditor = true,
    // Qué forma tiene el papel, para el editor. `documento` sirve para todo;
    // los sitios que saben qué están recibiendo pasan el suyo (`dui`, `boleta`,
    // `receta`) y el recuadro nace con esa forma.
    tipoDeDocumento = 'documento',
    /* Cómo se llama este adjunto en el diálogo del QR. Cae en `label`, y existe
       para los sitios que dibujan su propio rótulo afuera —el DUI pinta «Frente»
       y «Reverso» por su cuenta— y por eso llegarían acá sin nombre: el diálogo
       diría «la foto va a aparecer aquí sola» sin decir CUÁL, que es la misma
       confusión que el usuario reportó con el botón de la foto de perfil. */
    etiquetaParaTelefono,
}) => {
    const inputRef = useRef(null);
    // La cámara va en un input APARTE del de archivos, no en el mismo con
    // `capture` agregado: ese atributo obliga a la cámara y dejaría sin camino
    // a quien tiene que adjuntar un PDF —la receta escaneada, el permiso—.
    // Dos inputs, dos caminos, y cada uno con su `accept`. El porqué de la
    // pareja `accept`+`capture` está en `capturaDeFoto.js`.
    const camaraRef = useRef(null);
    // Solo con el dedo. En escritorio `capture` se ignora y el botón abriría el
    // mismo diálogo de archivos que la fila: dos controles idénticos, uno
    // mintiendo. Misma regla que el selector de fechas (D3.12).
    const esTactil = useCoarsePointer();
    // Contador de profundidad: `dragleave` dispara también al pasar de la fila
    // a un hijo suyo, así que un booleano parpadea. Y va en un ref, no en
    // estado: `dragover` se dispara decenas de veces por segundo y actualizar
    // estado ahí sería re-renderizar todo el formulario mientras se arrastra.
    const profundidad = useRef(0);
    const [encima, setEncima] = useState(false);
    const [rechazo, setRechazo] = useState(null);
    // La imagen elegida, esperando que alguien la recorte. Vive entre «elegí un
    // archivo» y «se lo entrego al formulario»: cancelar acá deja el campo como
    // estaba, sin nada a medio guardar.
    const [porEditar, setPorEditar] = useState(null);
    /* ── Lo que el portal preparó solo ──────────────────────────────────────
     *
     * Pedido del usuario (2026-08-29): «al subir la foto, automáticamente
     * detectar las esquinas, cuadrar y mejorar perspectiva, aplicar filtro».
     * Antes eso era un TRABAJO —abrir el editor, esperar la propuesta,
     * confirmar—, y para quien adjunta seis documentos de un expediente son
     * seis diálogos que decir que sí. Un paso que siempre se confirma sin mirar
     * no protege nada.
     *
     * Se guarda la foto ORIGINAL y las esquinas detectadas para que «Ajustar»
     * reabra el editor donde estaba, en vez de volver a empezar. */
    const [preparando, setPreparando] = useState(false);
    const [preparado_, setPreparado] = useState(null);   // {original, esquinas, formato}
    const [ajustando, setAjustando] = useState(false);
    /* El recorte que propuso la lectura, si llegó a tiempo. Ver el efecto de
       más abajo: el editor NO espera por esto. */
    const [sugerido, setSugerido] = useState(null);
    // Que la lectura esté en vuelo es un dato de pantalla: el editor lo dice.
    const [buscandoRecorte, setBuscandoRecorte] = useState(false);
    // El código del QR vivo. Mientras exista, esta computadora está escuchando.
    const [captura, setCaptura] = useState(null);
    const [pidiendoQr, setPidiendoQr] = useState(false);

    const hayArchivo = !!file || !!url;

    const inactivo = disabled || busy;
    const traeArchivos = e => Array.from(e.dataTransfer?.types || []).includes('Files');

    const abrirSelector = useCallback(() => {
        if (!inactivo) inputRef.current?.click();
    }, [inactivo]);

    const abrirCamara = useCallback(() => {
        if (!inactivo) camaraRef.current?.click();
    }, [inactivo]);

    // Lo que sale del editor ya pasó por acá una vez, así que entrega directo:
    // volver a mandarlo a `aceptar` lo devolvería al editor en un bucle.
    const entregar = useCallback(archivo => {
        setRechazo(null);
        onChange?.(archivo);
    }, [onChange]);

    /**
     * @param {File} archivo
     * @param {{yaPreparado?: boolean}} [opciones]  `yaPreparado` = viene del
     *   teléfono, donde ya pasó por el editor: se valida y se entrega, sin
     *   volver a recortarlo. Ver el comentario del efecto que escucha la foto.
     */
    const aceptar = useCallback((archivo, { yaPreparado = false } = {}) => {
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
        /* Lo que ya se preparó no se vuelve a preparar. Ver el efecto de la
         * foto del teléfono: allá se recortó, se enderezó y se le dio el
         * acabado, y repetirlo acá es pedir dos veces el mismo trabajo. */
        if (yaPreparado) { onChange?.(archivo); return; }
        /* Una IMAGEN se prepara sola; un PDF va derecho. Recortar un PDF
         * exigiría rasterizarlo para no ganar nada: ya viene encuadrado.
         *
         * Si la lectura no encuentra las cuatro esquinas NO se inventa un
         * recorte: se abre el editor, como antes. Recortar por donde no va y
         * adjuntarlo sin decir nada es peor que pedir treinta segundos. */
        if (conEditor && archivo.type?.startsWith('image/')) {
            setSugerido(null);
            setPreparado(null);
            setPreparando(true);
            (async () => {
                let r = { ok: false };
                try {
                    const { prepararAutomatico } = await preparado();
                    r = await prepararAutomatico(archivo, tipoDeDocumento);
                } catch { /* abajo se abre el editor */ }
                setPreparando(false);
                if (r.ok) {
                    setPreparado({ original: archivo, esquinas: r.esquinas, formato: r.formato });
                    onChange?.(r.archivo);
                } else {
                    setPorEditar(archivo);
                }
            })();
            return;
        }
        onChange?.(archivo);
    }, [accept, maxSizeMB, onChange, conEditor, tipoDeDocumento]);

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
        setPreparado(null);
        onChange?.(null);
        if (inputRef.current) inputRef.current.value = '';
    }, [onChange]);

    const [viendo, setViendo] = useState(false);
    const ver = useCallback(e => {
        e.preventDefault(); e.stopPropagation();
        setViendo(true);
    }, []);

    /* ── El recorte que propone la lectura ──────────────────────────────────
     *
     * El editor abre YA, sin esperar: la respuesta tarda un segundo o dos y
     * mirar una pantalla en blanco mientras tanto es peor que encuadrar a mano.
     * Cuando llega, el editor se remonta con el recuadro puesto —su `key`
     * depende de la sugerencia— y quien estaba mirando ve el documento
     * encuadrado y derecho.
     *
     * Si no llega, o si en la foto no hay ningún documento reconocible, no pasa
     * nada: el editor sigue como siempre. Una ayuda que se cae no puede impedir
     * adjuntar un papel. */
    useEffect(() => {
        // Al ajustar algo que el portal ya preparó, las esquinas ya se conocen:
        // volver a preguntarlas cuesta una llamada y puede llegar una respuesta
        // distinta que le cambie el encuadre a quien vino justo a corregirlo.
        if (!porEditar || ajustando) return undefined;
        let vivo = true;
        setBuscandoRecorte(true);
        (async () => {
            const { buscarEsquinas } = await sugerencia();
            const r = await buscarEsquinas(porEditar);
            if (vivo) setBuscandoRecorte(false);
            // Se comprueba que siga siendo LA MISMA foto: alguien pudo cancelar
            // y elegir otra mientras la pregunta viajaba, y aplicar el recuadro
            // de la anterior sería recortar por donde no va.
            if (vivo && r) setSugerido(prev => (prev === null ? r : prev));
        })();
        return () => { vivo = false; setBuscandoRecorte(false); };
    }, [porEditar, ajustando]);

    // ── Tomar la foto con el teléfono ──────────────────────────────────────
    const cerrarCaptura = useCallback(() => setCaptura(null), []);

    const pedirFotoAlTelefono = useCallback(async () => {
        setPidiendoQr(true);
        try {
            const { abrirCaptura } = await traspaso();
            const r = await abrirCaptura(null);
            if (!r.ok) { setRechazo(r.motivo); return; }
            setRechazo(null);
            setCaptura(r);
        } catch {
            // Si el trozo no baja —una red que se cortó justo, un despliegue en
            // curso— hay que DECIRLO. Un botón que se aprieta y no hace nada es
            // indistinguible de uno roto.
            setRechazo('No se pudo abrir el código. Revisa tu conexión e intenta de nuevo.');
        } finally {
            setPidiendoQr(false);
        }
    }, []);

    useEffect(() => {
        if (!captura?.id) return undefined;
        let vivo = true;
        let dejarDeEscuchar = null;
        (async () => {
            const { esperarFoto, fotoComoArchivo } = await traspaso();
            // Se pudo cerrar el diálogo mientras bajaba el trozo. Sin esta
            // guarda quedaría un canal escuchando a una captura que ya no
            // existe, y su limpieza nunca correría.
            if (!vivo) return;
            dejarDeEscuchar = esperarFoto(captura.id, async (urlFirmada) => {
                setCaptura(null);
                try {
                    /* ── Ya viene lista: NO se vuelve a preparar ─────────────
                     *
                     * Hasta hoy entraba por el camino de siempre —editor
                     * incluido— y ese comentario era cierto cuando el teléfono
                     * sólo disparaba la cámara. Desde que el teléfono tiene su
                     * propio editor (v2.842.0), la foto llega recortada,
                     * enderezada y con su acabado: volver a abrir el editor en
                     * la computadora es pedir dos veces el mismo trabajo, y
                     * encima sobre una foto que ya se recortó.
                     *
                     * Lo reportó el usuario: «tomé la foto desde el teléfono, la
                     * edité, apliqué filtro, y en la computadora volvió a
                     * pedirlo».
                     *
                     * Y no hay caso en que llegue SIN editar: en el teléfono la
                     * foto sólo se manda desde el `onConfirm` del editor —
                     * cancelar no manda nada. */
                    aceptar(await fotoComoArchivo(urlFirmada, 'foto.jpg'), { yaPreparado: true });
                } catch {
                    // La foto SÍ se subió; lo que falló es traerla. Se dice, en
                    // vez de cerrar el diálogo como si nada hubiera pasado.
                    setRechazo('La foto llegó pero no se pudo abrir. Intenta de nuevo desde el teléfono.');
                }
            });
        })();
        return () => { vivo = false; dejarDeEscuchar?.(); };
    }, [captura?.id, aceptar]);

    const peso = file ? formatearPeso(file.size) : null;

    // Con archivo puesto no se ofrece: para cambiarlo está "Quitar", igual que
    // pasa con "Elegir". Un segundo camino de reemplazo escondido detrás de un
    // botón que sigue ahí sería un clic que pisa evidencia ya adjuntada.
    const ofreceCamara = esTactil && !hayArchivo && !inactivo && aceptaImagenes(accept);

    // El QR es el gemelo de escritorio de «Tomar foto»: en el teléfono ya está
    // la cámara ahí mismo y ofrecer un código para escanearse a sí mismo sería
    // ofrecer un rodeo. Mismo criterio que la cámara para lo demás — sólo si el
    // campo acepta imágenes y no hay nada adjunto todavía.
    const ofreceTelefono = conTelefono && !esTactil && !hayArchivo && !inactivo && aceptaImagenes(accept);

    // El texto de ayuda se DERIVA del límite en vez de escribirse aparte.
    // `FormPharmacovigilance` decía "Máx 5MB" mientras el código rechazaba a
    // los 10 MB: dos fuentes de verdad para el mismo número, y la que ve el
    // usuario era la equivocada.
    const ayuda = hint || (maxSizeMB
        ? `Suéltalo aquí o haz clic · máx ${maxSizeMB} MB`
        : 'Suéltalo aquí o haz clic');

    return (
        <div className={`w-full ${className}`}
            onDragEnter={alEntrar} onDragOver={alPasar}
            onDragLeave={alSalir} onDrop={alSoltar}>

            {label && (
                <label className={rotuloCampo('text-content-3')}>
                    {label}
                </label>
            )}

            {/* ── Lo que el portal hizo solo, DICHO y con vuelta atrás ───────
                Un recorte automático que nadie mira sería peor que uno manual;
                lo que lo vuelve aceptable es que se vea qué pasó y que corregir
                cueste un toque. Por eso esto no es un aviso que se va: queda
                mientras el archivo esté puesto. */}
            <ListRow
                density={density}
                disabled={disabled || busy}
                // Con archivo cargado la fila NO es un botón: lleva "Ver" y
                // "Quitar" adentro, y un botón dentro de otro botón es HTML
                // inválido —el navegador desarma el marcado y el clic queda
                // impredecible—. `ListRow` ya resuelve esto solo: sin `onClick`
                // se dibuja como `div`.
                onClick={(hayArchivo || busy || preparando) ? undefined : abrirSelector}
                icon={(busy || preparando) ? Loader2 : (hayArchivo ? FileCheck2 : UploadCloud)}
                iconClass={(busy || preparando) ? 'text-brand-text animate-spin'
                    : (hayArchivo ? 'text-success' : VACIO[emptyState].icono)}
                iconBoxClass={(busy || preparando) ? 'bg-brand/10 border-brand/20'
                    : (hayArchivo ? 'bg-success/12 border-success/25' : VACIO[emptyState].caja)}
                title={preparando ? 'Recortando y enderezando el documento…'
                    : busy ? busyLabel
                    : (file ? file.name
                        : (url ? (name || 'Documento guardado') : VACIO[emptyState].titulo))}
                subtitle={(busy || preparando) ? null : (peso || (hayArchivo ? null : ayuda))}
                trailing={(busy || preparando) ? null : hayArchivo ? (
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

            {ofreceCamara && (
                <Button
                    variant="secondary" size="md" icon={Camera}
                    onClick={abrirCamara}
                    className="w-full mt-2"
                >
                    Tomar foto
                </Button>
            )}

            {/* El gemelo de escritorio. Va DEBAJO de este adjunto y no en otra
                parte de la pantalla: el usuario lo señaló mirando el DUI —«en
                dui no está en su área, está por la foto»—. Un botón que sirve
                para este campo tiene que estar en este campo. */}
            {ofreceTelefono && (
                <Button
                    variant="secondary" size="md" icon={Smartphone}
                    onClick={pedirFotoAlTelefono}
                    disabled={pidiendoQr || !!captura}
                    loading={pidiendoQr}
                    className="w-full mt-2"
                >
                    {captura ? 'Esperando el teléfono…' : 'Tomar con el teléfono'}
                </Button>
            )}

            {captura && (
                <Suspense fallback={null}>
                    <DialogoDeCaptura
                        captura={captura}
                        etiqueta={etiquetaParaTelefono || (typeof label === 'string' ? label : '')}
                        alCerrar={cerrarCaptura}
                        alRenovar={pedirFotoAlTelefono} />
                </Suspense>
            )}

            {/* Recortar antes de entregar. `entregar` y no `aceptar`: lo que
                sale del editor ya pasó por la validación, y volver a mandarlo
                allí lo devolvería al editor en un bucle. */}
            {viendo && (
                <Suspense fallback={null}>
                    <VisorDeDocumento
                        url={url}
                        file={file}
                        nombre={file?.name || name || 'Documento'}
                        tipo={tipoDeDocumento}
                        alCerrar={() => setViendo(false)}
                        // Lo corregido entra por el MISMO `onChange` que una
                        // subida nueva: el formulario lo sube por su camino de
                        // siempre y no hay una segunda forma de guardar.
                        onEditado={conEditor ? entregar : undefined}
                    />
                </Suspense>
            )}

            {porEditar && (
                <Suspense fallback={null}>
                    <EditorDeDocumento
                        /* SIN `key` que dependa de la sugerencia.
                           La tenía, y remontaba el editor cuando la respuesta
                           llegaba — o sea que si alguien ya estaba ajustando el
                           recorte, su trabajo se perdía y la forma cambiaba sola
                           debajo de la mano. Lo reportó el usuario ajustando una
                           foto que había mandado desde el teléfono.
                           Ahora la sugerencia viaja como prop y el editor decide
                           si aplicarla: sólo si nadie tocó nada. */
                        tipo={tipoDeDocumento}
                        file={porEditar}
                        // Que la espera SE VEA: el editor abre antes de que la
                        // lectura conteste, y sin decirlo parece terminado.
                        analizando={!sugerido && !ajustando && buscandoRecorte}
                        recuadro={sugerido?.recuadro || null}
                        giroSugerido={ajustando ? 0 : (sugerido?.giro || 0)}
                        /* Las esquinas del papel — sin esto el enderezado de
                           perspectiva NUNCA corría desde un adjunto. La lectura
                           las devolvía, el editor sabía usarlas, y acá se
                           perdían: una función entera muerta sin dar error, que
                           es exactamente por qué «lo de las esquinas no
                           funciona del todo bien». */
                        /* Al ajustar algo YA preparado, las esquinas son las que
                           se detectaron —y ya vienen giradas—: reabrir en el
                           encuadre por defecto sería hacer perder el trabajo que
                           el portal ya hizo bien. */
                        esquinas={ajustando ? preparado_?.esquinas : (sugerido?.esquinas || null)}
                        onCancel={() => { setPorEditar(null); setSugerido(null); setAjustando(false); }}
                        onConfirm={(listo) => {
                            setPorEditar(null); setSugerido(null); setAjustando(false);
                            entregar(listo);
                        }}
                    />
                </Suspense>
            )}

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

            {/* El de la cámara. `aceptar` es el mismo de arriba: la foto pasa
                por el mismo límite de tamaño y la misma validación de tipo que
                un archivo elegido a mano. */}
            <input
                ref={camaraRef}
                type="file"
                {...PROPS_CAMARA}
                disabled={inactivo}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; aceptar(f); }}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
            />

            {preparado_ && hayArchivo && !preparando && (
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <p className="text-micro text-content-3 font-medium leading-snug">
                        {preparado_.formato?.seguro
                            /* El nombre del papel SÓLO cuando no hay duda: un
                               oficio de pie y una cédula parada se llevan un
                               3.6 %, y nombrar mal se lee como que el portal
                               entendió el documento. */
                            ? `Recortado y enderezado · tamaño ${preparado_.formato.nombre.toLowerCase()} ${preparado_.formato.orientacion}`
                            : 'Recortado y enderezado automáticamente'}
                    </p>
                    <button type="button"
                        onClick={() => { setAjustando(true); setSugerido(null); setPorEditar(preparado_.original); }}
                        className="text-micro font-black text-brand-text underline
                                   min-h-[var(--tap-min)] px-1">
                        Ajustar
                    </button>
                </div>
            )}

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
