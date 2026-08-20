import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, ArrowLeftRight, CheckCircle2, Loader2, X } from 'lucide-react';
import Button from '../../components/common/Button';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { fetchPresentaciones } from '../../data/inventoryMovements';
import { crearSolicitudTraslado, fetchDondeHay, fetchEsAntibiotico } from '../../data/traslados';
import { fetchInventoryByProductIds } from '../../data/inventory';
import { lotesEnUnidades, repartirPedido } from '../../utils/unidadesInventario';
import { opcionesDePresentacion } from '../../utils/presentacion';

// Pedirle un producto a otra sala.
//
// Se abre desde la consulta de inventario, y lo normal es que `producto` venga
// puesto: la lista ya sabe qué producto, qué salas lo tienen, cuántas unidades
// y con qué lotes. Quedan tres decisiones: a cuál pedirle, cuánto, y para qué.
//
// ── SIEMPRE sale con lotes, venga como venga (2026-08-18) ─────────────────
// Lo que falte se pregunta acá: las salas con `fetchDondeHay` y los lotes con
// `fetchInventoryByProductIds`. Las dos consultas corren SÓLO cuando el dato no
// vino, nunca encima del que vino — si la pantalla mostró una lista, se elige
// sobre ESA y no sobre otra que podría no coincidir con lo que la persona miró.
//
// Antes los lotes no se preguntaban, y por eso había puertas que producían
// solicitudes a medias: la que vivió en «Nueva solicitud» entre el 15 y el 18
// de agosto (arrancaba en un buscador de catálogo) y la lista de faltantes
// —«Sin existencia, puedes solicitar en estas sucursales»—, que abre con la
// fila del RPC y ésa no trae lotes. Por ahí la solicitud salía sin decir de qué
// lote tenía que salir el producto y quien despacha lo elegía por su cuenta,
// cuando esa elección es de quien pide («los lotes MANDAN», 2026-08-07).
//
// O sea que el modal ya no depende de con cuánto lo abrieron. Es la condición
// para que las dos puertas produzcan la misma solicitud.
//
// El «para qué» es obligatorio en los dos casos: es lo único que queda escrito
// en el movimiento de las dos salas.
//
// ── Lo que NO se elige acá ────────────────────────────────────────────────
// Ni el aprobador ni la ubicación de la sala de origen. Los dos los resuelve la
// base: el primero con la cascada turno → jefatura → Supervisión, el segundo
// desde el mapa de salas. Un navegador que eligiera de dónde sale el producto o
// quién lo autoriza no sería una pantalla, sería un permiso.
//
// Desde el 2026-08-19 sí se elige el ÁREA —el estante de operación de Bodega o
// el de próximos a vencer—, y la diferencia con lo anterior es exacta: la
// pantalla nombra un estante que ya vio en la lista, y qué número tiene ese
// estante en el sistema lo sigue contestando el mapa. Elegir entre dos opciones
// que la base ofreció no es lo mismo que dictarle una ubicación.

const MI_ERP_POR_BRANCH = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };
const NOMBRE_SALA = { 1:'Salud 1', 2:'Salud 2', 3:'Salud 3', 4:'Salud 4', 5:'La Popular', 6:'Bodega', 7:'Salud 5' };

/**
 * De dónde sale el producto, dicho con una sola cadena.
 *
 * Desde el 2026-08-19 una sala puede aparecer DOS veces en la lista: Bodega
 * tiene su estante de operación y el área donde aparta lo próximo a vencer, y
 * de los dos se puede pedir. El `erp_sucursal_id` dejó de alcanzar como
 * identidad —las dos filas traen el 6— así que todo lo que elige, compara o
 * indexa por origen usa ESTA clave: el desplegable, los lotes de cada estante y
 * el descarte de lotes al cambiar de origen.
 *
 * Es el mismo problema que la clave de `groupInventory` en la consulta de
 * inventario: cuando dos filas distintas comparten identificador, la que llega
 * segunda pisa a la primera y nadie se entera.
 */
const claveOrigen = (d) => (
    d?.vencidos ? `${d.erp_sucursal_id}:V` : String(d?.erp_sucursal_id ?? '')
);

const fmtVence = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { month: 'short', year: '2-digit' })
    : '';

/** Días hasta una fecha, en hora de El Salvador. Negativo = ya venció. */
function diasHasta(d) {
    if (!d) return null;
    const hoy = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return Math.round((new Date(d + 'T12:00:00') - new Date(hoy + 'T12:00:00')) / 86400000);
}

export default function PedirTrasladoModal({ producto: productoInicial = null, onClose, onListo }) {
    const { user } = useAuth();
    const appendAuditLog = useStaffStore(s => s.appendAuditLog);
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

    /* ── Los renglones ya agregados ────────────────────────────────────────
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
     * Salud 3. */
    const [renglones, setRenglones] = useState([]);
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
    const [pestana, setPestana] = useState('agregar');
    /* Lo último que entró. El contador de la pestaña sube, pero un número que
     * cambia no dice CUÁL entró — y en una tanda de productos parecidos eso es
     * justo lo que hay que poder confirmar sin cambiar de pestaña. */
    const [ultimo,  setUltimo]  = useState('');
    const [origenId, setOrigenId] = useState(null);   // la CLAVE del estante, no el id de sala
    const [presIdx,  setPresIdx]  = useState('0');
    const [presentaciones, setPresentaciones] = useState([]);
    const [cantidad, setCantidad] = useState('1');
    const [causa,    setCausa]    = useState('');
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
        if (mejor?.vence && new Date(mejor.vence) - new Date(sala.vence) > 180 * 86400000) {
            return {
                grave: false,
                texto: `${mejor.sala} lo tiene con más vida: vence ${fmtVence(mejor.vence)} contra ${fmtVence(sala.vence)} acá.`,
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
        },
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
    const puedeEnviar = aEnviar.length > 0 && !aMedias && !yaEstaEnLaLista
        && causa.trim().length > 0;

    const agregar = () => {
        if (!lineaActual || yaEstaEnLaLista) return;
        setRenglones(prev => [...prev, lineaActual]);
        setError('');
        // Queda dicho cuál entró, y NO se cambia de pestaña: se sigue agregando
        // desde donde se estaba. La lista está a un toque, con su contador.
        setUltimo(lineaActual.item.descripcion ?? '');
        // El formulario vuelve al buscador, listo para el siguiente. La sala no
        // se conserva a propósito: cada producto tiene su propio mapa de quién
        // lo tiene, y arrastrar la anterior propondría una que quizá no lo
        // tenga.
        setElegido(null);
        setOrigenId(null); setPresIdx('0'); setCantidad('1');
        setDescartados(new Set());
    };

    const quitar = (i) => setRenglones(prev => prev.filter((_, j) => j !== i));

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
            const { error: e } = await crearSolicitudTraslado(filas);
            if (e) throw e;

            await appendAuditLog('TRASLADO_SOLICITADO', String(miBranch ?? ''), {
                solicitudes: filas.length,
                productos: aEnviar.length,
                salas: [...porSala.values()].map(g => g[0].origen.sala),
                unidades: aEnviar.reduce((s, r) => s + r.unidades, 0),
                causa: causa.trim(),
                ...(grupoId ? { grupo_id: grupoId } : {}),
            });

            setResumen({
                solicitudes: filas.length,
                salas: [...porSala.values()].map(g => g[0].origen.sala),
            });
            setListo(true);
            setTimeout(() => { onListo?.(); onClose?.(); }, 2200);
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

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Solicitar a otra sala">
            {/* Las tres ranuras del canónico. Antes era un `<div>` suelto con el
                título a mano, sin botón de cerrar y con la acción al final del
                cuerpo que scrollea. */}
            <LiquidModal.Header>
                <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                        <ArrowLeftRight size={15} className="text-brand-text" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-body font-black text-content leading-tight">
                            {producto?.descripcion ?? 'Pedir a otra sala'}
                        </p>
                        <p className="text-label text-content-3 mt-0.5">
                            {producto ? 'Solicitar a otra sala' : 'Elige el producto'}
                        </p>
                    </div>
                    {/* Volver al buscador.
                        Antes sólo aparecía cuando el producto había salido del
                        buscador —«si llegó puesto desde la consulta de
                        inventario, atrás no es acá»—. Con el compositor sí es
                        acá: soltar el producto es cómo se elige el siguiente,
                        venga de donde venga. */}
                    {producto && !listo && pestana === 'agregar' && (
                        <Button variant="ghost" size="xs" icon={ArrowLeft} iconOnly
                            onClick={() => {
                                setElegido(null); setOrigenId(null);
                                setPresIdx('0'); setCantidad('1'); setDescartados(new Set());
                            }}
                            aria-label="Elegir otro producto" />
                    )}
                    <Button variant="ghost" size="xs" icon={X} iconOnly
                        onClick={onClose} aria-label="Cerrar" />
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="flex flex-col gap-3 min-h-0">
                {/* ── Las dos mitades, como en Ajuste de Inventario ─────────
                    «Agregar» y «En la solicitud · N». Los rótulos son los
                    mismos de allá a propósito: dos compositores que hacen lo
                    mismo con dos nombres distintos obligan a aprender dos veces.

                    El contador en la pestaña es lo que dice que la lista existe
                    sin tener que ir a mirarla — y por eso la lista pudo salir de
                    encima del formulario, que es lo que hacía que agregar se
                    sintiera como volver al principio. */}
                {!listo && (
                    <div className="shrink-0">
                        <SegmentedControl
                            value={pestana}
                            onChange={setPestana}
                            options={[
                                { value: 'agregar', label: 'Agregar' },
                                { value: 'lista',   label: `En la solicitud${renglones.length ? ` · ${renglones.length}` : ''}` },
                            ]}
                        />
                    </div>
                )}

                {/* Lo último que entró. El contador de la pestaña sube, pero un
                    número que cambia no dice CUÁL entró — y en una tanda de
                    productos parecidos eso es justo lo que hay que poder
                    confirmar sin cambiar de pestaña. Se va al elegir el
                    siguiente. */}
                {!listo && pestana === 'agregar' && !producto && ultimo && (
                    <p className="shrink-0 flex items-center gap-1.5 text-micro font-semibold text-success-text px-1">
                        <CheckCircle2 size={12} strokeWidth={2.5} className="shrink-0" />
                        <span className="truncate">{ultimo} — agregado</span>
                    </p>
                )}

                {/* ── Lo que ya lleva la solicitud ──────────────────────────
                    Se agrupa por sala porque así es como va a salir: cada
                    encabezado es una solicitud, y lo que cuelga de él es lo que
                    ESA sala va a ver. Verlo antes de mandar es lo que hace que
                    «se dividen en solicitudes separadas» no sea una sorpresa.

                    Vivía encima del formulario, y ahí es donde molestaba: cada
                    producto agregado empujaba el formulario más abajo, y al
                    agregar el último la pantalla volvía a la invitación del
                    primer paso. Acá tiene su propio lugar y su contador. */}
                {!listo && pestana === 'lista' && (
                    renglones.length === 0 ? (
                        <p className="text-label text-content-3 font-medium py-8 text-center leading-snug">
                            Todavía no agregaste nada.<br />
                            <span className="text-micro">
                                Elige el producto en «Agregar», ponle la cantidad y usa «Agregar y seguir».
                            </span>
                        </p>
                    ) : (
                    <div className="flex flex-col gap-2">
                        {[...new Map(renglones.map(r => [r.clave, r.origen])).entries()].map(([clave, origen]) => (
                            <div key={clave} className="flex flex-col gap-1">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest px-1">
                                    {origen.sala}{origen.vencidos ? ' · próximos a vencer' : ''}
                                </p>
                                {renglones.map((r, i) => r.clave !== clave ? null : (
                                    <div key={i}
                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border-card"
                                        style={{ background: 'var(--surface-card-hover)' }}>
                                        <span className="text-caption font-black text-content shrink-0 tabular-nums">
                                            {r.item.cantidad}
                                        </span>
                                        <span className="text-micro text-content-3 shrink-0">
                                            {r.item.presentacion_tipo}
                                        </span>
                                        <span className="text-micro font-semibold text-content truncate min-w-0 flex-1">
                                            {r.item.descripcion}
                                        </span>
                                        <Button size="xs" variant="ghost" icon={X} iconOnly
                                            onClick={() => quitar(i)}
                                            aria-label={`Quitar ${r.item.descripcion}`} />
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                    )
                )}

                {/* El desenlace manda sobre las pestañas: cuando la solicitud
                    ya salió no hay nada que agregar ni que revisar. */}
                {listo ? (
                    <p className="text-label font-semibold text-success-text py-6 text-center leading-snug">
                        {resumen?.solicitudes > 1
                            ? `${resumen.solicitudes} solicitudes enviadas.`
                            : 'Solicitud enviada.'}<br />
                        <span className="text-content-3 font-medium">
                            {/* Se nombran las salas: quien pidió tiene que saber
                                a quiénes les llegó, porque cada una decide por
                                su cuenta y cada una le va a contestar aparte. */}
                            {(resumen?.salas ?? []).join(', ')} {resumen?.solicitudes > 1 ? 'deciden' : 'decide'} y
                            el producto sale de ahí.
                        </span>
                    </p>
                ) : pestana === 'lista' ? null : !producto ? (
                    <BuscadorDeProducto
                        placeholder="Buscar el producto que hace falta…"
                        invitacion={{
                            icono: ArrowLeftRight,
                            texto: 'Busca el producto que necesitas para ver qué salas lo tienen',
                        }}
                        onElegir={(p) => { setUltimo(''); setElegido({ erp_product_id: p.id, descripcion: p.nombre }); }}
                    />
                ) : (
                    <>
                        <LiquidSelect
                            value={origenId}
                            onChange={v => setOrigenId(v)}
                            options={donde.map(d => ({
                                value: claveOrigen(d),
                                // La fecha va en la etiqueta —y no solo en el
                                // aviso— para verla AL elegir y no después de
                                // haber elegido mal. Solo en los que llevan
                                // receta, que hoy son los únicos donde importa.
                                label: `${d.sala} — ${d.unidades} ${d.unidades === 1 ? 'unidad' : 'unidades'}`
                                     + (esAntibiotico && d.vence ? ` · vence ${fmtVence(d.vence)}` : ''),
                            }))}
                            placeholder="A qué sala..."
                            clearable={false}
                        />

                        <div className="flex gap-2">
                            <div className="flex-1">
                                <LiquidSelect
                                    value={presIdx}
                                    onChange={v => setPresIdx(v ?? '0')}
                                    options={opcionesPres}
                                    placeholder="Presentación..."
                                    clearable={false}
                                />
                            </div>
                            <div className="w-24">
                                <PortalInput
                                    type="number"
                                    min="1"
                                    value={cantidad}
                                    onChange={e => setCantidad(e.target.value)}
                                    placeholder="Cant."
                                />
                            </div>
                        </div>

                        {/* El número que importa es el de UNIDADES: la sala tiene
                            su existencia contada así, y una cantidad en cajas
                            contra una existencia en unidades deja pasar
                            imposibles sin que nada avise.
                            La existencia ya viene con lo que salió y todavía no
                            volvió del conteo descontado. */}
                        {/* «Bajo Receta», nunca «Abx» — el canon de la casa. Se
                            dice al PEDIR y no al recibir: un regulado se mueve
                            con su lote y quien lo pide tiene que saberlo antes
                            de que la caja esté en camino. */}
                        {esAntibiotico && (
                            <p className="text-micro font-semibold text-content-2 px-1 leading-snug">
                                Bajo Receta — se traslada con su lote.
                            </p>
                        )}

                        {/* ── De qué estante sale, cuando no es el de siempre ──
                            El rótulo del desplegable ya lo dice, pero se lee al
                            elegir y después se deja de mirar. Acá abajo queda a
                            la vista mientras se decide la cantidad — que es el
                            momento en que importa.

                            Dice lo que hay que saber y no opina: en esa área
                            Bodega aparta lo próximo a vencer, así que hay lotes
                            con poca vida y también los hay ya vencidos. Cuál es
                            cuál se ve renglón por renglón en «Saldría de», con
                            su fecha, y ahí se puede descartar el que no sirva.
                            Frenar el pedido no es de esta pantalla: quien
                            confirma es Bodega, que tiene la caja delante. */}
                        {sala?.vencidos && (
                            <p className="text-micro font-semibold text-warning-text px-1 leading-snug">
                                Sale del área donde se aparta lo próximo a vencer. Revisa abajo la
                                fecha de cada lote antes de pedirlo.
                            </p>
                        )}

                        {/* El vencimiento, solo cuando importa. Un aviso que
                            aparece siempre deja de leerse. */}
                        {avisoVence && (
                            <p className={`text-micro font-semibold px-1 leading-snug ${
                                avisoVence.grave ? 'text-danger-text' : 'text-warning-text'
                            }`}>
                                {avisoVence.texto}
                            </p>
                        )}

                        {pres && Number(cantidad) > 0 && (
                            <p className={`text-micro font-semibold px-1 ${
                                unidades > Number(sala?.unidades ?? 0) ? 'text-danger-text' : 'text-content-3'
                            }`}>
                                {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
                                {sala && ` · ${sala.sala} tiene ${sala.unidades}`}
                                {/* Que quede en cero no impide nada: se dice para
                                    que quien pide sepa qué está pidiendo. */}
                                {sala && Number(sala.minimo ?? 0) > 0
                                  && (Number(sala.unidades) - unidades) < Number(sala.minimo)
                                  && ` y quedaría en ${Math.max(Number(sala.unidades) - unidades, 0)}, bajo su mínimo de ${sala.minimo}`}
                            </p>
                        )}

                        {/* ── De qué lotes saldría ──────────────────────────
                            Sólo con cantidad puesta: antes de eso no hay nada
                            que repartir y la lista sería ruido. */}
                        {hayLotes && unidades > 0 && (
                            <div className="flex flex-col gap-1.5">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest px-1">
                                    Saldría de
                                </p>
                                {lotesDeSala.map(l => {
                                    const fuera = descartados.has(l.clave);
                                    const enviado = reparto.find(r => r.clave === l.clave);
                                    const dias = diasHasta(l.vence);
                                    const corto = dias != null && dias <= 180;
                                    return (
                                        <div key={l.clave}
                                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border-card ${fuera ? 'opacity-45' : ''}`}
                                            style={{ background: 'var(--surface-card-hover)' }}>
                                            <span className="text-micro font-mono text-content-3 truncate min-w-0 flex-1">
                                                {l.lote || 'sin lote'}
                                            </span>
                                            <span className={`text-micro font-semibold shrink-0 ${corto ? 'text-warning-text' : 'text-content-3'}`}>
                                                {l.vence ? fmtVence(l.vence) : 'sin fecha'}
                                            </span>
                                            {/* El número que se lleva de ESE lote, no lo que
                                                el lote tiene: es lo que hay que poder revisar. */}
                                            <span className="text-caption font-black text-content shrink-0 tabular-nums w-16 text-right">
                                                {fuera ? '—' : `${enviado?.toma ?? 0} uds`}
                                            </span>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={() => setDescartados(prev => {
                                                    const s = new Set(prev);
                                                    if (s.has(l.clave)) s.delete(l.clave); else s.add(l.clave);
                                                    return s;
                                                })}
                                            >
                                                {fuera ? 'Incluir' : 'No este'}
                                            </Button>
                                        </div>
                                    );
                                })}
                                {faltan > 0 && (
                                    <p className="text-micro font-semibold text-danger-text px-1 leading-snug">
                                        Con los lotes que dejaste faltan {faltan} {faltan === 1 ? 'unidad' : 'unidades'}.
                                        Baja la cantidad o vuelve a incluir alguno.
                                    </p>
                                )}
                            </div>
                        )}

                    </>
                )}

                {/* ── El «para qué», uno para toda la solicitud ──────────────
                    Fuera del formulario del producto a propósito: se sigue
                    pidiendo una sola vez aunque la composición lleve seis
                    renglones a tres salas, y sobre todo sigue estando a la vista
                    después de agregar el último —cuando la pantalla volvió al
                    buscador y el formulario ya no está—. Adentro del formulario,
                    el campo desaparecía justo en el paso en que hay que
                    apretar Solicitar. */}
                {!listo && (producto || renglones.length > 0) && (
                    <>
                        <PortalTextarea
                            value={causa}
                            onChange={e => setCausa(e.target.value)}
                            rows={2}
                            placeholder="Para qué se pide — queda escrito en el movimiento"
                        />

                        {/* Un producto a medias no se pierde en silencio: se
                            dice cuál es y el botón no deja mandar hasta que se
                            complete o se suelte. */}
                        {aMedias && renglones.length > 0 && (
                            <p className="text-micro font-semibold text-warning-text px-1 leading-snug">
                                Te falta terminar {producto.descripcion}. Complétalo para que entre, o
                                usa la flecha de arriba para dejarlo fuera.
                            </p>
                        )}

                        {/* El mismo producto al mismo estante dos veces es una
                            sola línea con la cantidad sumada, no dos pedidos. */}
                        {yaEstaEnLaLista && (
                            <p className="text-micro font-semibold text-warning-text px-1 leading-snug">
                                {producto.descripcion} ya está en la lista para {sala?.sala}. Quítalo de
                                arriba y agrégalo con la cantidad total.
                            </p>
                        )}

                        {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}
                    </>
                )}
            </LiquidModal.Body>

            {/* Sin producto y sin nada agregado todavía no hay qué solicitar: el
                pie sería un botón apagado sin ninguna pista de qué lo enciende.
                La salida en ese paso es la X del encabezado. */}
            {!listo && (producto || renglones.length > 0) && (
                <LiquidModal.Footer>
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    {/* «Agregar y seguir» es la misma forma del ajuste de
                        inventario, que ya se usa todos los días: se busca el
                        producto, se pone la cantidad, se agrega, y el siguiente.
                        Sólo aparece cuando el renglón está completo — un botón
                        apagado al lado de otro apagado no dice cuál de los dos
                        se está esperando. */}
                    {pestana === 'agregar' && lineaLista && !yaEstaEnLaLista && (
                        <Button variant="secondary" disabled={enviando} onClick={agregar}>
                            Agregar y seguir
                        </Button>
                    )}
                    <Button disabled={!puedeEnviar || enviando} onClick={enviar}>
                        {enviando && <Loader2 size={14} className="animate-spin" />}
                        {enviando
                            ? 'Enviando...'
                            // Se dice cuántas van a salir ANTES de apretar: que
                            // una composición se parta en tres solicitudes es
                            // exactamente lo que no puede ser una sorpresa.
                            : salasDestino > 1 ? `Solicitar a ${salasDestino} salas` : 'Solicitar'}
                    </Button>
                </LiquidModal.Footer>
            )}
        </LiquidModal>
    );
}
