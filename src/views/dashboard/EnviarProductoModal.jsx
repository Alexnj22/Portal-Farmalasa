import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, Check, Loader2, Pencil, Send, Trash2, X } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import SearchInput from '../../components/common/SearchInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { EmptyState } from '../../components/common/StateViews';
import FotosDeEvidencia from '../../components/common/FotosDeEvidencia';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { buscarInventarioGlobalV2 } from '../../data/inventory';
import { fetchPresentaciones } from '../../data/inventoryMovements';
import { crearEnvio, despacharEnvio, envioNecesitaFoto, ERP_BODEGA, MAX_FOTOS_ENVIO, MOTIVOS_ENVIO, motivosEnvioPorDireccion, subirEvidenciaEnvio, TOPE_RENGLONES_ENVIO } from '../../data/envios';
import { lotesEnUnidades, repartirPedido, sumaUnidades } from '../../utils/unidadesInventario';
import { opcionesDePresentacion } from '../../utils/presentacion';
import { saveDraft, loadDraft, clearDraft } from '../../utils/draftUtils';
import { clickable } from '../../utils/clickable';

// Mandarle producto a otra sala sin que te lo pidan.
//
// Es el compositor de `PedirTrasladoModal` mirando al otro lado, y por eso se
// parece tanto: dos pantallas que hacen lo mismo con dos dibujos distintos
// obligan a aprender dos veces. Las mismas dos pestañas —«Agregar» y «En el
// envío · N»—, la misma tarjeta que nace cerrada, el mismo desplegable de
// presentación.
//
// ── Las tres diferencias, y las tres son de fondo ─────────────────────────
// 1. **El buscador busca en MI sala.** Allá se busca dónde HAY para pedirlo;
//    acá se busca lo que TENGO para mandarlo. Por eso sale de la búsqueda de
//    inventario recortada a la sala propia, y no de `fetchDondeHay`.
// 2. **La sala se elige al final y es UNA.** Allá cada renglón lleva su origen
//    —se le pide a tres salas en la misma composición—; acá el envío entero va
//    a una sola sala, porque es UNA caja que sale con el motorista.
// 3. **Al apretar, el producto SALE.** No hay nadie que apruebe antes: la
//    decisión de la otra sala llega después, cuando tiene la caja enfrente. Por
//    eso el botón dice «Transferir» y el pie avisa qué va a pasar.

/** Cuántas letras antes de salir a preguntar (misma regla que la consulta). */
const MIN_LETRAS = 3;

const NOMBRE_SALA = { 1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5' };
const MI_ERP_POR_BRANCH = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

/**
 * De qué ESTANTE sale el producto, dicho con una sola cadena.
 *
 * Bodega tiene dos —el de operación y el área donde aparta lo próximo a
 * vencer— y desde el 2026-08-24 de los dos se puede mandar. El
 * `erp_sucursal_id` dejó de alcanzar como identidad, porque las dos filas
 * traen el 6: todo lo que elige, compara o agrupa por origen usa ESTA clave.
 *
 * Es la misma de `PedirTrasladoModal`, y a propósito: son los dos lados del
 * mismo viaje, y dos claves distintas para el mismo estante obligarían a
 * aprender que son el mismo.
 */
const claveOrigen = (erp, vencidos) => (vencidos ? `${erp}:V` : String(erp ?? ''));

/**
 * Los motivos que valen para TODOS estos orígenes a la vez.
 *
 * Una composición sale como UN envío por sala de origen y el motivo es el mismo
 * para todos, así que lo que se puede ofrecer es la intersección: un motivo que
 * no valga para uno de los orígenes haría rebotar ESE envío y no los otros —
 * media composición mandada, que es peor que ninguna.
 *
 * ⚠️ **Puede devolver una lista vacía, y hasta el 2026-08-26 no podía.** Ese
 * día «Baja rotación» dejó de valer de Bodega hacia una sala, y con eso dejó de
 * estar en las tres listas. El caso exacto es destino una sala con orígenes
 * Bodega + alguna sala, y quien llama tiene que decirlo en vez de quedarse con
 * un desplegable sin opciones.
 */
const motivosParaOrigenes = (origenesEsBodega, destinoEsBodega) =>
    (origenesEsBodega.length ? origenesEsBodega : [false])
        .map(esBodega => motivosEnvioPorDireccion(esBodega, destinoEsBodega))
        .reduce((a, b) => a.filter(m => b.includes(m)));

/** Cómo se nombra cada estante. El sufijo es el que ya usa `get_donde_hay` del
 *  otro lado del viaje, así que quien pide y quien manda leen lo mismo. */
const nombreEstante = (erp, vencidos) =>
    `${NOMBRE_SALA[erp] ?? `Sucursal ${erp}`}${vencidos ? ' · Área de Vencidos' : ''}`;

const fmtVence = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { month: 'short', year: '2-digit' })
    : 'sin fecha';

export default function EnviarProductoModal({ onClose, onListo }) {
    const { user, getScope } = useAuth();
    const appendAuditLog = useStaffStore(s => s.appendAuditLog);

    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const miErp    = MI_ERP_POR_BRANCH[miBranch] ?? null;
    const claveBorrador = `envio_${miBranch ?? 'sin_sala'}`;

    /* ── Quién puede mandar desde una sala que no es la suya ──────────────
     *
     * Con alcance sobre TODAS —supervisión, administración, bodega central— el
     * envío no puede dar por sentado que el producto sale de la sala de quien
     * lo arma: esa persona no tiene una sala en el sentido que este formulario
     * necesita. Reportado así: «como multisala no me pregunta la sucursal para
     * hacer el traslado; si tiene el alcance todas debe salir en todos los que
     * sean necesarios».
     *
     * Entonces el buscador deja de recortar a una sala y cada renglón lleva la
     * SUYA. Es la misma forma que ya tiene el compositor de pedir a otra sala,
     * y por el mismo motivo: al mandar sale un envío POR SALA DE ORIGEN, porque
     * todo lo que hay debajo está clavado a un origen —el permiso, el documento
     * del sistema con su vale, y a quién se le avisa—.
     *
     * El servidor no se entera de esto: `validar_envio_producto` ya acepta
     * cualquier origen para quien tiene alcance ALL, y lo rebota para quien no.
     * Acá sólo se deja de esconder la pregunta. */
    const alcanceTodo = getScope('traslados') === 'ALL';

    /* Y si quien arma el envío ES Bodega. Cambia la dirección entera: Bodega es
     * la única que le manda producto a una sala. */
    const soyBodega = Number(miErp) === ERP_BODEGA;

    const [pestana, setPestana] = useState('agregar');
    const [termino, setTermino] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [resultados, setResultados] = useState(null);
    const [elegido, setElegido] = useState(null);
    // La CLAVE del estante, nunca el id de sala: Bodega tiene dos y el 6 no
    // distingue de cuál sale el producto.
    const [origenClave, setOrigenClave] = useState(null);
    const [presentaciones, setPresentaciones] = useState([]);
    const [presIdx, setPresIdx] = useState('0');
    const [cantidad, setCantidad] = useState('1');

    const [renglones, setRenglones] = useState([]);
    const [editando, setEditando] = useState(null);
    const [destino, setDestino] = useState('');
    const [motivo, setMotivo] = useState('');
    const [nota, setNota] = useState('');
    const [fotos, setFotos] = useState([]);   // File[] sin subir todavía

    const [enviando, setEnviando] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const [error, setError] = useState('');
    const [resultado, setResultado] = useState(null);

    /* ── El borrador ──────────────────────────────────────────────────────
     * La sesión de sala se cierra sola a los cinco minutos y esto es un
     * formulario largo: sin borrador, armar un envío de ocho productos y
     * atender a alguien en el medio significa volver a empezar, sin aviso y sin
     * rastro. Se guarda lo que se ESCRIBIÓ —renglones, sala, motivo—, nunca el
     * resultado: un envío que ya salió no se recompone. */
    useEffect(() => {
        const d = loadDraft(claveBorrador);
        if (!d) return;
        if (Array.isArray(d.renglones) && d.renglones.length) {
            setRenglones(d.renglones);
            setPestana('lista');
        }
        if (d.destino) setDestino(String(d.destino));
        if (d.motivo)  setMotivo(String(d.motivo));
        if (d.nota)    setNota(String(d.nota));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
    }, []);

    useEffect(() => {
        if (resultado) return;
        if (!renglones.length && !destino && !motivo && !nota) return;
        saveDraft(claveBorrador, { renglones, destino, motivo, nota });
    }, [renglones, destino, motivo, nota, claveBorrador, resultado]);

    /* ── El buscador ──────────────────────────────────────────────────────
     * Sale de la misma búsqueda que la consulta de inventario y se recorta a MI
     * sala: lo que otra sala tenga no se puede mandar desde acá.
     *
     * Y trae los DOS estantes. Hasta el 2026-08-24 el área de próximos a vencer
     * de Bodega se descartaba acá —«de ahí todavía no se envía»— y eso dejaba a
     * Bodega sin poder mandar justamente lo que más urge mover. Reportado así:
     * «bodega si debe de poder enviar a una sucursal productos del area de
     * vencidos. y no sale». Una sala ya podía PEDIR de esa área desde el
     * 2026-08-19; lo que faltaba era el mismo viaje ofrecido desde Bodega, y
     * negarlo no defendía nada. */
    useEffect(() => {
        const q = termino.trim();
        // Sin alcance sobre todas hace falta una sala propia: sin ella no hay de
        // dónde sacar el producto. Con alcance, la sala se elige por renglón.
        if (q.length < MIN_LETRAS || (!alcanceTodo && !miErp)) { setResultados(null); return; }
        let cancelado = false;
        setBuscando(true);
        const t = setTimeout(() => {
            buscarInventarioGlobalV2(q).then(({ filas }) => {
                if (cancelado) return;
                /* Un producto, sus salas. Antes esto se recortaba a la sala
                 * propia y el resultado era un solo número; con alcance sobre
                 * todas, el mismo producto está en varias y de cuál sale es
                 * justamente la pregunta que faltaba. */
                const porProducto = new Map();
                for (const f of filas ?? []) {
                    if (!alcanceTodo && Number(f.erp_sucursal_id) !== Number(miErp)) continue;
                    if (!NOMBRE_SALA[Number(f.erp_sucursal_id)]) continue;
                    if (!porProducto.has(f.erp_product_id)) {
                        porProducto.set(f.erp_product_id, {
                            erp_product_id: f.erp_product_id,
                            descripcion: f.descripcion,
                            porEstante: new Map(),
                        });
                    }
                    const p = porProducto.get(f.erp_product_id);
                    const erp = Number(f.erp_sucursal_id);
                    /* Por ESTANTE y no por sala. Los lotes del área de vencidos
                       y los del estante de operación son existencias distintas y
                       el despacho entra por ubicaciones distintas: sumarlos bajo
                       el mismo 6 ofrecería un total que ninguna de las dos
                       ubicaciones puede entregar, y el sistema lo rechazaría con
                       la caja ya armada. */
                    const clave = claveOrigen(erp, Boolean(f.is_vencidos));
                    if (!p.porEstante.has(clave)) {
                        p.porEstante.set(clave, { erp, vencidos: Boolean(f.is_vencidos), filas: [] });
                    }
                    p.porEstante.get(clave).filas.push(f);
                }
                setResultados([...porProducto.values()].map(p => ({
                    erp_product_id: p.erp_product_id,
                    descripcion: p.descripcion,
                    // El estante de operación primero y el área de vencidos
                    // después; dentro de cada uno, el que más tiene —es el que
                    // puede ceder sin quedarse corto—. Mismo orden con el que
                    // `get_donde_hay` los ofrece del otro lado del viaje.
                    salas: [...p.porEstante.values()]
                        .map(x => ({
                            clave: claveOrigen(x.erp, x.vencidos),
                            erp: x.erp,
                            vencidos: x.vencidos,
                            nombre: nombreEstante(x.erp, x.vencidos),
                            unidades: sumaUnidades(x.filas),
                            lotes: lotesEnUnidades(x.filas),
                        }))
                        .filter(x => x.unidades > 0)
                        .sort((a, b) => (a.vencidos === b.vencidos
                            ? b.unidades - a.unidades
                            : (a.vencidos ? 1 : -1))),
                })).filter(p => p.salas.length > 0));
                setBuscando(false);
            }).catch(() => { if (!cancelado) { setResultados([]); setBuscando(false); } });
        }, 250);
        return () => { cancelado = true; clearTimeout(t); setBuscando(false); };
    }, [termino, miErp, alcanceTodo]);

    // Las presentaciones del producto elegido. Viajan por SIGNIFICADO —tipo +
    // factor—, nunca por su id: el portal y el sistema de origen las numeran
    // distinto y sólo la etiqueta es estable entre los dos.
    useEffect(() => {
        if (!elegido?.erp_product_id) { setPresentaciones([]); return; }
        let cancelado = false;
        setPresentaciones([]);
        setPresIdx('0');
        fetchPresentaciones([elegido.erp_product_id]).then(r => {
            if (cancelado) return;
            setPresentaciones(r.porProducto.get(elegido.erp_product_id) ?? []);
        }).catch(() => {});
        return () => { cancelado = true; };
    }, [elegido?.erp_product_id]);

    /* De qué estante sale el producto en curso. Se elige solo —el de operación
     * de la sala propia si lo tiene, y si no el primero de la lista—, pero se
     * puede cambiar: con alcance sobre todas, de dónde sale el producto es una
     * decisión, no un dato.
     *
     * La búsqueda de la sala propia excluye el área de vencidos a propósito:
     * mandar corto vence es una decisión y tiene que haberse tomado, no
     * heredarse de que el estante de operación estaba en cero. Si es lo único
     * que hay, queda elegido igual —va primero en la lista— pero con su aviso
     * abajo. */
    useEffect(() => {
        if (!elegido) { setOrigenClave(null); return; }
        const propia = elegido.salas.find(x => Number(x.erp) === Number(miErp) && !x.vencidos);
        setOrigenClave((propia ?? elegido.salas[0]).clave);
    }, [elegido, miErp]);

    const origen = elegido?.salas?.find(x => x.clave === origenClave) ?? null;

    const pres = presentaciones[Number(presIdx)] ?? null;
    const unidadesPedidas = (Number(cantidad) || 0) * (Number(pres?.factor) || 0);
    const reparto = useMemo(
        () => (origen && unidadesPedidas > 0
            ? repartirPedido(origen.lotes ?? [], unidadesPedidas)
            : { reparto: [], faltan: 0 }),
        [origen, unidadesPedidas],
    );

    /* ── El tope, dicho ANTES ─────────────────────────────────────────────
     * Existía desde el primer día —el despacho vive 110 s— y se descubría a
     * mitad de camino, con parte de la caja ya fuera de la sala. El número sale
     * de medir el pedido de Bodega, que despacha igual: ver
     * `TOPE_RENGLONES_ENVIO`. */
    const lleno = renglones.length >= TOPE_RENGLONES_ENVIO;

    /* Si el destino es Bodega. Se calcula acá arriba y no junto al desplegable
     * porque la tabla de motivos la necesitan las DOS puntas: el freno de este
     * paso —al agregar el renglón— y la lista que se ofrece al final. */
    const destinoEsBodega = Number(destino) === ERP_BODEGA;

    /* Qué extremos tiene YA el envío, dicho como «¿es Bodega?». Es lo que
     * decide qué motivos quedan posibles: una composición sale como un envío
     * por sala de origen y el motivo es uno solo para todos. */
    const origenesEnElEnvio = useMemo(
        () => [...new Set(renglones.map(r => Number(r.origen_erp ?? miErp) === ERP_BODEGA))],
        [renglones, miErp],
    );

    const problemaDelPaso = lleno
            ? `Un envío admite hasta ${TOPE_RENGLONES_ENVIO} productos. Manda éste y arma otro con el resto.`
        : !elegido ? 'Elige un producto.'
        : !origen ? 'Elige de qué sala sale.'
        : !pres ? 'Elige la presentación.'
        : unidadesPedidas <= 0 ? 'Pon la cantidad.'
        : unidadesPedidas > (origen.unidades ?? 0)
            ? `${origen.nombre} tiene ${origen.unidades} ${origen.unidades === 1 ? 'unidad' : 'unidades'}.`
        : reparto.faltan > 0 ? `Faltan ${reparto.faltan} en los lotes.`
        // El origen y el destino se eligen en dos momentos distintos y nada los
        // ata: sin esto, un renglón podía salir de la misma sala a la que va —y
        // eso el servidor lo rebota recién al apretar «Transferir».
        : String(origen.erp) === String(destino)
            ? `${origen.nombre} es la sala a la que va el envío.`
        // Y si el motivo ya está elegido, que valga para ESTA sala de origen.
        // Puede no valer: una composición saca de varias salas y el motivo es
        // uno solo — de Bodega se puede mandar un producto nuevo, de una sala
        // no. Se dice con el renglón todavía sin agregar, y no al apretar
        // «Transferir» con la caja armada.
        : destino && motivo && !motivosEnvioPorDireccion(
              Number(origen.erp) === ERP_BODEGA, destinoEsBodega).includes(motivo)
            ? `«${motivo}» no vale para lo que sale de ${origen.nombre}.`
        // Y aunque todavía no haya motivo elegido, este renglón puede dejar al
        // envío SIN ninguno posible. Pasa desde el 2026-08-26, cuando «Baja
        // rotación» dejó de valer de Bodega hacia una sala: si el envío va a
        // una sala y saca de Bodega y de otra sala a la vez, no hay un rótulo
        // que sea cierto para los dos —uno es reparto y el otro es sobrante—.
        // Se dice acá, con el renglón todavía sin agregar, y no con un
        // desplegable de motivos vacío que no explica nada.
        : destino && renglones.length > 0 && motivosParaOrigenes(
              [...origenesEnElEnvio, Number(origen.erp) === ERP_BODEGA], destinoEsBodega).length === 0
            ? `Lo que sale de ${origen.nombre} no comparte motivo con lo que ya está en el envío. Mándalo aparte.`
        : null;

    const agregar = useCallback(() => {
        if (problemaDelPaso || !elegido || !pres || !origen) return;
        if (renglones.length >= TOPE_RENGLONES_ENVIO) return;
        setRenglones(r => [...r, {
            erp_product_id: elegido.erp_product_id,
            descripcion: elegido.descripcion,
            // De qué sala sale ESTE renglón. Va en el renglón y no en el envío
            // porque una composición puede sacar producto de varias salas, y al
            // mandar sale un envío por cada una.
            origen_erp: Number(origen.erp),
            // Y de qué ESTANTE de esa sala. Viaja con el renglón porque el
            // despacho entra por una ubicación distinta según cuál sea, y
            // porque una composición puede sacar del estante de operación de
            // Bodega y de su área de vencidos a la vez: son dos envíos.
            origen_vencidos: Boolean(origen.vencidos),
            origen_clave: origen.clave,
            origen_nombre: origen.nombre,
            presentacion_tipo: pres.tipo,
            factor: Number(pres.factor),
            cantidad: Number(cantidad),
            unidades: unidadesPedidas,
            // El reparto por lote viaja con el renglón: es la elección de quien
            // manda, y lo que el despacho usa como reserva. Sin él, quien
            // despacha elegiría el lote por su cuenta — y un envío por «próximo
            // a vencer» sin decir cuál lote es exactamente lo contrario de lo
            // que se quiso hacer.
            lotes: reparto.reparto.map(l => ({ lote: l.lote, vence: l.vence, unidades: l.toma })),
            // Cuántas tiene ESA sala AHORA. Es lo que deja avisar en la lista
            // si se agregó dos veces el mismo producto y entre los dos se pasan.
            existencia: origen.unidades,
            presentaciones,
        }]);
        setElegido(null);
        setTermino('');
        setResultados(null);
        setCantidad('1');
        setPestana('lista');
    }, [problemaDelPaso, elegido, origen, pres, cantidad, unidadesPedidas, reparto, presentaciones, renglones.length]);

    const quitar = (i) => {
        setRenglones(r => r.filter((_, k) => k !== i));
        setEditando(null);
    };

    const editarRenglon = (i, cambios) => {
        setRenglones(rs => rs.map((r, k) => {
            if (k !== i) return r;
            const tipo   = cambios.presentacion_tipo ?? r.presentacion_tipo;
            const factor = Number(cambios.factor ?? r.factor) || 1;
            const cant   = cambios.cantidad !== undefined
                ? Math.max(0, Math.floor(Number(cambios.cantidad)) || 0)
                : Number(r.cantidad) || 0;
            // El factor MULTIPLICA: cambiar UNIDAD por CAJA X 10 sin rehacer el
            // reparto convierte 5 en cincuenta veces el producto.
            return { ...r, presentacion_tipo: tipo, factor, cantidad: cant, unidades: cant * factor };
        }));
    };

    /* Lo que suma cada producto entre todos sus renglones, contra lo que la sala
     * tiene. Se mira acá y no renglón por renglón porque el mismo producto
     * puede estar dos veces: dos renglones de 5 sobre una existencia de 8 son
     * dos renglones válidos y un envío imposible, y eso hoy sólo se descubría
     * al apretar. */
    const excesos = useMemo(() => {
        // Por producto Y ESTANTE: el mismo producto sacado de dos estantes
        // distintos son dos existencias distintas, y sumarlas inventaría un
        // exceso donde no lo hay. Vale para dos salas y vale para los dos
        // estantes de Bodega.
        const porClave = new Map();
        for (const r of renglones) {
            const clave = `${r.erp_product_id}|${r.origen_clave
                ?? claveOrigen(r.origen_erp ?? miErp, r.origen_vencidos)}`;
            const a = porClave.get(clave) ?? {
                unidades: 0, existencia: r.existencia ?? 0,
                nombre: r.descripcion, sala: r.origen_nombre ?? NOMBRE_SALA[miErp] ?? 'tu sala',
            };
            a.unidades += r.unidades;
            porClave.set(clave, a);
        }
        return [...porClave.values()].filter(a => a.unidades > a.existencia);
    }, [renglones, miErp]);

    /* A dónde puede ir. Cualquiera menos la propia; con alcance sobre todas se
     * ofrecen TODAS —quien manda no tiene una sala en este sentido— y lo que
     * impide mandarse algo a sí misma es el freno por renglón.
     *
     * El destino NO se recorta por la regla del circuito. Entre el 2026-08-24 y
     * ese mismo día lo estuvo —desde una sala el único destino era Bodega— y el
     * usuario lo encontró probándolo: *«pero si es por baja rotacion, si debe
     * poder enviarse a otra sucursal»*. Recortar acá era poner la regla dos
     * veces, y la de más adentro estaba mal. Hoy toda dirección se puede
     * elegir; lo que cambia según los extremos es QUÉ MOTIVOS se ofrecen. */
    const salasDestino = useMemo(
        () => Object.entries(NOMBRE_SALA)
            .filter(([erp]) => alcanceTodo || Number(erp) !== Number(miErp))
            .map(([erp, nombre]) => ({ value: erp, label: nombre })),
        [miErp, alcanceTodo],
    );

    /* Un destino que venía del borrador puede haber dejado de ser posible
     * —cambió el cargo, cambió de sala—. Un valor que la lista ya no ofrece se
     * queda pegado en el estado y sale a rebotar al servidor. */
    useEffect(() => {
        if (destino && !salasDestino.some(x => String(x.value) === String(destino))) setDestino('');
    }, [salasDestino, destino]);

    /* Qué motivos valen entre los extremos de ESTE envío.
     *
     * Es la intersección sobre las salas de origen presentes, no la lista de
     * una sola: una composición sale como UN envío por sala de origen y el
     * motivo es el mismo para todos, así que un motivo que no valga para uno de
     * los orígenes haría rebotar ese envío y no los otros — media composición
     * mandada, que es peor que ninguna.
     *
     * PUEDE quedar vacía desde el 2026-08-26 — ver `motivosParaOrigenes` y
     * `sinMotivoPosible` acá abajo. */
    const motivosPosibles = useMemo(() => {
        if (!destino) return MOTIVOS_ENVIO;
        return motivosParaOrigenes(
            origenesEnElEnvio.length ? origenesEnElEnvio : [soyBodega], destinoEsBodega);
    }, [destino, destinoEsBodega, origenesEnElEnvio, soyBodega]);

    /* Y si no quedó ninguno. El freno de `problemaDelPaso` lo evita al agregar,
     * pero se puede llegar acá por el otro lado: con la caja ya armada desde
     * Bodega y desde una sala, se elige DESPUÉS una sala de destino. Un
     * desplegable vacío no dice nada, así que se dice qué pasó y qué hacer. */
    const sinMotivoPosible = Boolean(destino) && motivosPosibles.length === 0;

    /* Y si lo único que queda es «Baja rotación», decir por qué. Es el caso de
     * sala a sala, y sin la explicación el desplegable con una sola opción se
     * lee como un defecto en vez de como la regla que es. */
    const soloSobrante = motivosPosibles.length === 1 && motivosPosibles[0] === 'Baja rotación';

    /* Qué motivos quedaron afuera por ir sólo hacia Bodega. Se CALCULA en vez de
     * escribirse: el mismo aviso escrito a mano decía «y si es por vencimiento,
     * va a Bodega» y se quedó viejo el día que se agregó «Retiro del mercado» —
     * un texto no falla nunca, sólo deja de ser cierto. Es la misma cuenta que
     * hace el mensaje del servidor, y por el mismo motivo. */
    const soloHaciaBodega = useMemo(
        () => motivosEnvioPorDireccion(false, true).filter(m => !motivosPosibles.includes(m)),
        [motivosPosibles],
    );

    /* El motivo elegido antes del destino —o traído del borrador— puede no
     * valer en la dirección que quedó. Se limpia en vez de mandarlo: el
     * servidor lo rebota igual, y descubrirlo al apretar es tarde. */
    useEffect(() => {
        if (motivo && !motivosPosibles.includes(motivo)) setMotivo('');
    }, [motivosPosibles, motivo]);

    /* ── La foto, y sólo donde hay algo que ver ────────────────────────────
     *
     * Espejo de `motivos_envio_con_foto()`: hoy la pide sólo la avería. Los
     * otros cuatro motivos se pueden comprobar contra un dato —el vencimiento
     * está en el lote, la rotación en las ventas—; el daño no, y cuando la caja
     * llega a Bodega ya viajó.
     *
     * Al cambiar a un motivo que no la pide, la foto se DESCARTA. Guardarla
     * «por si acaso» la convertiría en evidencia de algo que nadie fotografió:
     * un envío por baja rotación llegaría con la foto de un frasco roto y sin
     * nada que la explique. */
    const pideFoto = envioNecesitaFoto(motivo);

    useEffect(() => {
        if (!pideFoto && fotos.length) setFotos([]);
    }, [pideFoto, fotos.length]);

    /* Los renglones que quedaron apuntando a la sala a la que va el envío.
     * Puede pasar al revés del freno de arriba: se agrega el renglón y DESPUÉS
     * se elige ese mismo destino. */
    const chocanConElDestino = useMemo(
        () => renglones.filter(r => destino && String(r.origen_erp ?? miErp) === String(destino)),
        [renglones, destino, miErp],
    );

    /* ¿El envío saca de más de una sala? Es lo que decide si la lista tiene que
     * decir de dónde sale cada renglón y si el pie habla de un envío o de
     * varios. */
    const variosOrigenes = useMemo(
        () => new Set(renglones.map(r => r.origen_clave
            ?? claveOrigen(r.origen_erp ?? miErp, r.origen_vencidos))).size > 1,
        [renglones, miErp],
    );

    /* Qué le falta al envío para poder salir. Se dice en UNA frase y no con el
     * botón apagado a secas: un botón que no se puede apretar y no dice por qué
     * es un callejón sin salida. */
    const faltaParaMandar = renglones.length === 0 ? 'Agrega al menos un producto.'
        : excesos.length > 0 ? 'Estás mandando más de lo que hay.'
        : !destino ? 'Elige la sala de destino.'
        : chocanConElDestino.length > 0 ? 'Hay producto que sale de la misma sala a la que va.'
        // Antes de «Elige el motivo»: si no hay ninguno posible, ese aviso
        // mandaría a un desplegable vacío — un callejón sin salida con forma de
        // instrucción.
        : sinMotivoPosible ? 'Separa lo que sale de Bodega de lo que sale de una sala.'
        : !motivo ? 'Elige el motivo.'
        // La foto es lo único que le queda a Bodega para decidir si se le
        // reclama al proveedor: el daño viaja con la caja y no se puede volver
        // a mirar. La base la exige igual, así que pedirla acá sólo adelanta el
        // aviso a antes de apretar.
        : pideFoto && fotos.length === 0 ? 'Falta la foto del daño.'
        // Cuatro letras es el mismo piso que cobra la base: menos que eso no
        // explica nada, y que se rebote recién al apretar sería peor.
        : nota.trim().length < 4 ? 'Escribe por qué se lo mandas.'
        : nota.trim().toLowerCase() === motivo.toLowerCase()
            ? 'El motivo escrito no puede ser sólo la categoría de arriba.'
        : null;

    const listoParaMandar = !faltaParaMandar;

    const transferir = async () => {
        if (!listoParaMandar || enviando) return;
        setEnviando(true);
        setError('');
        try {
            const erpDestino = Number(destino);

            /* ── La evidencia va PRIMERO ───────────────────────────────────
             * Si la subida falla, el envío no se crea y el producto no se
             * mueve. Un envío por avería sin la foto es exactamente el que
             * Bodega no puede decidir —y la base lo rebota igual—, así que
             * dejarlo entrar «para no perder lo escrito» sólo cambiaría el
             * momento del error, con el producto ya fuera de la sala. */
            let evidencia = [];
            if (pideFoto && fotos.length) {
                setSubiendo(true);
                evidencia = await subirEvidenciaEnvio(fotos, { salaId: miBranch, userId: user?.id });
                setSubiendo(false);
            }

            /* ── Una composición, un envío POR SALA DE ORIGEN ──────────────
             *
             * Todo lo que hay debajo está clavado a UN origen: el permiso que
             * decide quién puede despacharlo, el documento del sistema —uno por
             * origen, con su propio número de vale— y a quién se le avisa. Una
             * sola fila con dos orígenes no se podría despachar ni recibir.
             *
             * Es la misma forma que ya tiene el compositor de pedir a otra
             * sala, y el orden de los renglones dentro de cada envío importa:
             * la posición es el nombre del renglón para todo el circuito. */
            const porOrigen = new Map();
            for (const r of renglones) {
                const erp = Number(r.origen_erp ?? miErp);
                /* Y por ESTANTE, no sólo por sala: el de operación de Bodega y
                 * su área de vencidos son dos ubicaciones del sistema y el
                 * despacho entra por una sola. Un envío que mezclara las dos
                 * sacaría todo de la que nombre el metadata —o sea, de la que
                 * no es— y el sistema lo rechazaría con la caja ya armada. */
                const clave = r.origen_clave ?? claveOrigen(erp, r.origen_vencidos);
                if (!porOrigen.has(clave)) {
                    porOrigen.set(clave, { erp, vencidos: Boolean(r.origen_vencidos), grupo: [] });
                }
                porOrigen.get(clave).grupo.push(r);
            }

            const filas = [...porOrigen.values()].map(({ erp: erpOrigen, vencidos, grupo }) => ({
                employee_id: user?.id,
                type: 'INVENTORY_TRANSFER_PUSH',
                status: 'PENDING',
                note: nota.trim() || motivo,
                metadata: {
                    motivo_tipo: motivo,
                    reason: nota.trim() || motivo,
                    /* Las mismas fotos en cada envío de la composición: el daño
                       es del producto, y cada envío es una parte de la misma
                       caja. Sin evidencia no se manda la clave — la base sólo
                       la exige donde el motivo la pide. */
                    ...(evidencia.length ? { evidencia_urls: evidencia } : {}),
                    // La sala que ENVÍA: la del renglón, no la de quien arma.
                    origen_erp_sucursal_id: erpOrigen,
                    /* Y de qué estante suyo. Sólo cuando es el área de
                       vencidos: la clave ausente significa el estante de
                       operación, que es como la leen el trigger y la función
                       que despacha. */
                    ...(vencidos ? { origen_vencidos: true } : {}),
                    origen_branch_name: grupo[0].origen_nombre
                        ?? NOMBRE_SALA[erpOrigen]
                        ?? user?.branchName ?? user?.branch_name ?? '',
                    // La que recibe. El `branch_id` lo resuelve la base desde el
                    // mapa: qué sala del portal es cada sucursal del sistema no
                    // lo decide el navegador.
                    erp_sucursal_id: erpDestino,
                    branch_name: NOMBRE_SALA[erpDestino] ?? '',
                    items: grupo.map(r => ({
                        erp_product_id: r.erp_product_id,
                        descripcion: r.descripcion,
                        presentacion_tipo: r.presentacion_tipo,
                        factor: r.factor,
                        cantidad: r.cantidad,
                        lotes: r.lotes ?? null,
                    })),
                },
            }));

            /* Entran TODAS o no entra ninguna: un solo `insert`. Media
             * composición enviada, sin forma de saber cuál mitad, es peor que
             * ninguna. */
            const { data, error: e } = await crearEnvio(filas);
            if (e) throw e;

            /* Y recién ahora sale el producto. Son dos pasos porque el primero
             * deja el rastro —con sus renglones, en la misma transacción— y el
             * segundo mueve inventario: si el segundo no sale, el envío queda
             * con todo por despachar y se retoma desde la tarjeta. Lo que no
             * puede pasar es lo contrario.
             *
             * Uno por uno y no en paralelo: cada despacho abre su propia sesión
             * contra el sistema de origen, y el sistema sigue a la sesión —dos
             * a la vez podrían escribir con la sucursal de la otra. */
            const creados = Array.isArray(data) ? data : [data];
            const salidas = [];
            for (const fila of creados) {
                salidas.push(await despacharEnvio(fila.id));
            }

            const enviadas = salidas.reduce((n, x) => n + (x?.enviadas ?? 0), 0);
            const fallos   = salidas.flatMap(x => x?.fallos ?? []);
            const avisos   = [...new Set(salidas.map(x => x?.error).filter(Boolean))];

            await appendAuditLog('ENVIO_A_OTRA_SALA', String(miBranch ?? ''), {
                envios: creados.map(x => x.id),
                sala: NOMBRE_SALA[erpDestino] ?? erpDestino,
                desde: [...porOrigen.values()].map(o => nombreEstante(o.erp, o.vencidos)),
                productos: renglones.length,
                unidades: renglones.reduce((s, x) => s + x.unidades, 0),
                motivo,
                fotos: evidencia.length,
                enviadas,
                fallos: fallos.length,
            });

            clearDraft(claveBorrador);
            setFotos([]);
            setResultado({
                sala: NOMBRE_SALA[erpDestino] ?? '',
                desde: [...porOrigen.values()].map(o => nombreEstante(o.erp, o.vencidos)),
                total: renglones.length,
                enviadas,
                fallos,
                aviso: avisos.length ? avisos.join(' · ') : null,
            });
            setRenglones([]);
            onListo?.();
        } catch (e) {
            const msg = String(e?.message ?? '');
            setError(
                msg.includes('row-level security')
                    ? 'No tienes permiso para enviar producto a otra sala.'
                    : (e?.message ?? 'No se pudo enviar.'),
            );
            // También si lo que falló fue la subida: el rótulo del botón no
            // puede quedarse en «Subiendo la foto…» sobre un envío que ya se
            // detuvo.
            setSubiendo(false);
            setEnviando(false);
        }
    };

    /* ── El desenlace ─────────────────────────────────────────────────────
     * Se queda en pantalla hasta que la persona la cierre y NO se autocierra:
     * acá el producto ya salió, y si algún renglón no pudo salir hay que poder
     * leer cuál. */
    if (resultado) {
        /* El desenlace tiene que decir la VERDAD, no celebrar.
         *
         * Decía «Producto en camino» con su tilde verde aunque hubieran salido
         * cero —visto en el entorno de pruebas—, y eso es exactamente lo que un
         * aviso no puede hacer: quien lo lee da el envío por hecho, deja de
         * mirar, y el producto sigue en su estante. Son tres desenlaces y cada
         * uno se llama por su nombre. */
        const nadaSalio = resultado.enviadas === 0;
        const parcial   = !nadaSalio && resultado.enviadas < resultado.total;
        return (
            <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Resultado del envío">
                <LiquidModal.Header>
                    <div className="flex items-center gap-2.5">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            nadaSalio ? 'bg-danger/10' : parcial ? 'bg-warning/10' : 'bg-success/10'}`}>
                            {nadaSalio
                                ? <AlertTriangle size={16} className="text-danger-text" strokeWidth={2.5} />
                                : <Check size={16} className={parcial ? 'text-warning-text' : 'text-success-text'} strokeWidth={2.5} />}
                        </div>
                        <p className="text-body font-black text-content">
                            {nadaSalio ? 'No salió nada' : parcial ? 'Salió una parte' : 'Producto en camino'}
                        </p>
                    </div>
                </LiquidModal.Header>
                <LiquidModal.Body className="flex flex-col gap-3">
                    <p className="text-body-sm text-content-2 font-medium leading-snug">
                        {nadaSalio
                            ? `El envío a ${resultado.sala} quedó armado y el producto sigue en su estante.`
                            : `Salieron ${resultado.enviadas} de ${resultado.total} ${
                                resultado.total === 1 ? 'producto' : 'productos'} para ${resultado.sala}`
                              + ((resultado.desde ?? []).length > 1
                                  ? `, desde ${resultado.desde.join(' y ')}.`
                                  : '.')}
                        {resultado.enviadas > 0 && ' Ya les avisamos: cuando abran la caja deciden qué se quedan.'}
                    </p>
                    {resultado.aviso && (
                        <p className={`text-label font-semibold leading-snug ${
                            nadaSalio ? 'text-danger-text' : 'text-warning-text'}`}>{resultado.aviso}</p>
                    )}
                    {(resultado.fallos.length > 0 || nadaSalio) && (
                        <div className="flex flex-col gap-1">
                            {resultado.fallos.length > 0 && (
                                <p className="text-caption font-black text-content-2 uppercase tracking-widest">
                                    No salieron
                                </p>
                            )}
                            {resultado.fallos.map((f, i) => (
                                <p key={i} className="text-micro text-danger-text font-semibold leading-snug">
                                    {f.producto}: {f.error}
                                </p>
                            ))}
                            <p className="text-micro text-content-3 font-medium leading-snug mt-1">
                                Quedan en el envío, bajo «Sin salir de tu sala», y ahí mismo se vuelve a intentar.
                            </p>
                        </div>
                    )}
                </LiquidModal.Body>
                <LiquidModal.Footer>
                    <Button variant="primary" onClick={onClose} className="min-h-[var(--tap-min)]">Listo</Button>
                </LiquidModal.Footer>
            </LiquidModal>
        );
    }

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Enviar a otra sala">
            <LiquidModal.Header>
                <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                        <Send size={15} className="text-brand-text" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-body font-black text-content leading-tight">Enviar a otra sala</p>
                        <p className="text-label text-content-3 mt-0.5">
                            {/* «tu sala» sólo cuando de verdad es la propia: con
                                alcance sobre todas, el producto sale de la sala
                                que se elija en cada renglón. */}
                            {alcanceTodo
                                ? 'Producto que sale de una sala hacia otra'
                                : 'Producto que sale de tu sala hacia otra'}
                        </p>
                    </div>
                    <Button variant="ghost" size="xs" icon={X} iconOnly onClick={onClose} aria-label="Cerrar" />
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="flex flex-col gap-3 min-h-0">
                <div className="shrink-0">
                    <SegmentedControl
                        value={pestana}
                        onChange={setPestana}
                        options={[
                            { value: 'agregar', label: 'Agregar' },
                            // El contador muestra el tope cuando falta poco: enterarse
                            // de que no entra otro AL APRETAR «agregar» es peor que verlo
                            // venir con tres renglones de anticipación.
                            { value: 'lista', label: `En el envío${renglones.length
                                ? ` · ${renglones.length}${renglones.length >= TOPE_RENGLONES_ENVIO - 3 ? `/${TOPE_RENGLONES_ENVIO}` : ''}`
                                : ''}` },
                        ]}
                    />
                </div>

                {pestana === 'agregar' && (
                    <div className="flex flex-col gap-3">
                        <SearchInput
                            value={termino}
                            onChange={setTermino}
                            placeholder="Busca el producto que vas a mandar"
                            ariaLabel="Buscar producto en tu sala"
                        />

                        {!elegido && (
                            <>
                                {termino.trim().length > 0 && termino.trim().length < MIN_LETRAS && (
                                    <p className="text-micro text-content-3 font-medium px-1">
                                        Escribe al menos {MIN_LETRAS} letras.
                                    </p>
                                )}
                                {buscando && (
                                    <p className="text-label text-content-3 font-medium px-1 flex items-center gap-1.5">
                                        <Loader2 size={13} className="animate-spin" /> Buscando…
                                    </p>
                                )}
                                {!buscando && resultados?.length === 0 && (
                                    <EmptyState linea title="Tu sala no tiene ese producto" />
                                )}
                                {!buscando && resultados?.length > 0 && (
                                    <div className="flex flex-col gap-1.5">
                                        {resultados.map(p => (
                                            <button
                                                key={p.erp_product_id}
                                                type="button"
                                                data-surface="card"
                                                data-interactive
                                                className={`${clickable()} text-left px-3 py-2.5 min-h-[var(--tap-min)]`}
                                                onClick={() => setElegido(p)}
                                            >
                                                <p className="text-body-sm font-black text-content leading-tight">
                                                    {p.descripcion}
                                                </p>
                                                {/* Dónde HAY, y cuánto. Con alcance sobre
                                                    todas el mismo producto está en varias
                                                    salas, y saber en cuáles es lo que
                                                    decide de dónde conviene sacarlo. */}
                                                <p className="text-micro font-semibold text-content-2 mt-0.5">
                                                    {p.salas.map(x => `${x.nombre} ${x.unidades}`).join(' · ')}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {elegido && (
                            <div data-surface="card" className="px-3 py-3 flex flex-col gap-3">
                                <div className="flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-body-sm font-black text-content leading-tight">
                                            {elegido.descripcion}
                                        </p>
                                        <p className="text-micro font-semibold text-content-2 mt-0.5">
                                            {origen
                                                ? `${origen.nombre} tiene ${origen.unidades} ${
                                                    origen.unidades === 1 ? 'unidad' : 'unidades'}`
                                                : 'Elige de qué sala sale'}
                                        </p>
                                    </div>
                                    <Button variant="ghost" size="xs" icon={X} iconOnly
                                        onClick={() => setElegido(null)} aria-label="Elegir otro producto" />
                                </div>

                                {/* ── De qué sala sale ──────────────────────────
                                    Sólo cuando hay más de una: con una sola, un
                                    desplegable de un elemento es un control que no
                                    decide nada. Y aparece ANTES de la cantidad
                                    porque la cambia — cada sala tiene su existencia
                                    y sus lotes. */}
                                {elegido.salas.length > 1 && (
                                    <div>
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Sale de</p>
                                        <LiquidSelect
                                            clearable={false}
                                            value={String(origenClave ?? '')}
                                            onChange={v => setOrigenClave(String(v ?? ''))}
                                            options={elegido.salas.map(x => ({
                                                value: x.clave,
                                                label: `${x.nombre} · ${x.unidades} ${x.unidades === 1 ? 'unidad' : 'unidades'}`,
                                            }))}
                                            ariaLabel="Estante del que sale el producto"
                                        />
                                    </div>
                                )}

                                {/* ── Y si sale del área de vencidos ────────────
                                    El rótulo del desplegable ya lo dice, pero se
                                    lee al elegir y después se deja de mirar; acá
                                    queda a la vista mientras se decide la
                                    cantidad, que es el momento en que importa.
                                    Es el mismo aviso que da la pantalla de pedir,
                                    y por el mismo motivo: en esa área Bodega
                                    aparta lo próximo a vencer, así que hay lotes
                                    con poca vida y también los hay ya vencidos.

                                    Dice qué mirar y no opina: cuál lote es cuál
                                    se ve abajo en «Sale de», con su fecha. Frenar
                                    el envío no es de esta pantalla — quien lo
                                    arma tiene la caja delante. */}
                                {origen?.vencidos && (
                                    <p className="text-micro font-semibold text-warning-text leading-snug px-1">
                                        Sale del área donde se aparta lo próximo a vencer. Revisa abajo la
                                        fecha de cada lote antes de mandarlo.
                                    </p>
                                )}

                                <div className="flex flex-wrap items-end gap-2">
                                    <div className="w-24">
                                        <PortalInput
                                            label="Cantidad"
                                            type="number" min="1"
                                            value={cantidad}
                                            onChange={e => setCantidad(e.target.value)}
                                            aria-label="Cantidad a enviar"
                                        />
                                    </div>
                                    <div className="min-w-[10rem] flex-1">
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Presentación</p>
                                        <LiquidSelect
                                            clearable={false}
                                            value={presIdx}
                                            onChange={v => setPresIdx(String(v))}
                                            options={opcionesDePresentacion(presentaciones, origen?.unidades ?? 0)}
                                            ariaLabel="Presentación"
                                        />
                                    </div>
                                </div>

                                {/* De qué lotes va a salir. No es adorno: un envío por
                                    «próximo a vencer» existe justamente para mandar ESE
                                    lote, y verlo antes es la única forma de saber que se
                                    está mandando el que se quería mandar. */}
                                {reparto.reparto.length > 0 && (
                                    <p className="text-micro font-semibold text-content-2 leading-snug">
                                        Sale de: {reparto.reparto.map(l =>
                                            `${l.lote || 'sin lote'} ×${l.toma}`
                                            + (l.vence ? ` (vence ${fmtVence(l.vence)})` : '')).join(' · ')}
                                    </p>
                                )}

                                {problemaDelPaso ? (
                                    <p className="text-micro font-semibold text-danger-text leading-snug">
                                        {problemaDelPaso}
                                    </p>
                                ) : (
                                    <p className="text-micro font-semibold text-content-3 leading-snug">
                                        {unidadesPedidas} {unidadesPedidas === 1 ? 'unidad' : 'unidades'} en total
                                    </p>
                                )}

                                <Button variant="secondary" onClick={agregar}
                                    disabled={Boolean(problemaDelPaso)}
                                    className="min-h-[var(--tap-min)]">
                                    Agregar al envío
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {pestana === 'lista' && (
                    <div className="flex flex-col gap-3">
                        {renglones.length === 0 ? (
                            <p className="text-label text-content-3 font-medium py-8 text-center leading-snug">
                                Todavía no agregaste nada.<br />
                                <span className="text-micro">
                                    Busca el producto en «Agregar», ponle la cantidad y aprieta «Agregar al envío».
                                </span>
                            </p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {renglones.map((r, i) => {
                                    const abierta = editando === i;
                                    return (
                                        <div key={i} data-surface="card" className="px-3 py-2.5">
                                            <div className="flex items-start gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-body-sm font-black text-content truncate">
                                                        {r.descripcion}
                                                    </p>
                                                    {!abierta && (
                                                        <p className="text-micro font-semibold text-content-2 mt-0.5 truncate">
                                                            {r.cantidad} × {r.presentacion_tipo}
                                                            {' · '}{r.unidades} {r.unidades === 1 ? 'unidad' : 'unidades'}
                                                            {/* De qué estante sale, cuando el envío saca
                                                                de más de uno: con uno solo es un dato que
                                                                se repite en cada renglón. Y SIEMPRE que
                                                                salga del área de vencidos, aunque sea el
                                                                único origen: es lo que un envío de corto
                                                                vence tiene que decir de sí mismo. */}
                                                            {(variosOrigenes || r.origen_vencidos) && r.origen_nombre
                                                                ? ` · desde ${r.origen_nombre}` : ''}
                                                        </p>
                                                    )}
                                                </div>
                                                <Button variant="ghost" size="xs" iconOnly
                                                    icon={abierta ? Check : Pencil}
                                                    aria-label={abierta ? 'Listo' : `Corregir ${r.descripcion}`}
                                                    onClick={() => setEditando(abierta ? null : i)} />
                                                <Button variant="ghost" size="xs" icon={Trash2} iconOnly
                                                    aria-label={`Quitar ${r.descripcion}`}
                                                    onClick={() => quitar(i)} />
                                            </div>

                                            {abierta && (
                                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                                    <div className="w-20">
                                                        <PortalInput
                                                            type="number" min="1"
                                                            value={String(r.cantidad)}
                                                            onChange={e => editarRenglon(i, { cantidad: e.target.value })}
                                                            aria-label={`Cantidad de ${r.descripcion}`}
                                                        />
                                                    </div>
                                                    {(r.presentaciones ?? []).length > 1 ? (
                                                        <div className="min-w-[9rem] flex-1">
                                                            <LiquidSelect
                                                                nano clearable={false}
                                                                value={`${r.presentacion_tipo}|${r.factor}`}
                                                                onChange={v => {
                                                                    const [tipo, factor] = String(v).split('|');
                                                                    editarRenglon(i, { presentacion_tipo: tipo, factor: Number(factor) });
                                                                }}
                                                                options={(r.presentaciones ?? []).map(p => ({
                                                                    value: `${p.tipo}|${p.factor}`,
                                                                    label: p.tipo,
                                                                }))}
                                                                ariaLabel={`Presentación de ${r.descripcion}`}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <span className="text-micro font-semibold text-content-2">
                                                            {r.presentacion_tipo}
                                                        </span>
                                                    )}
                                                    <span className="text-micro font-semibold text-content-2">
                                                        {r.unidades} {r.unidades === 1 ? 'unidad' : 'unidades'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {chocanConElDestino.length > 0 && (
                            <p className="text-micro font-semibold text-danger-text leading-snug px-1">
                                {chocanConElDestino.length === 1
                                    ? `${chocanConElDestino[0].descripcion} sale de la misma sala a la que va el envío.`
                                    : `${chocanConElDestino.length} productos salen de la misma sala a la que va el envío.`}
                                {' '}Cámbiales la sala o elige otro destino.
                            </p>
                        )}

                        {excesos.map(x => (
                            <p key={`${x.nombre}|${x.sala}`} className="text-micro font-semibold text-danger-text leading-snug px-1">
                                Entre todos los renglones estás mandando {x.unidades} de {x.nombre} y{' '}
                                {x.sala} tiene {x.existencia}.
                            </p>
                        ))}

                        {/* ── Y al final, a quién y por qué ─────────────────
                            La sala va acá y no arriba porque es lo último que se
                            decide: primero se arma la caja, después se elige a
                            dónde va. Y el motivo es obligatorio — es lo único
                            que le explica al otro lado por qué le llegó algo que
                            no pidió. */}
                        <div className="flex flex-col gap-2.5 pt-1">
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Sala de destino</p>
                            <LiquidSelect
                                value={destino}
                                onChange={v => setDestino(String(v ?? ''))}
                                options={salasDestino}
                                placeholder="¿A qué sala va?"
                                ariaLabel="Sala de destino"
                            />
                            </div>
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Motivo</p>
                            <LiquidSelect
                                value={motivo}
                                onChange={v => setMotivo(String(v ?? ''))}
                                options={motivosPosibles.map(m => ({ value: m, label: m }))}
                                placeholder={!destino ? 'Elige primero la sala'
                                    : sinMotivoPosible ? 'No hay motivo para este envío'
                                    : '¿Por qué se lo mandas?'}
                                ariaLabel="Motivo del envío"
                                disabled={!destino || sinMotivoPosible}
                            />
                            {/* Un desplegable vacío no explica nada, y acá el
                                vacío es la regla y no un defecto: lo que sale
                                de Bodega es reparto y lo que sale de una sala
                                es sobrante, así que no hay un rótulo que sea
                                cierto para los dos. La salida no es aflojar la
                                regla, es armar dos envíos. */}
                            {sinMotivoPosible && (
                                <p className="text-micro text-danger-text font-semibold leading-snug px-1 mt-1">
                                    Este envío saca de Bodega y de una sala a la vez, y hacia{' '}
                                    {NOMBRE_SALA[Number(destino)] ?? 'esa sala'} no hay un motivo que valga
                                    para los dos: lo de Bodega va como reparto y lo de la sala como sobrante.
                                    Manda uno y arma el otro después.
                                </p>
                            )}
                            {/* El porqué, donde alguien lo va a leer. Un
                                desplegable con una sola opción y sin
                                explicación se lee como un defecto en vez de
                                como la regla que es — y esta línea además dice
                                a dónde ir en su lugar. */}
                            {soloSobrante && (
                                <p className="text-micro text-content-3 font-medium leading-snug px-1 mt-1">
                                    Entre salas sólo se manda lo que sobra. Si {NOMBRE_SALA[Number(destino)] ?? 'la otra sala'}{' '}
                                    lo necesita, tiene que pedirlo
                                    {soloHaciaBodega.length > 0 && (
                                        <>; y lo que es {soloHaciaBodega.map(m => `«${m}»`).join(' o ')} va a Bodega</>
                                    )}.
                                </p>
                            )}
                            </div>

                            {/* ── La foto del daño ──────────────────────────
                                Sólo con «Avería»: es el único motivo que no se
                                puede comprobar contra un dato. El vencimiento
                                está en el lote y la rotación en las ventas,
                                pero el daño viaja con la caja y cuando llega ya
                                no se puede volver a mirar — la foto es lo único
                                que le queda a Bodega para decidir si se le
                                reclama al proveedor, se repara o se da de baja.

                                Va acá y no al final porque se toma mientras se
                                tiene el producto en la mano, antes de sentarse a
                                escribir el porqué. */}
                            {pideFoto && (
                                <div>
                                    <div className="flex items-center justify-between mb-1.5 px-1">
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3">
                                            Foto del daño
                                        </p>
                                        <span className="text-micro font-semibold text-content-3">
                                            {fotos.length} de {MAX_FOTOS_ENVIO}
                                        </span>
                                    </div>
                                    <FotosDeEvidencia
                                        fotos={fotos} onCambio={setFotos}
                                        max={MAX_FOTOS_ENVIO} maxMB={10}
                                        resaltar
                                        onError={setError}
                                        alt="Foto del daño" />
                                    {fotos.length === 0 && (
                                        <p className="text-micro text-warning-text font-medium leading-snug px-1 mt-1">
                                            Falta la foto: es lo único que quien recibe puede mirar para
                                            saber cómo salió el producto.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* ── El motivo escrito, SIEMPRE ────────────────
                                Pedido del usuario: era «Detalle (opcional)» y
                                sólo se exigía con «Otro».

                                La categoría de arriba dice el TIPO —sobrestock,
                                próximo a vencer—; esto dice por qué ESTA caja. A
                                la sala de destino le llegó producto que no
                                pidió: sin el texto, lo único que recibe es una
                                palabra y una caja. Lo exige también la base, que
                                además rebota el motivo que se limita a repetir
                                la categoría. */}
                            <PortalTextarea
                                label="Por qué se lo mandas"
                                required
                                rows={2}
                                value={nota}
                                onChange={e => setNota(e.target.value)}
                                placeholder={motivo === 'Próximo a vencer'
                                    ? 'Ej.: vence en octubre y aquí no va a salir, allá se vende'
                                    : motivo === 'Producto nuevo'
                                    ? 'Ej.: llegó el lunes, va uno a cada sala para probarlo'
                                    : motivo === 'Impulso'
                                    ? 'Ej.: en Bodega lleva dos meses parado y allá se vende bien'
                                    : motivo === 'Encargo'
                                    ? 'Ej.: lo encargó una clienta el jueves, ya viene a recogerlo'
                                    : motivo === 'Baja rotación'
                                    ? 'Ej.: no se ha vendido en dos meses y ocupa el estante'
                                    : motivo === 'Retiro del mercado'
                                    ? 'Ej.: lo pidió Bodega, el proveedor retira el lote 4471'
                                    : motivo === 'Avería'
                                    ? 'Ej.: se cayó la caja al bajarla y se quebraron dos frascos'
                                    : 'Explica por qué mandas este producto'}
                            />
                        </div>
                    </div>
                )}

                {error && (
                    <p className="text-label text-danger-text font-semibold leading-snug px-1">{error}</p>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-col gap-2 w-full">
                    {/* Qué va a pasar al apretar, ANTES de apretar: acá no hay
                        nadie que apruebe primero — el producto sale de tu sala en
                        el momento. */}
                    {pestana === 'lista' && faltaParaMandar && renglones.length > 0 && (
                        <p className="text-micro font-semibold text-warning-text leading-snug">
                            {faltaParaMandar}
                        </p>
                    )}
                    {pestana === 'lista' && renglones.length > 0 && (
                        <p className="text-micro text-content-3 font-medium leading-snug">
                            {variosOrigenes
                                ? 'Al transferir sale un envío POR CADA sala de la que sacas producto, '
                                  + 'y todos van a la misma sala de destino. '
                                : 'Al transferir, el producto sale de la sala y le avisamos a la otra. '}
                            Ellos deciden qué se quedan cuando abran la caja.
                        </p>
                    )}
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" onClick={onClose} className="min-h-[var(--tap-min)]">
                            Cancelar
                        </Button>
                        {pestana === 'agregar' ? (
                            <Button variant="secondary" onClick={() => setPestana('lista')}
                                disabled={renglones.length === 0}
                                className="min-h-[var(--tap-min)]">
                                Revisar el envío
                            </Button>
                        ) : (
                            <Button variant="primary" icon={enviando ? Loader2 : Send}
                                onClick={transferir}
                                disabled={!listoParaMandar || enviando}
                                className="min-h-[var(--tap-min)]">
                                {/* La subida de la foto es el tramo largo y va
                                    primero: si el botón dijera «Transfiriendo…»
                                    todo el rato, los segundos de la subida se
                                    leerían como que el producto ya salió. */}
                                {subiendo ? 'Subiendo la foto…' : enviando ? 'Transfiriendo…' : 'Transferir'}
                            </Button>
                        )}
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
