import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useComposicionTraslado } from '../store/composicionTraslado';
import { fetchPresentaciones } from '../data/inventoryMovements';
import { crearSolicitudTraslado, fetchDondeHay, fetchEsAntibiotico } from '../data/traslados';
import { fetchInventoryByProductIds } from '../data/inventory';
import { lotesEnUnidades, repartirPedido } from '../utils/unidadesInventario';
import { opcionesDePresentacion } from '../utils/presentacion';
import { ERP_NAMES as NOMBRE_SALA, BRANCH_A_ERP as MI_ERP_POR_BRANCH } from '../constants/erp';
import { avisosDelPedido, claveOrigen, diasHasta, fmtVence } from '../utils/pedirTraslado';

// ═══════════════════════════════════════════════════════════════════════════
// Pedir un producto a otra sala — el estado y las reglas, sin pantalla.
//
// Es TODO lo que hacía `PedirTrasladoModal` salvo dibujar: qué salas lo
// tienen, sus lotes, las presentaciones, si lleva receta, el aviso de
// vencimiento, el reparto por lote, el renglón armado, la composición de
// varias salas y el envío. La web y la app del teléfono lo usan igual, así
// que las dos mandan la misma solicitud por construcción y no por copia.
// Lo único que queda en cada pantalla es la forma: pestañas, qué renglón está
// abierto, el atajo de un solo producto.
//
// `alCerrar` / `alTerminar`: lo que la pantalla hace al agregar-y-volver y al
// terminar de enviar. Los comentarios de abajo son los del modal original.
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @param {{ productoInicial?: any, alCerrar?: () => void, alTerminar?: () => void }} [opciones]
 */
export function usePedirTraslado({ productoInicial = null, alCerrar, alTerminar } = {}) {
    const { user } = useAuth();
    /* Lo elegido en el primer paso, cuando hubo primer paso. La fila del
       catálogo trae `{ id, nombre }` y el resto del archivo habla de
       `{ erp_product_id, descripcion }`: se traduce acá, en el borde, y no en
       cada uno de los cinco sitios que lo leen. */
    /* Arranca en el producto con el que abrieron, cuando abrieron con uno.
     *
     * Antes era `productoInicial ?? elegido`, y eso hacía imposible SOLTARLO:
     * poner `elegido` en null no cambiaba nada porque el inicial seguía ganando.
     * Con el compositor eso es justo lo que hay que poder hacer —agregar el
     * renglón y volver al buscador por el siguiente—, así que el inicial es
     * ahora el valor con el que nace el estado y no una capa por encima. */
    const [elegido, setElegido] = useState(productoInicial ?? null);
    const producto = elegido;

    /* ── Los renglones ya agregados VIVEN FUERA de este modal ─────────────
     *
     * Una sola composición, varias solicitudes. Pedido del usuario:
     *
     *   «yo en salud 4 solicito eutirox 100 a salud 1, salud 2 y salud 3,
     *    cantidades distintas, lo hago en la misma solicitud, pero al darle en
     *    solicitar se envían como solicitudes separadas, así que cada sucursal
     *    ve solo lo de cada uno»
     *
     * Cada renglón lleva SU sala, así que los dos casos salen de la misma
     * lista: un producto a tres salas, o tres productos a una. Al enviar se
     * agrupan por estante de origen y sale una solicitud por grupo.
     *
     * Por qué no una fila con varios orígenes: todo lo que hay debajo está
     * clavado a UN origen —el RLS que decide quién la ve, la cascada del
     * aprobador, el aviso, la sala de respaldo, el documento del sistema (uno
     * por origen, con su número de vale) y el freno de duplicados—. Y una sola
     * fila haría que Salud 2 vea adentro de su solicitud los renglones de
     * Salud 3.
     *
     * ⚠️ Y por qué en un STORE y no acá: agregar un producto CIERRA este modal
     * para volver a la consulta de inventario a elegir el siguiente (pedido del
     * usuario, 2026-08-20). Con la lista adentro, cerrarlo la borraría. Ver
     * `store/composicionTraslado.js`. */
    const renglones   = useComposicionTraslado(s => s.renglones);
    const causa       = useComposicionTraslado(s => s.causa);
    const setCausa    = useComposicionTraslado(s => s.setCausa);
    const agregarAlStore = useComposicionTraslado(s => s.agregar);
    const quitarDelStore = useComposicionTraslado(s => s.quitar);
    const editarEnStore  = useComposicionTraslado(s => s.editar);
    const limpiarStore   = useComposicionTraslado(s => s.limpiar);

    /* Con cuántas salas terminó, para poder decirlo al cerrar. Se guarda al
     * enviar porque para entonces el formulario ya se vació. */
    const [resumen, setResumen] = useState(null);

    /* ── Las dos mitades del compositor, como en Ajuste de Inventario ──────
     *
     * Reportado por el usuario el 2026-08-20: «al darle en agregar y seguir, no
     * me gusta dónde me lleva, no debería regresar al listado completo».
     *
     * Lo que pasaba: agregar devolvía al buscador con su invitación a pantalla
     * completa —«busca el producto que necesitas»—, que es la MISMA pantalla del
     * primer paso. Después de agregar tres productos, el portal seguía diciendo
     * lo mismo que antes de agregar el primero: se lee como empezar de cero.
     *
     * La solución no se inventa acá: Ajuste de Inventario ya resolvió este
     * formulario —«busco producto, agrego cantidad y lote, y lo agrego, luego el
     * siguiente»— y lo hace con dos pestañas, «Agregar» y «En la solicitud · N»,
     * más una línea que confirma qué acaba de entrar. Se copia esa forma, y con
     * los mismos rótulos: dos compositores que hacen lo mismo con dos dibujos
     * distintos obligan a aprender dos veces. */
    const [origenId, setOrigenId] = useState(null);   // la CLAVE del estante, no el id de sala
    const [presIdx,  setPresIdx]  = useState('0');
    const [presentaciones, setPresentaciones] = useState([]);
    const [cantidad, setCantidad] = useState('1');
    const [enviando, setEnviando] = useState(false);
    const [listo,    setListo]    = useState(false);
    const [error,    setError]    = useState('');

    // La lista de faltantes ya trae sus salas; la búsqueda no. En ese caso se
    // preguntan acá, para que el modal sea UNO solo y no dos que se parecen.
    const [dondeTraido, setDondeTraido] = useState(null);
    const donde = useMemo(
        () => ((producto?.donde ?? dondeTraido) ?? []).filter(d => d?.erp_sucursal_id),
        [producto, dondeTraido],
    );

    // Para qué sala se pide: la de quien pide, y no se pregunta. Quien no está
    // asignado a una sala —Supervisión, Administración— no pide traslados;
    // decisión del usuario el 2026-08-06, después de probarlo.
    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const miErp    = MI_ERP_POR_BRANCH[miBranch] ?? null;

    useEffect(() => {
        if (producto?.donde || !producto?.erp_product_id || !miErp) return;
        let cancelado = false;
        /* Se limpia ANTES de preguntar, y eso no es prolijidad.
         *
         * Entre que se elige otro producto y llega su lista de salas, `donde`
         * seguía siendo la del producto ANTERIOR: la sala se elegía sola sobre
         * una lista que ya no era, y cuando llegaba la buena el efecto de abajo
         * no la corregía porque `origenId` ya no era null. El formulario quedaba
         * con una sala que ese producto no tiene, el botón apagado y nada que
         * explicara por qué. Se veía poco cuando cambiar de producto era raro;
         * con el compositor es el camino normal. */
        setDondeTraido(null);
        fetchDondeHay(producto.erp_product_id, miErp).then(r => {
            if (!cancelado && !r.error) setDondeTraido(r.donde);
        });
        return () => { cancelado = true; };
    }, [producto?.erp_product_id, producto?.donde, miErp]);

    /* Los lotes, cuando la pantalla que abrió el modal no los traía.
     *
     * Misma forma que las salas de arriba, y por el mismo motivo: que el modal
     * sea UNO y no dos que se parecen. La lista de faltantes —«Sin existencia,
     * puedes solicitar en estas sucursales»— abre con la fila del RPC, que trae
     * las salas y las unidades pero NO los lotes, así que por ahí la solicitud
     * salía sin decir de qué lote tenía que salir el producto y quien despacha
     * lo elegía por su cuenta.
     *
     * ⚠️ Sólo se pregunta cuando NO vinieron. Ese matiz es toda la regla: si la
     * pantalla mostró una lista de lotes, se usa ESA —volver a pedirlos podría
     * traer otra y se estaría eligiendo sobre algo distinto de lo que la
     * persona miró—. Sin lista a la vista no hay nada que contradecir, y
     * preguntar es estrictamente mejor que no ofrecer la elección. */
    const [lotesTraidos, setLotesTraidos] = useState(null);
    useEffect(() => {
        if (producto?.lotesPorSala || !producto?.erp_product_id) return;
        let cancelado = false;
        // Mismo motivo que las salas de arriba: el mapa está indexado por
        // estante, no por producto, así que el del anterior contesta igual y
        // el reparto se armaría sobre lotes de otro producto.
        setLotesTraidos(null);
        fetchInventoryByProductIds([producto.erp_product_id]).then(filas => {
            if (cancelado) return;
            const porSala = {};
            for (const l of filas ?? []) {
                if (l.erp_product_id !== producto.erp_product_id) continue;
                // Por ESTANTE y no por sala. Esta consulta siempre trajo los dos
                // —nunca filtró `is_vencidos`— y los amontonaba bajo el mismo
                // número de sucursal: pedirle a Bodega podía reservar un lote
                // que está en el área de vencidos, o sea uno que la ubicación de
                // origen del despacho ni siquiera ve.
                (porSala[claveOrigen({ erp_sucursal_id: l.erp_sucursal_id, vencidos: l.is_vencidos })] ||= []).push(l);
            }
            setLotesTraidos(porSala);
        }).catch(() => {});
        return () => { cancelado = true; };
    }, [producto?.erp_product_id, producto?.lotesPorSala]);

    // Queda elegida la sala desde la que se apretó «Solicitar» —la fila ya estaba
    // bajo su encabezado— y, si no viene ninguna, la de más existencia, que es
    // la que puede ceder sin quedarse corta.
    useEffect(() => {
        if (donde.length === 0) return;
        // Y también CORRIGE una sala que ya no está en la lista. Antes sólo
        // elegía cuando `origenId` era null, así que una sala heredada del
        // producto anterior se quedaba puesta y `sala` quedaba en `undefined`:
        // el desplegable vacío, el botón apagado y ninguna pista de por qué.
        if (origenId !== null && donde.some(d => claveOrigen(d) === String(origenId))) return;
        // `origen_sugerido` viaja como CLAVE, no como id de sala: apretar
        // «Solicitar» sobre el renglón del área de vencidos de Bodega y caer en
        // el estante normal de Bodega sería elegir por el usuario justo lo que
        // acaba de elegir él.
        const sugerido = producto?.origen_sugerido != null
            && donde.some(d => claveOrigen(d) === String(producto.origen_sugerido))
            ? String(producto.origen_sugerido)
            : claveOrigen(donde[0]);
        setOrigenId(sugerido);
    }, [donde, origenId, producto?.origen_sugerido]);

    // La presentación viaja por SIGNIFICADO —tipo + factor—, nunca por su id:
    // el portal y el sistema de origen las numeran distinto y solo la etiqueta
    // es estable entre los dos.
    useEffect(() => {
        if (!producto?.erp_product_id) return;
        let cancelado = false;
        /* Y ésta es la que más caro sale de las tres.
         *
         * Las salas y los lotes se piden en paralelo con las presentaciones, así
         * que la del producto NUEVO puede llegar antes que sus presentaciones.
         * En esa ventana el renglón está «completo» —hay sala, hay cantidad— y
         * `pres` todavía es la del producto ANTERIOR: se agregaría una
         * CAJA X 10 sobre un producto que se vende por unidad. El factor
         * multiplica, así que el error no se ve como un error, se ve como una
         * cantidad. */
        setPresentaciones([]);
        fetchPresentaciones([producto.erp_product_id]).then(r => {
            if (cancelado) return;
            setPresentaciones(r.porProducto.get(producto.erp_product_id) ?? []);
        });
        return () => { cancelado = true; };
    }, [producto?.erp_product_id]);

    const sala     = donde.find(d => claveOrigen(d) === String(origenId));
    const pres     = presentaciones[Number(presIdx)] ?? null;

    // ── El paréntesis dice CUÁNTAS caben, no cuántas trae ────────────────────
    // Hasta el 2026-08-19 ahí iba el factor: CLOPRIM X 3 AMPOLLAS con 3 unidades
    // en Bodega ofrecía «CAJA X 3 (3)», y ese 3 se lee como «hay tres cajas»
    // cuando hay una. Pedido del usuario: «debe salir la cantidad de esa
    // presentación, no las unidades base».
    //
    // No cuesta una consulta: la existencia de la sala ya vino en `donde` y el
    // factor en `presentaciones`, así que son dos números que ya están en
    // memoria y una división. Y es la MISMA cuenta que decide si el pedido sale
    // —`unidades <= sala.unidades`—, o sea que el desplegable pasó a mostrar el
    // techo del formulario en vez de un dato suelto.
    const opcionesPres = useMemo(
        () => opcionesDePresentacion(presentaciones, sala ? sala.unidades : null),
        [presentaciones, sala],
    );

    /* La presentación elegida no puede quedar en una que no alcanza.
     *
     * `presIdx` arranca en '0' y no se movía al cambiar de sala, así que con la
     * primera presentación apagada el formulario quedaba apuntando a ella: el
     * desplegable mostraba una opción tachada y los avisos hablaban de una
     * cantidad imposible. Se corre a la primera que sí alcanza — y si NINGUNA
     * alcanza se queda donde está, porque ahí lo correcto no es elegir por el
     * usuario sino decirle que en esa sala no hay para una. */
    const primeraQueAlcanza = opcionesPres.find(o => !o.disabled)?.value ?? null;
    const ningunaAlcanza = opcionesPres.length > 0 && primeraQueAlcanza === null;
    useEffect(() => {
        if (primeraQueAlcanza === null) return;
        const elegida = opcionesPres.find(o => String(o.value) === String(presIdx));
        if (!elegida || elegida.disabled) setPresIdx(primeraQueAlcanza);
    }, [opcionesPres, presIdx, primeraQueAlcanza]);

    const unidadesPedidas = pres ? Number(cantidad || 0) * Number(pres.factor || 1) : 0;

    // Si lleva receta. Decide DOS cosas: el rótulo «Bajo Receta» y —por decisión
    // del usuario el 2026-08-06— si el vencimiento importa acá.
    const [esAntibiotico, setEsAntibiotico] = useState(false);
    useEffect(() => {
        if (!producto?.erp_product_id) return;
        let cancelado = false;
        fetchEsAntibiotico(producto.erp_product_id).then(r => {
            if (!cancelado) setEsAntibiotico(r.esAntibiotico);
        });
        return () => { cancelado = true; };
    }, [producto?.erp_product_id]);

    // ── El aviso de vencimiento: SOLO para antibióticos, por ahora ───────────
    // «Que el vencimiento solo importe por ahora para los antibióticos»
    // —decisión del usuario, 2026-08-06—. Tiene sentido: son los que se mueven
    // con lote y los que no se pueden repartir a último momento.
    //
    // ⏳ CUANDO EL PORTAL TENGA VENTA Y FACTURACIÓN, extenderlo al resto — pero
    // no copiando esta regla. Para un producto común la fecha sola no aconseja
    // nada: «vence en tres meses» no dice si es un problema sin saber cuánto
    // rota. Una caja que vence en tres meses y sale en dos semanas está bien;
    // una que vence en seis y no se mueve, no. Esa cuenta necesita la venta.
    // `product_stock_params.velocity` ya calcula esa velocidad para el MIN/MAX,
    // y `vence` ya viene por sala en los dos RPC: no hay que tocar la base, solo
    // cruzarlos acá.
    //
    // Avisa por dos motivos distintos y dice cuál: que lo de esta sala esté
    // pronto a vencer —vale aunque sea la única que lo tiene— o que otra lo
    // tenga con más vida por delante, que es la comparación que se pidió. Sin
    // la comparación, el aviso no ayuda a elegir.
    const avisoVence = useMemo(() => {
        if (!esAntibiotico || !sala?.vence) return null;
        const dias = diasHasta(sala.vence);
        if (dias != null && dias <= 0)
            return { grave: true, texto: `Lo de ${sala.sala} ya está vencido (${fmtVence(sala.vence)}).` };

        const mejor = donde
            .filter(d => claveOrigen(d) !== claveOrigen(sala) && d.unidades >= unidadesPedidas)
            .filter(d => !d.vence || d.vence > sala.vence)
            .sort((a, b) => (a.vence ? 1 : -1) - (b.vence ? 1 : -1))[0];

        if (dias != null && dias <= 90) {
            return {
                grave: dias <= 30,
                texto: `Lo de ${sala.sala} vence ${fmtVence(sala.vence)}`
                     + (mejor ? ` — ${mejor.sala} lo tiene ${mejor.vence ? `hasta ${fmtVence(mejor.vence)}` : 'sin fecha de vencimiento'}.` : '.'),
            };
        }
        if (mejor?.vence && new Date(mejor.vence).getTime() - new Date(sala.vence).getTime() > 180 * 86400000) {
            return {
                grave: false,
                texto: `${mejor.sala} lo tiene con más vida: vence ${fmtVence(mejor.vence)} contra ${fmtVence(sala.vence)} aquí.`,
            };
        }
        return null;
    }, [esAntibiotico, sala, donde, unidadesPedidas]);

    const unidades = unidadesPedidas;

    // ── De qué lotes saldría, y poder cambiarlo (2026-08-07) ────────────────
    // Pedido del usuario: «abajo de eso ponga cuántos enviarían según cada
    // lote/vence, si hay algo de esos (uno que esté muy corto y el cliente no lo
    // quiera) que permita editar y seleccionar otro lote/vence».
    //
    // El reparto es por vencimiento, el que vence primero primero — que es como
    // hay que sacarlo salvo que alguien decida lo contrario, y para eso está el
    // botón de descartar.
    //
    // Los lotes vienen de la pantalla que abrió el modal: los mismos que el
    // usuario acaba de ver. Cuando el modal se abre desde la lista de faltantes
    // no hay lotes, y entonces esta sección no aparece — no se inventa un
    // reparto sobre datos que no se tienen.
    const [descartados, setDescartados] = useState(() => new Set());

    // Cambiar de sala invalida lo descartado: son lotes de la sala anterior.
    useEffect(() => { setDescartados(new Set()); }, [origenId]);

    const lotesDeSala = useMemo(
        () => {
            const mapa = producto?.lotesPorSala ?? lotesTraidos;
            return lotesEnUnidades(mapa?.[String(origenId)] ?? []);
        },
        [producto?.lotesPorSala, lotesTraidos, origenId],
    );
    const lotesVivos = useMemo(
        () => lotesDeSala.filter(l => !descartados.has(l.clave)),
        [lotesDeSala, descartados],
    );
    const { reparto, faltan } = useMemo(
        () => repartirPedido(lotesVivos, unidades),
        [lotesVivos, unidades],
    );
    const hayLotes = lotesDeSala.length > 0;

    /* El renglón que se está armando está completo. NO incluye el «para qué»:
     * ese es uno solo para toda la composición y se pide al enviar, no al
     * agregar cada producto. */
    const lineaLista = Boolean(
        producto && sala && pres && miErp && Number(cantidad) > 0
        && unidades > 0 && unidades <= Number(sala.unidades ?? 0)
        // Con lotes a la vista, el pedido no sale si lo que queda no lo cubre:
        // mandarlo igual sería pedir algo que ya se sabe que no se puede dar.
        && (!hayLotes || faltan === 0),
    );

    /* El renglón, ya con la forma con la que va a viajar. Se arma acá y no en
     * dos lados —al agregar y al enviar— para que el que se manda directo y el
     * que pasa por la lista sean el MISMO. */
    const lineaActual = lineaLista ? {
        clave: claveOrigen(sala),
        origen: {
            erp_sucursal_id: sala.erp_sucursal_id,
            sala: sala.sala,
            vencidos: Boolean(sala.vencidos),
            // Cuánto tiene esa sala, congelado al agregar. Sin esto, cambiar la
            // cantidad desde la lista no tendría contra qué medirse: para
            // entonces el formulario ya está en OTRO producto y `sala` es otra.
            unidades: Number(sala.unidades ?? 0),
        },
        /* Los lotes que quedaron en pie —los no descartados—. Se guardan para
         * poder REPARTIR de nuevo si la cantidad cambia desde la lista: el
         * reparto por lote es lo que manda («los lotes MANDAN», 2026-08-07), y
         * editar la cantidad sin rehacerlo dejaría un pedido de 5 con el reparto
         * de 3 — un renglón que dice una cosa y lleva otra. */
        lotesVivos,
        /* Las presentaciones de ESE producto, para poder cambiarla desde la
         * lista. Se guardan por el mismo motivo que los lotes: cuando el
         * renglón ya está agregado, el formulario está en otro producto y
         * `presentaciones` es la de otro. Sin esto, corregir «pedí cajas y
         * quería unidades» obliga a borrar el renglón y rehacerlo. */
        presentaciones,
        unidades,
        item: {
            erp_product_id:    producto.erp_product_id,
            descripcion:       producto.descripcion,
            presentacion_tipo: pres.tipo,
            factor:            pres.factor,
            cantidad:          Number(cantidad),
            // Los lotes MANDAN, no son una vista previa: decisión del usuario
            // 2026-08-07. Quien despacha los ve en el pedido y saca de ésos.
            lotes: hayLotes
                ? reparto.map(l => ({ lote: l.lote, vence: l.vence, unidades: l.toma }))
                : null,
        },
    } : null;

    /* El mismo producto al mismo estante DOS veces no es un pedido más grande:
     * es una sola línea con la cantidad sumada. La base lo frena igual —y
     * frenaría la composición ENTERA, porque las solicitudes se insertan
     * juntas—, así que se avisa acá, donde todavía se puede arreglar sin perder
     * lo demás. */
    const yaEstaEnLaLista = Boolean(lineaActual) && renglones.some(
        r => r.clave === lineaActual.clave
          && r.item.erp_product_id === lineaActual.item.erp_product_id,
    );

    /* Un producto elegido a medias bloquea el envío en vez de perderse.
     *
     * Es el error que se comete solo: se agrega uno, se empieza el segundo, y
     * se aprieta Solicitar sin haberlo agregado. Mandar sin él lo tira en
     * silencio; se prefiere no dejar mandar y decir cuál falta. */
    const aMedias = Boolean(producto) && !lineaLista;

    // Lo que se va a mandar: lo agregado más el que está a la vista, si está
    // completo. Así el último producto no se pierde por no haberlo agregado.
    const aEnviar = [...renglones, ...(lineaActual && !yaEstaEnLaLista ? [lineaActual] : [])];

    // Cuántas solicitudes van a salir: una por estante de origen.
    const salasDestino = new Set(aEnviar.map(r => r.clave)).size;

    /* `!yaEstaEnLaLista` no sobra: con un duplicado a la vista el renglón está
     * COMPLETO —así que `aMedias` es falso— y `aEnviar` lo deja fuera. Sin esta
     * condición, Solicitar quedaría encendido y se llevaría todo menos lo que
     * la persona tiene delante, que es la peor de las salidas. */
    /* Un renglón de la lista con problema —se le bajó la existencia, o se le
     * subió la cantidad por encima de lo que hay— frena el envío. Marcarlo en
     * rojo y dejar mandar sería un rojo decorativo. */
    const conProblema = renglones.filter(r => r.problema);

    const puedeEnviar = aEnviar.length > 0 && !aMedias && !yaEstaEnLaLista
        && conProblema.length === 0 && causa.trim().length > 0;


    /* Por qué el botón de mandar está apagado.
     *
     * Reportado el 2026-08-20: «no me dice el porqué no puedo solicitar; yo sé
     * que es el motivo, pero no me dice en ningún lado». Y era cierto: las otras
     * cuatro razones ya tenían su aviso en pantalla —el renglón a medias, el
     * repetido, el que se pasa de la existencia, el que no llega ni a una
     * presentación— y la más común, que falta el «para qué», no tenía ninguna.
     * Un botón apagado sin explicación obliga a adivinar cuál de las cinco es.
     *
     * Sólo se dice la que falta AHORA: enumerar las cinco cuando falta una es
     * la otra forma de no decir nada. */
    const faltaElParaQue = aEnviar.length > 0 && !aMedias && !yaEstaEnLaLista
        && conProblema.length === 0 && causa.trim().length === 0;

    /* Agregar y volver a la consulta.
     *
     * Pedido del usuario, 2026-08-20: «al dar en agregar más productos debe
     * salir esto de nuevo», con la captura de la consulta de inventario. O sea
     * que la pantalla siguiente no es otra vista adentro del formulario: es la
     * consulta, con su buscador y su lista de faltantes, que es de donde se
     * viene y donde está todo. Así que el formulario se cierra.
     *
     * Lo agregado NO se pierde al cerrar: vive en el store. Al elegir el
     * siguiente producto el formulario vuelve a abrirse con la lista intacta, y
     * la consulta muestra mientras tanto cuántos productos llevás. */
    const agregar = ({ cerrar = true } = {}) => {
        if (!lineaActual || yaEstaEnLaLista) return;
        agregarAlStore(lineaActual);
        setError('');
        if (cerrar) { alCerrar?.(); return; }
        // Sin cerrar —al cambiar de pestaña— el formulario vuelve al buscador.
        setElegido(null);
        setOrigenId(null); setPresIdx('0'); setCantidad('1');
        setDescartados(new Set());
    };


    /* ── Cambiar la cantidad de un renglón ya agregado ─────────────────────
     *
     * Reportado el 2026-08-20: «en la solicitud no me sale editar, ni eliminar
     * como en ajuste de inventario». Allá cada línea tiene su lápiz y su
     * papelera; acá sólo había una equis chica, y para corregir un número había
     * que quitar el renglón y volver a armarlo desde el buscador.
     *
     * Lo que NO se puede hacer es cambiar sólo el número: el renglón lleva su
     * reparto por lote, y ese reparto se hizo para la cantidad vieja. Se rehace
     * acá con los lotes que quedaron en pie al agregar. Si no alcanzan, el
     * renglón queda marcado y el envío se frena — que es lo mismo que hace el
     * formulario antes de dejar agregar.
     */
    /* Corregir un renglón ya agregado. La cuenta la rehace el store: cantidad y
     * presentación pasan por el mismo cálculo porque el factor multiplica, y
     * separadas una de las dos se olvidaría de rehacer el reparto por lote. */
    const editarRenglon = (i, cambios) => editarEnStore(i, cambios);

    const enviar = async () => {
        if (!puedeEnviar) return;
        setError(''); setEnviando(true);
        try {
            /* ── Una composición, una solicitud POR ESTANTE de origen ───────
             *
             * Se agrupa por `clave` —sucursal + estante— y no por sucursal a
             * secas: Bodega tiene el estante de operación y el área donde
             * aparta lo próximo a vencer, y de los dos se puede pedir. Son dos
             * despachos distintos, con dos ubicaciones distintas del sistema.
             *
             * El orden de los renglones dentro de cada solicitud es el orden en
             * que se agregaron, y eso importa: la posición en `items` es el
             * nombre del renglón para todo el circuito —así lo señala quien
             * despacha cuando manda de menos—. */
            const porSala = new Map();
            for (const r of aEnviar) {
                if (!porSala.has(r.clave)) porSala.set(r.clave, []);
                porSala.get(r.clave).push(r);
            }

            /* Qué las hace hermanas. Sólo cuando de verdad hay más de una: con
             * una sola solicitud no hay nada que agrupar, y una clave que
             * aparece siempre no distingue nada. */
            const grupoId = porSala.size > 1
                ? (globalThis.crypto?.randomUUID?.() ?? String(Date.now()))
                : null;

            const filas = [...porSala.values()].map(grupo => ({
                employee_id: user?.id,
                type: 'INVENTORY_TRANSFER_REQUEST',
                status: 'PENDING',
                note: causa.trim(),
                metadata: {
                    reason: causa.trim(),
                    // Mi sala: la que recibe.
                    branch_id: miBranch,
                    branch_name: user?.branchName ?? user?.branch_name ?? NOMBRE_SALA[miErp] ?? '',
                    erp_sucursal_id: miErp,
                    // La sala de origen: la que tiene el producto.
                    origen_erp_sucursal_id: grupo[0].origen.erp_sucursal_id,
                    origen_branch_name: grupo[0].origen.sala,
                    // De qué ESTANTE de esa sala. Bodega tiene dos y la sucursal
                    // sola no los distingue; es lo que la Edge Function traduce a
                    // la ubicación real del sistema al despachar, y lo que la
                    // base usa para medir la existencia contra el estante que
                    // corresponde. Sólo viaja cuando es cierto: una clave en
                    // `false` ensucia el metadata de las 189 solicitudes que no
                    // tienen nada que ver con esto.
                    ...(grupo[0].origen.vencidos ? { origen_vencidos: true } : {}),
                    // Las hermanas de la misma composición, para que quien pidió
                    // las vea juntas. Cada sala sigue viendo SÓLO la suya: esto
                    // no abre nada, es un rótulo para el lado que las pidió.
                    ...(grupoId ? { grupo_id: grupoId } : {}),
                    total_unidades: grupo.reduce((s, r) => s + r.unidades, 0),
                    items: grupo.map(r => r.item),
                },
            }));

            /* Entran TODAS o no entra ninguna: es un solo `insert` con varias
             * filas. Si una choca —el mismo producto a la misma sala ya
             * esperando respuesta—, es mejor que no entre nada y se corrija,
             * que quedarse con media composición enviada y sin forma de saber
             * cuál mitad. */
            // La bitácora (`TRASLADO_SOLICITADO`) la anota la capa de datos.
            const { error: e } = await crearSolicitudTraslado(filas);
            if (e) throw e;

            setResumen({
                solicitudes: filas.length,
                salas: [...porSala.values()].map(g => g[0].origen.sala),
            });
            /* La composición se vacía ACÁ y no al cerrar: cerrar es lo que se
             * hace para ir a buscar el siguiente producto, y ahí lo que llevás
             * tiene que seguir estando. Se vacía cuando de verdad salió. */
            limpiarStore();
            setListo(true);
            setTimeout(() => { alTerminar?.(); alCerrar?.(); }, 2200);
        } catch (e) {
            // El mensaje del trigger es el que explica de verdad qué pasó —que
            // la sala quedaría debajo de su mínimo, por ejemplo—, así que se
            // muestra tal cual en vez de taparlo con uno genérico.
            //
            // La excepción es el índice de duplicados: ahí Postgres contesta
            // «duplicate key value violates unique constraint», que no le dice
            // nada a nadie y encima suena a que el portal se rompió. Lo que hay
            // que decir es qué hacer: la cantidad va en el mismo pedido. (El
            // trigger que vigila renglón por renglón ya contesta esa frase él
            // mismo; esto cubre al índice, que sigue de red abajo.)
            const msg = String(e?.message ?? '');
            setError(
                msg.includes('approval_requests_un_traslado_pendiente')
                    ? 'Ya hay una solicitud de ese producto a esa sala esperando respuesta. '
                      + 'Si necesitas más, súbele la cantidad a esa solicitud o pídeselo a otra sala.'
                : msg.includes('row-level security')
                    ? 'No tienes permiso para solicitar traslados.'
                : (e?.message ?? 'No se pudo enviar la solicitud.'),
            );
            setEnviando(false);
        }
    };

    const avisos = avisosDelPedido({ pres, cantidad, sala, unidades, opcionesPres, ningunaAlcanza, faltan,
        descartados, lotesDeSala, aMedias, renglones, producto, yaEstaEnLaLista, conProblema, faltaElParaQue });

    return {
        avisos,
        user, miBranch, miErp,
        producto, setElegido,
        donde, origenId, setOrigenId, sala,
        presentaciones, presIdx, setPresIdx, pres, opcionesPres, primeraQueAlcanza, ningunaAlcanza,
        cantidad, setCantidad, unidades, unidadesPedidas,
        esAntibiotico, avisoVence,
        descartados, setDescartados, lotesDeSala, lotesVivos, reparto, faltan, hayLotes,
        lineaLista, lineaActual, yaEstaEnLaLista, aMedias, aEnviar, salasDestino, conProblema,
        puedeEnviar, faltaElParaQue,
        renglones, causa, setCausa, agregar, quitarDelStore, editarRenglon, limpiarStore,
        enviar, enviando, listo, error, setError, resumen,
    };
}
