// La propuesta de carga de una factura: el panel que se abre al tocar un
// documento en «Cargar compra». Vive aparte y se carga al abrirlo: era más de
// la mitad de la pantalla (~1,600 líneas) y quien sólo mira las listas no la
// necesitaba (2026-11-06, gate:bundle).

import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { PackagePlus, AlertTriangle, CheckCircle2, BookMarked, Search, HelpCircle, CalendarRange, Truck, Archive } from 'lucide-react';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import Checkbox from '../../components/common/Checkbox';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';
import { factorParaProducto, resolverDocumento, fetchPropuesta, confirmarProducto, simularCarga, simularProductoNuevo, crearProductoNuevo, enviarCarga, fetchPedidosDeVence, pedirVencesASala, cancelarPedidoDeVence, refrescarCatalogo } from '@nucleo/data/cargarCompra';
import { juzgarPresentacion } from '@nucleo/utils/presentacionDeCompra';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { calcMargin, marginLabel } from '@nucleo/utils/preciosDeProducto';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { ORIGEN, OTRA, ESTADO_CARGA, estadoDeCarga, fmtFecha } from './cargarCompraComun';
import { Llegaron, BuscadorProducto } from './CargarCompraPiezas';

// El mismo visor de Facturas de compra (lleva el PDF): sólo se baja al abrir
// la pestaña «Documento».
const VisorDte = lazy(() => import('../../components/forms/FormPurchaseDteViewer'));
const VISTAS = [
    { value: 'carga',     label: 'La carga' },
    { value: 'documento', label: 'El documento' },
];

const USOS = [
    { value: 'venta',   label: 'Para vender' },
    { value: 'consumo', label: 'Para consumo' },
];

// Lo que la persona ajustó en un renglón: unidades por cada una del proveedor,
// lote y vencimiento. Arranca con lo que trae la propuesta.
const ajusteInicial = (r) => ({
    factor: String(r.factor_proveedor ?? 1),
    lote: r.lote ?? '',
    vence: r.vence ? r.vence.slice(0, 7) : '',
    venta: '',   // viñeta nueva leída en la caja; vacío = la que ya tiene Bodega
    llegaron: '', // «Llegaron menos»: vacío = llegó todo
    // Flete / servicio: entra en la misma compra como servicio, sin producto
    // ni inventario. Viene marcado si la descripción lo dice o ya se apartó.
    servicio: r.servicio_sugerido === true,
});

// El borrador vuelve, pero NO le gana a la propuesta en lo que la persona no
// tocó (2026-11-05). BRANDSTAR se abrió cuando el lector todavía no entendía
// «FECHA VENC.» y el precio no corregía la caja: el borrador guardó vence
// vacío y factor 1, y después del arreglo la pantalla los seguía restaurando.
// Vacío en el borrador = no se escribió nada → manda lo leído ahora. El factor
// sólo lo cambia «Cantidad a cargar» (que deja `cargar`): sin `cargar`, nadie
// lo tocó.
const conBorrador = (inicial, guardado) => {
    if (!guardado) return inicial;
    const r = { ...inicial, ...guardado };
    if (!guardado.lote) r.lote = inicial.lote;
    if (!guardado.vence) r.vence = inicial.vence;
    if (guardado.cargar == null) r.factor = inicial.factor;
    if (guardado.servicio == null) r.servicio = inicial.servicio;
    return r;
};

// La viñeta que tiene hoy Bodega para la presentación con que entraría: la de
// la revisión si ya se revisó, si no la de la propuesta (misma regla que el
// servidor: la presentación del tamaño del factor, si no la de 1).
const vinetaActual = (r, aj, sim, lista) => {
    if (sim?.venta_anterior > 0) return Number(sim.venta_anterior);
    const f = Number(aj?.factor) || 1;
    const l = lista ?? r.vinetas ?? [];
    const v = (l.find(x => x.factor === f) ?? l.find(x => x.factor === 1))?.vineta;
    return Number(v) > 0 ? Number(v) : null;
};
// Las presentaciones del catálogo, sin la copia de factor 0, de menor a mayor.
const presDelCatalogo = (lista) => [...new Map((lista ?? []).filter(x => Number(x.factor) > 0).map(x => [Number(x.factor), x])).values()]
    .sort((a, b) => a.factor - b.factor);
const nombrePres = (x) => `${x.nombre ?? (x.factor > 1 ? 'CAJA' : 'UNIDAD')} (${x.factor})`;
// El nombre del producto con el tamaño nuevo, si lo nombra una sola vez
// («RINOKEM PLUS X 100 CAPSULAS» → «… X 120 CAPSULAS»). Una medida no cuenta.
const MEDIDA = String.raw`(?!\s*(?:\.\d|ML|CC|L|LT|LTS|G|GR|GRS|MG|MCG|KG|OZ|%|UI)\b)`;
const nombreConTamano = (nombre, tam) => {
    const re = new RegExp(String.raw`\bX\s*(\d{1,3})\b` + MEDIDA, 'gi');
    const m = [...String(nombre ?? '').matchAll(re)];
    if (m.length !== 1 || Number(m[0][1]) === tam) return null;
    return String(nombre).replace(m[0][0], `X ${tam}`).replace(/\s+/g, ' ').trim();
};
// ¿Este tamaño se puede aprender sin preguntar? Si Bodega vende esa
// presentación, o si es lo que dice la factura. Si no —140 en RINOKEM, 2 en
// MEBEZOL (2026-11-06)—, una confirmación de pasada no lo vuelve regla.
const tamanoAprendible = (factor, lista, r) => {
    const f = Number(factor);
    if (!(f > 1)) return true;
    return presDelCatalogo(lista).some(x => x.factor === f) || f === Number(r?.tamano_factura);
};

// Al múltiplo de 5 centavos de arriba: así se ponen las viñetas.
const subirA5 = (n) => Math.ceil(Math.round(n * 100) / 5) * 5 / 100;

// Las unidades que entran con un factor dado, y la línea de ayuda debajo del
// campo: de dónde salió y cómo se reparte en lo que factura el proveedor.
const cargarDe = (r, factor) => {
    const n = Number(r.cantidad) * Number(factor || 1);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '';
};
const cargarAyuda = (r, aj) => {
    const cant = Number(r.cantidad), f = Number(aj.factor);
    if (!(f > 0)) return 'Escribe cuántas unidades entran en total.';
    if (!Number.isInteger(Math.round(f * 1000) / 1000)) {
        const abajo = Math.floor(f) * cant, arriba = Math.ceil(f) * cant;
        return `${aj.cargar ?? cargarDe(r, f)} no se reparte entre las ${cant} de la factura (saldrían ${Math.round(f * 100) / 100} por cada una). `
            + `Tiene que ser múltiplo de ${cant}: ${abajo > 0 ? `${abajo} o ` : ''}${arriba}.`;
    }
    // Lo normal no se dice: con el rótulo denso la ayuda va al lado del título
    // y se cortaba («60 DE LA I»). Cómo entra lo dice la fila de abajo.
    return null;
};

// ── Producto nuevo desde un renglón (paso 4) ──────────────────────────────
//
// Copia a un producto PARECIDO —categoría, laboratorio, proveedor, si vence,
// si es exento— y sólo pide lo que el modelo no puede saber. Por ahora revisa
// el alta sin crearla: crear de verdad se enciende después de la primera
// carga con Bodega mirando.
const nombreDelRenglon = (t) => String(t ?? '').split('|')[0].replace(/\s+/g, ' ').trim().toUpperCase();
const barrasDelRenglon = (t) => /\b(\d{12,14})\b/.exec(String(t ?? ''))?.[1] ?? '';
const ROTULO_PRECIO = ['Precio 1', 'Precio 2', 'Precio 3', 'Precio 4', 'Precio 5', 'Precio 6', 'Precio 7'];

/* El alta de un producto que la factura trae y Bodega no tiene. Pide lo
 * mismo que el formulario de productos del sistema, pero llega prellenado:
 * proveedor de la factura, y del producto parecido (si lo hay) la categoría,
 * el laboratorio, la marca, las casillas y un precio con su mismo margen.
 * La persona sólo corrige lo que no calce. */
const VACIO = { proveedor: null, categoria: null, laboratorio: null, marca: null, perecedero: null, exento: null, decimal: null };

function NuevoProducto({ renglon, factor, documentId, manualId = null, onCerrar, onCreado, onUsar }) {
    const costo = Number(renglon.costo) / (Number(factor) > 0 ? Number(factor) : 1);
    const clave = `producto-nuevo:${documentId ?? `m${manualId}`}:${renglon.codigo_proveedor ?? renglon.descripcion}`;
    const [f, setF] = useState(() => loadDraft(clave)?.f ?? {
        nombre: nombreDelRenglon(renglon.descripcion), barcode: barrasDelRenglon(renglon.descripcion), precio: '', ...VACIO,
    });
    const [modelo, setModelo]   = useState(() => loadDraft(clave)?.modelo
        ?? (renglon.producto_id ? { id: renglon.producto_id, nombre: renglon.producto } : null));
    const [eligiendo, setElig]  = useState(false);
    const [catalogos, setCat]   = useState(null);
    const [res, setRes]         = useState(null);   // la última revisión; null = cambió algo
    const [revisando, setRev]   = useState(false);
    const [creando, setCreando] = useState(false);
    const [error, setError]     = useState('');

    useEffect(() => { saveDraft(clave, { f, modelo }); }, [clave, f, modelo]);

    const datos = (campos) => ({
        documentId, manualId, modeloId: modelo?.id ?? null, costo: Math.round(costo * 1e4) / 1e4,
        nombre: campos.nombre, barcode: campos.barcode, precio: Number(campos.precio) || null,
        ...Object.fromEntries(Object.keys(VACIO).filter(k => campos[k] != null).map(k => [k, campos[k]])),
    });

    const revisar = useCallback(async (campos, conCatalogos) => {
        setRev(true); setError('');
        const { resultado, error: e } = await simularProductoNuevo({ ...datos(campos), catalogos: conCatalogos });
        setRev(false);
        if (e) { setError(e); return; }
        if (resultado.catalogos) setCat(resultado.catalogos);
        const r = resultado.revision;
        // Lo que la persona no tocó toma lo sugerido.
        setF(x => ({
            ...x,
            ...Object.fromEntries(Object.keys(VACIO).map(k => [k, x[k] ?? r.valores[k]])),
            precio: x.precio !== '' ? x.precio : (r.precio_sugerido != null ? String(r.precio_sugerido) : ''),
        }));
        setRes(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `datos` lee el estado del momento
    }, [modelo?.id, documentId, manualId, costo]);

    // Al abrir y al cambiar el parecido: pedir sugerencias de nuevo, soltando
    // lo que venía del parecido anterior.
    useEffect(() => {
        revisar(f, !catalogos);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir y al cambiar el parecido
    }, [modelo?.id]);

    const poner = (k, v) => { setF(x => ({ ...x, [k]: v })); setRes(null); };
    const elegirModelo = (prod) => {
        setElig(false);
        setF(x => ({ ...x, categoria: null, laboratorio: null, marca: null, perecedero: null, exento: null, decimal: null, precio: '' }));
        setModelo(prod);
    };
    // Lo que la base dice que YA es este producto, o se le parece: elegirlo
    // en vez de crear un duplicado.
    const usarExistente = (x) => { clearDraft(clave); onUsar({ id: x.id, nombre: x.nombre }); };
    const crear = async () => {
        setCreando(true); setError('');
        const { resultado, error: e } = await crearProductoNuevo(datos(f));
        setCreando(false);
        if (e) { setError(e); return; }
        clearDraft(clave);
        onCreado(resultado.producto, resultado.notas ?? []);
    };

    const margen = Number(f.precio) > 0 ? Math.round((1 - costo / Number(f.precio)) * 100) : null;
    const opciones = (k) => catalogos?.[k] ?? [];

    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-2xl" ariaLabel="Producto nuevo">
            <LiquidModal.Header titulo="Producto nuevo" subtitulo={renglon.descripcion} icono={PackagePlus} onClose={onCerrar} />
            <LiquidModal.Body>
                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
                <div className="mb-3">
                    <p className="text-micro text-content-3 mb-1">
                        Parecido a… <span className="text-content-3">(de él se copian categoría, laboratorio, marca y el margen)</span>
                    </p>
                    {modelo && !eligiendo ? (
                        <div className="flex items-center gap-2">
                            <Badge variant="info" size="sm">{modelo.nombre}</Badge>
                            <Button size="xs" variant="ghost" onClick={() => setElig(true)}>Cambiar</Button>
                        </div>
                    ) : eligiendo || !modelo ? (
                        <BuscadorProducto onElegir={elegirModelo} onCancelar={() => setElig(false)} />
                    ) : null}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                        <PortalInput label="Nombre" value={f.nombre} onChange={e => poner('nombre', e.target.value)} />
                    </div>
                    <PortalInput label="Código de barras" value={f.barcode} inputMode="numeric"
                        onChange={e => poner('barcode', e.target.value)} />
                    <PortalInput label="Precio de venta por unidad" inputMode="decimal" maskType="DECIMAL" prefix="$"
                        value={f.precio} onChange={e => poner('precio', e.target.value)}
                        helperText={`costo ${formatMoney(costo)}${margen != null ? ` · margen ${margen} %` : ''}${res?.precio_sugerido ? ` · sugerido ${formatMoney(res.precio_sugerido)}` : ''}`} />
                    <LiquidSelect value={f.proveedor ?? ''} onChange={v => poner('proveedor', v || '')} options={opciones('proveedores')}
                        placeholder="Proveedor" ariaLabel="Proveedor" clearable={false} isLoading={!catalogos} />
                    <LiquidSelect value={f.laboratorio ?? ''} onChange={v => poner('laboratorio', v || '')} options={opciones('laboratorios')}
                        placeholder="Laboratorio" ariaLabel="Laboratorio" clearable={false} isLoading={!catalogos} />
                    <LiquidSelect value={f.categoria ?? ''} onChange={v => poner('categoria', v || '')} options={opciones('categorias')}
                        placeholder="Categoría" ariaLabel="Categoría" clearable={false} isLoading={!catalogos} />
                    <PortalInput label="Marca" value={f.marca ?? ''} onChange={e => poner('marca', e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-4 mt-3">
                    <Checkbox size="sm" label="Vence" checked={!!f.perecedero} onChange={() => poner('perecedero', !f.perecedero)} />
                    <Checkbox size="sm" label="Exento de IVA" checked={!!f.exento} onChange={() => poner('exento', !f.exento)} />
                    <Checkbox size="sm" label="Se vende por fracción" checked={!!f.decimal} onChange={() => poner('decimal', !f.decimal)} />
                </div>

                {res && !res.listo && (
                    <div className="mt-4">
                        <Notice variant="warning" icon={AlertTriangle}>
                            <ul className="list-disc pl-5">{res.problemas.map((x, k) => <li key={k}>{x}</li>)}</ul>
                        </Notice>
                    </div>
                )}
                {[...(res?.existentes ?? []), ...(res?.parecidos ?? [])].some(x => x.activo) && (
                    <div className="mt-3 flex flex-col gap-1.5">
                        <p className="text-micro text-content-3">
                            {res.existentes?.length ? '¿Es éste?' : 'Se parece a productos que ya existen. Si es uno de ellos, úsalo:'}
                        </p>
                        {[...(res.existentes ?? []), ...(res.parecidos ?? [])].filter(x => x.activo).map(x => (
                            <div key={x.id} className="flex items-center gap-2">
                                <span className="text-label text-content flex-1 min-w-0 truncate">{x.nombre}</span>
                                <Button size="xs" variant="secondary" onClick={() => usarExistente(x)}>Usar este</Button>
                            </div>
                        ))}
                    </div>
                )}
                {res?.listo && (
                    <div className="mt-4">
                        <Notice variant="success" icon={CheckCircle2}>
                            Listo para crear <b>{res.nombre}</b>, presentación de 1 unidad a {formatMoney(res.precio)}.
                        </Notice>
                        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mt-2">
                            {res.precios.map((p, k) => <Dato key={k} titulo={ROTULO_PRECIO[k]} valor={formatMoney(p)} />)}
                        </div>
                    </div>
                )}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center gap-2 w-full flex-wrap">
                    <p className="text-micro text-content-3 flex-1 min-w-[12rem]">
                        {res?.listo ? 'Se crea en el sistema y queda elegido en este renglón.' : 'Revisa los datos antes de crearlo.'}
                    </p>
                    <Button size="sm" variant="ghost" onClick={onCerrar}>Cerrar</Button>
                    {res?.listo ? (
                        <Button size="sm" disabled={creando} onClick={crear} icon={creando ? undefined : PackagePlus}>
                            {creando ? 'Creando…' : 'Crear producto'}
                        </Button>
                    ) : (
                        <Button size="sm" disabled={revisando || !f.nombre.trim()} onClick={() => revisar(f, !catalogos)}>
                            {revisando ? 'Revisando…' : 'Revisar'}
                        </Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

/** Qué renglones trae el documento, para no aplicar un borrador a otros. */
const huellaDe = (renglones) => (renglones ?? []).map(r => [r.codigo_proveedor, r.descripcion, r.cantidad].join('|')).join('\n');

/** La llave de un renglón: la del diccionario (código del proveedor, o `#`+nombre
 *  si no trae), o su posición si ni eso hay. */
const claveDe = (r, i) => r.llave || r.codigo_proveedor || `@${i}`;

export default function Propuesta({ doc, puedeEditar, estadoCarga, pista, onCerrar, onCorregirPapel = null, onSacada = null }) {
    const [p, setP]           = useState(null);
    const [error, setError]   = useState('');
    // Lo que la persona corrigió acá: {codigo_proveedor: {product_id, nombre}}
    const [elegidos, setEleg] = useState({});
    const [buscando, setBusc] = useState(null);
    const [guardando, setG]   = useState(null);
    // El renglón cuyo «Siempre así» pide la segunda confirmación.
    const [duda, setDuda]     = useState(null);
    // ── Para armar la carga ──
    const [uso, setUso]         = useState('venta');
    const [ajustes, setAjustes] = useState({});   // {índice: ajusteInicial}
    const [dias, setDias]       = useState('');
    const [revisando, setRev]   = useState(false);
    const [resultado, setRes]   = useState(null);
    // La última revisión que llegó, aunque después se haya tocado algo: sus
    // costos siguen valiendo para los renglones que NO cambiaron. Sin esto,
    // confirmar un producto borraba el costo de todos los demás.
    const [ultimaRev, setUltimaRev] = useState(null);
    const [creando, setCreando] = useState(null);   // índice del renglón
    const [confirmando, setConf] = useState(false);
    const [enviando, setEnv]     = useState(false);
    const [envio, setEnvio]      = useState(null);   // respuesta del envío
    const [vista, setVista]      = useState('carga');
    // Sacar el documento de la cola sin cargarlo: ya estaba cargado a mano, o
    // no es mercadería. `saliendo` = qué se está por decidir en el pie.
    const [saliendo, setSaliendo] = useState(false);
    const [resolviendo, setResolv] = useState(false);
    const [confProv, setConfProv] = useState(false);
    const sacarDeLaLista = async (motivo, receiptId = null) => {
        setResolv(true);
        const { error: e } = await resolverDocumento(doc.document_id, motivo, receiptId);
        setResolv(false);
        if (e) { setError(e === 'FORBIDDEN' ? 'No tienes permiso para sacarla de la lista.' : e); return; }
        useStaff.getState().appendAuditLog('COMPRA_SACADA_DE_LA_COLA', String(doc.document_id), {
            motivo, compra: receiptId, proveedor: doc.emisor_nombre, total: doc.monto_total,
        });
        onSacada?.(doc, motivo);
        onCerrar();
    };

    // Una factura en papel (`doc.manual_id`) va por el mismo camino que un DTE.
    const papel = !!doc.manual_id;
    const claveBorrador = `cargar-compra:${papel ? `m${doc.manual_id}` : doc.document_id}`;
    const cargar = useCallback(async () => {
        setP(null); setError(''); setRes(null);
        // Los productos se actualizan EN PARALELO, no antes (2026-11-05):
        // esperarlos sumaba ~4 s a cada apertura. La propuesta se muestra ya, y
        // si la actualización trajo cambios se vuelve a pedir y se reemplaza
        // conservando lo que la persona haya tocado.
        const refresco = refrescarCatalogo();
        const { propuesta, error: e } = await fetchPropuesta(doc.document_id, doc.manual_id ?? null);
        if (e) { setError(e); return; }
        setP(propuesta);
        refresco.then(async (rf) => {
            if (!rf.refrescado || !(rf.cambios > 0)) return;
            const { propuesta: nueva, error: e2 } = await fetchPropuesta(doc.document_id, doc.manual_id ?? null);
            if (e2 || huellaDe(nueva.renglones) !== huellaDe(propuesta.renglones)) return;
            setP(nueva);
            setAjustes(a => Object.fromEntries(nueva.renglones.map((r, i) => [i, conBorrador(ajusteInicial(r), a[i])])));
        });
        // Lo que la persona ya había ajustado sobre ESTE documento vuelve: la
        // sesión se cierra sola a los pocos minutos y una factura de 30
        // renglones no se vuelve a teclear.
        // Sólo si los renglones son LOS MISMOS: el borrador va por posición, y
        // una factura en papel corregida puede haber cambiado el orden.
        const guardado = loadDraft(claveBorrador);
        const b = guardado?.huella === huellaDe(propuesta.renglones) ? guardado : null;
        setAjustes(Object.fromEntries(propuesta.renglones.map((r, i) => [i, conBorrador(ajusteInicial(r), b?.ajustes?.[i])])));
        setUso(b?.uso ?? 'venta');
        setDias(b?.dias ?? (propuesta.encabezado.dias_credito != null ? String(propuesta.encabezado.dias_credito) : ''));
    }, [doc.document_id, doc.manual_id, claveBorrador]);

    useEffect(() => {
        if (p) saveDraft(claveBorrador, { ajustes, uso, dias, huella: huellaDe(p.renglones) });
    }, [p, ajustes, uso, dias, claveBorrador]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    // Las salas a las que se puede enviar al cargar: las seis farmacias.
    const branches = useStaff(st => st.branches);
    const salasReparto = useMemo(() => (branches ?? []).filter(b => b.type === 'FARMACIA')
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })), [branches]);

    const ajustar = (i, campo, valor) => {
        setAjustes(a => ({ ...a, [i]: { ...a[i], [campo]: valor } }));
        setRes(null);   // lo revisado ya no es lo que se ve
    };
    // Las fechas que contestó la sala: sólo llenan los renglones VACÍOS — lo
    // que Bodega ya escribió a mano no se pisa.
    const usarFechas = useCallback((respuestas) => {
        let cambio = false;
        setAjustes(a => {
            const n = { ...a };
            for (const [i, v] of Object.entries(respuestas ?? {})) {
                if (v && !n[i]?.vence) { n[i] = { ...n[i], vence: v }; cambio = true; }
            }
            return cambio ? n : a;
        });
        if (cambio) setRes(null);
    }, []);

    // La persona escribe las UNIDADES que entran (usuario, 2026-10-29: «pon la
    // cantidad a cargar»); lo que viaja sigue siendo el factor —unidades por
    // cada una que factura el proveedor—, que es lo que elige la presentación
    // de Bodega. Se guarda lo tecleado tal cual para no pelearle a medio número.
    const ajustarCarga = (i, r, valor) => {
        const limpio = String(valor).replace(/[^\d]/g, '');
        const n = Number(limpio), cant = Number(r.cantidad);
        setAjustes(a => ({
            ...a,
            [i]: { ...a[i], cargar: limpio, ...(n > 0 && cant > 0 ? { factor: String(n / cant) } : {}) },
        }));
        setRes(null);
    };

    // Se aprende por la llave del diccionario: el código del proveedor, o si
    // no trae (papel, algunos DTE), su nombre. La próxima factura de ese
    // proveedor con ese renglón sale ya confirmada.
    const confirmar = async (renglon, i, producto, { explicito = false } = {}) => {
        const k = claveDe(renglon, i);
        const llave = renglon.llave || renglon.codigo_proveedor;
        // El tamaño «por costo» se calculó contra el producto PROPUESTO. Si se
        // elige otro y nadie tocó la cantidad, ese número no le corresponde:
        // GARRAFÓN DE AGUA emparejado con «AGUA CRISTAL 355 ML» salía ×12 y,
        // al elegir el garrafón, se cargaba ×12 y se aprendía (2026-11-05).
        // Y si la propuesta no traía producto (GRIPE-MED de MONTREAL: «1 SOBRE
        // X 2» por una caja de 50), el tamaño nunca se había calculado: se
        // calcula ahora contra el elegido, con la misma regla del servidor.
        const intacto = ajustes[i]?.cargar == null && String(ajustes[i]?.factor) === String(renglon.factor_proveedor ?? 1);
        // Con otro producto también se traen SUS presentaciones (nombre y
        // viñeta): sin ellas «Se carga como» no aparecía y «Regular» quedaba
        // vacío (Bodega, AMLO-DENK, 2026-11-05).
        let factor = ajustes[i]?.factor;
        let vinetas = null;
        let saldo;
        let numeros;
        let costoUnidadAntes;
        if (producto.id !== renglon.producto_id) {
            setG(k);
            const r = await factorParaProducto({
                productId: producto.id, costoNeto: renglon.costo_neto, descripcion: renglon.descripcion,
                cantidad: renglon.cantidad, emisor: p.documento.emisor,
            });
            setG(null);
            vinetas = r.presentaciones;
            saldo = r.saldo;
            numeros = r.numeros;
            costoUnidadAntes = r.costoUnidadAntes;
            if (intacto && !['documento', 'aprendido'].includes(renglon.factor_origen)) factor = r.factor ? String(r.factor) : '1';
        }
        if (factor !== ajustes[i]?.factor) setAjustes(a => ({ ...a, [i]: { ...a[i], factor } }));
        if (llave && p.documento.emisor_nit) {
            // Confirmar el PRODUCTO no confirma un tamaño raro: se aprende el
            // producto y el tamaño queda en 1, para que la próxima factura lo
            // vuelva a calcular. Sólo «Siempre así» —con su segunda pregunta—
            // guarda un tamaño que Bodega no vende.
            const lista = vinetas ?? (producto.id === renglon.producto_id ? (renglon.vinetas ?? []) : []);
            const aprender = explicito || tamanoAprendible(factor, lista, renglon) ? factor : '1';
            setG(k);
            const { error: e } = await confirmarProducto(
                p.documento.emisor_nit, llave, producto.id,
                { proveedor: p.documento.emisor, producto: producto.nombre },
                aprender);
            setG(null);
            if (e) { setError(e); return; }
        }
        setEleg(x => ({ ...x, [k]: { product_id: producto.id, nombre: producto.nombre, factor, ...(vinetas ? { vinetas } : {}), ...(saldo !== undefined ? { saldo } : {}), ...(numeros?.length ? { numeros } : {}), ...(costoUnidadAntes !== undefined ? { costoUnidadAntes } : {}) } }));
        setBusc(null);
        setRes(null);
    };

    // El producto que se mandaría: lo elegido acá, o lo que llegó por código
    // de barras o por el diccionario. Un parecido NUNCA viaja sin confirmar,
    // por alto que sea: acierta 91.5 % y un inventario mal cargado no avisa.
    // La revisión lo devuelve como «sin producto elegido», que es lo que es.
    // Las presentaciones del producto que se va a cargar: las del ELEGIDO si
    // se eligió otro, si no las del propuesto.
    const vinetasDe = (r, i) => {
        const e = elegidos[claveDe(r, i)];
        if (e?.vinetas) return e.vinetas;
        return !e || e.product_id === r.producto_id ? (r.vinetas ?? []) : [];
    };
    // Un aprendido cuya concentración o tamaño no coincide con la factura
    // (`numeros_distintos`) tampoco viaja solo: hay que confirmarlo.
    const productoDe = (r, i) => elegidos[claveDe(r, i)]?.product_id
        ?? (['codigo_barras', 'aprendido'].includes(r.match_origen) && !r.numeros_distintos?.length ? r.producto_id : null);

    const decisiones = () => Object.fromEntries(p.renglones.map((r, i) => [i, {
        product_id: ajustes[i]?.servicio ? null : productoDe(r, i),
        servicio: ajustes[i]?.servicio === true,
        factor: Number(ajustes[i]?.factor) || 1,
        lote: ajustes[i]?.lote || null,
        // El campo de mes emite el texto mientras no está completo: eso no viaja.
        vence: /^\d{4}-\d{2}$/.test(ajustes[i]?.vence ?? '') ? ajustes[i].vence : null,
        venta: Number(ajustes[i]?.venta) > 0 ? Number(ajustes[i].venta) : null,
        llegaron: ajustes[i]?.llegaron !== '' && ajustes[i]?.llegaron != null ? Number(ajustes[i].llegaron) : null,
        erroneo: ajustes[i]?.erroneo === true,
        vencidos: ajustes[i]?.vencidos ? {
            unidades: ajustes[i].vencidos.modo === 'algunas' ? (Number(ajustes[i].vencidos.unidades) || 0) : null,
            motivo: ajustes[i].vencidos.motivo || null,
            detalle: ajustes[i].vencidos.motivo === 'otro' ? (ajustes[i].vencidos.detalle || '').trim() : null,
        } : null,
        reparto: aRepartir(ajustes[i]?.reparto),
    }]));

    // Lo que se revisa y lo que se manda es esta MISMA firma.
    const firmaActual = () => JSON.stringify({ uso, renglones: decisiones(), diasCredito: dias === '' ? null : Number(dias) });

    // Manda EXACTAMENTE lo revisado: la función lo vuelve a armar y se niega si
    // algo cambió, así que acá se le pasan las mismas decisiones.
    const enviar = async () => {
        setEnv(true); setError('');
        const rev = JSON.parse(resultado.firma);
        const { resultado: r, error: e } = await enviarCarga({
            documentId: doc.document_id ?? null, manualId: doc.manual_id ?? null, cargaId: resultado.carga_id, ...rev,
        });
        setEnv(false); setConf(false);
        if (r?.enviada) {
            for (const [i, x] of Object.entries(rev.renglones ?? {})) {
                if (!(x.venta > 0)) continue;
                const x0 = (resultado?.revision?.renglones ?? []).find(y => y.renglon === Number(i));
                const ant = x0?.venta_anterior ?? null;
                if (ant != null && Math.abs(ant - x.venta) < 0.005) continue;
                useStaff.getState().appendAuditLog('COMPRA_VINETA_CAMBIADA', String(x.product_id), {
                    documento: doc.document_id ?? null, papel: doc.manual_id ?? null, proveedor: doc.emisor_nombre,
                    producto: x0?.descripcion ?? null, antes: ant, ahora: x.venta,
                });
            }
        }
        // Entró: se cierra y lo dice un aviso (Bodega, 2026-11-05: quedarse en
        // el mismo documento después de cargarlo se leía como «volvió a
        // abrirse»). Si no se pudo confirmar o falló, el modal sigue abierto
        // con el detalle, que es donde hay que actuar.
        if (r?.enviada === true && !e) {
            clearDraft(claveBorrador);
            useToastStore.getState().showToast('Compra cargada',
                `${doc.emisor_nombre} · ${formatMoney(doc.monto_total)} ${r.verificada ? 'entró a Bodega.' : 'se mandó a Bodega; se confirma en unos minutos.'}`,
                'success');
            onCerrar();
            return;
        }
        setEnvio({ ...(r ?? {}), error: e });
        setRes(null);
    };

    const revisar = async () => {
        setRev(true); setError(''); setRes(null); setEnvio(null);
        const firma = firmaActual();
        const { resultado: res, error: e } = await simularCarga({
            documentId: doc.document_id ?? null, manualId: doc.manual_id ?? null, ...JSON.parse(firma),
        });
        setRev(false);
        if (e) { setError(e); return; }
        // La firma viaja con el resultado: si mientras se revisaba la persona
        // cambió algo, la revisión que llega ya no es la de la pantalla.
        setRes({ ...res, firma });
        setUltimaRev({ ...res, firma });
    };

    // El aviso se cuenta ACÁ, con lo que la persona ya resolvió en pantalla
    // (lo confirmado y el lote/vencimiento tecleados). El `resumen` del
    // servidor es la foto de cuando se abrió: con él, dos renglones recién
    // confirmados seguían saliendo «por confirmar» junto a su sello verde.
    const estado = (p?.renglones ?? []).map((r, i) => {
        const confirmado = !!elegidos[claveDe(r, i)];
        if (ajustes[i]?.servicio) return { sin_producto: false, a_confirmar: false, sin_lote: false, sin_vencimiento: false };
        return {
            sin_producto: !r.producto_id && !confirmado,
            a_confirmar: !!r.producto_id && !r.seguro && !confirmado,
            sin_lote: !ajustes[i]?.lote,
            sin_vencimiento: !/^\d{4}-\d{2}$/.test(ajustes[i]?.vence ?? ''),
        };
    });
    const contar = (k) => estado.filter(e => e[k]).length;
    const resumen = p && {
        renglones: p.renglones.length,
        sin_producto: contar('sin_producto'), a_confirmar: contar('a_confirmar'),
        sin_lote: contar('sin_lote'), sin_vencimiento: contar('sin_vencimiento'),
    };
    const faltan = estado.filter(e => e.sin_producto || e.a_confirmar || e.sin_lote || e.sin_vencimiento).length;
    const revision = resultado?.revision;
    const revisionVigente = !!(p && resultado?.firma && resultado.firma === firmaActual());
    // Ya se mandó (o no se sabe): no se revisa ni se manda de nuevo desde acá.
    const yaMandada = envio?.enviada === true || envio?.enviada === null
        || ['enviando', 'sin_verificar', 'verificada'].includes(estadoCarga?.estado);
    const pendientesDeVence = (revision?.renglones ?? []).filter(x => x.vence_pendiente).length;
    // «Lista»: si al abrir no falta nada (todo emparejado con seguridad, lote y
    // vencimiento), se revisa sola — revisar sólo lee — y queda a un clic de
    // «Cargar en Bodega». Una vez por apertura: si la persona cambia algo,
    // vuelve a revisar ella.
    const autoRevisada = useRef(false);
    useEffect(() => {
        if (autoRevisada.current || !p || !puedeEditar || yaMandada || resultado || revisando) return;
        // Se revisa al abrir AUNQUE falten renglones por resolver (Bodega,
        // 2026-11-05): los que ya están confirmados muestran su costo y su
        // margen sin esperar a que se resuelva el resto.
        if (Object.keys(ajustes).length !== p.renglones.length) return;
        autoRevisada.current = true;
        revisar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara una vez, cuando la propuesta está completa
    }, [p, faltan, ajustes, puedeEditar, yaMandada]);
    const lista = !!(p && faltan === 0);
    // Lo que se muestra por renglón: la revisión vigente, o la última que llegó
    // para los renglones cuya decisión es la MISMA que se revisó.
    const decisionesAhora = p ? JSON.stringify({ uso, r: decisiones() }) : '';
    const entraComo = useMemo(() => {
        if (revision) return new Map((revision.renglones ?? []).map(x => [x.renglon, x]));
        if (!ultimaRev?.revision || !decisionesAhora) return new Map();
        const antes = JSON.parse(ultimaRev.firma), ahora = JSON.parse(decisionesAhora);
        if (antes.uso !== ahora.uso) return new Map();
        return new Map((ultimaRev.revision.renglones ?? [])
            .filter(x => JSON.stringify(antes.renglones?.[x.renglon]) === JSON.stringify(ahora.r?.[x.renglon]))
            .map(x => [x.renglon, x]));
    }, [revision, ultimaRev, decisionesAhora]);
    // El costo que trae ESTA factura contra el que tiene Bodega, y el margen
    // con el precio de venta actual (la misma regla del catálogo). Sale de la
    // revisión: `linea.compra` ya lleva el descuento y el reparto de regalos.
    const costos = useMemo(() => {
        const m = new Map();
        for (const x of entraComo.values()) {
            if (!x.linea || x.linea.bandera !== 'PRODUCTO') continue;
            const nuevo = Number(x.linea.compra), antes = x.costo_anterior, venta = Number(x.linea.venta);
            const cambio = antes ? (nuevo - antes) / antes * 100 : null;
            const margen = calcMargin(venta, nuevo);
            const ventaAntes = x.venta_anterior ?? null;
            // Si el costo sube y la viñeta no se movió: la que mantendría el
            // margen que tenía antes, para preguntar si la caja trae precio nuevo.
            const mAntes = ventaAntes > 0 && antes > 0 ? (ventaAntes - antes) / ventaAntes : null;
            const sugerida = cambio != null && cambio >= 0.5 && mAntes > 0 && mAntes < 0.9
                && Math.abs(venta - ventaAntes) < 0.005 ? subirA5(nuevo / (1 - mAntes)) : null;
            m.set(x.renglon, {
                nuevo, antes, venta, cambio, margen, alerta: marginLabel(margen), ventaAntes,
                margenAntes: mAntes != null ? mAntes * 100 : null,
                sugerida: sugerida > ventaAntes ? sugerida : null,
            });
        }
        return m;
    }, [entraComo]);
    const subenDeCosto = [...costos.values()].filter(c => c.cambio != null && c.cambio >= 0.5).length;
    const bajanDeCosto = [...costos.values()].filter(c => c.cambio != null && c.cambio <= -0.5).length;
    const conMargenMalo = [...costos.values()].filter(c => c.alerta).length;

    return (
        <LiquidModal open onClose={() => !enviando && onCerrar()} maxWidth="max-w-6xl"
            ariaLabel={`Compra propuesta de ${doc.emisor_nombre}`}>
            <LiquidModal.Header icono={PackagePlus} tono="brand" titulo={doc.emisor_nombre} onClose={() => !enviando && onCerrar()}
                subtitulo={<>
                    {fmtFecha(doc.fecha_emision)} · {formatMoney(doc.monto_total)}
                    {resumen && ` · ${resumen.renglones} renglones`}
                    {(() => {
                        // Lo que acaba de pasar en este modal manda sobre lo que trajo la lista.
                        const e = envio?.enviada === true ? (envio.verificada ? ESTADO_CARGA.verificada : ESTADO_CARGA.sin_verificar)
                            : envio?.enviada === null ? ESTADO_CARGA.sin_verificar
                            : estadoDeCarga(estadoCarga);
                        return <Badge variant={e.variant} size="sm" className="ml-2 align-middle">{e.label}</Badge>;
                    })()}
                </>} />

            <LiquidModal.Body>
                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
                {pista?.compra && !envio?.enviada && !estadoCarga && (
                    <Notice variant="warning" icon={HelpCircle}>
                        <div className="flex items-center gap-3 flex-wrap">
                            <span className="flex-1 min-w-[16rem]">
                                <b>Parece que ya se cargó a mano</b> en {pista.compra.sucursal ?? 'otra sucursal'}:
                                compra del {fmtFecha(pista.compra.fecha)} por {formatMoney(pista.compra.total)},
                                número <span className="font-mono">{pista.compra.numero}</span>. Mismo proveedor y
                                mismo total, otro número. Si es la misma, no la cargues de nuevo.
                            </span>
                            {puedeEditar && (
                                <Button size="sm" loading={resolviendo}
                                    onClick={() => sacarDeLaLista('cargada_a_mano', pista.compra.id)}>
                                    Sí, es esa
                                </Button>
                            )}
                        </div>
                    </Notice>
                )}
                {pista?.nota_credito && !envio?.enviada && !estadoCarga && (
                    <Notice variant="warning" icon={HelpCircle}>
                        {Math.abs(Number(pista.nota_credito.total) - Number(doc.monto_total)) <= 0.02 ? (
                        <div className="flex items-center gap-3 flex-wrap">
                            <span className="flex-1 min-w-[16rem]">
                                <b>Parece anulada</b>: el proveedor emitió una nota de crédito del{' '}
                                {fmtFecha(pista.nota_credito.fecha)} por el mismo total ({formatMoney(pista.nota_credito.total)}).
                                Si la anuló, no se carga.
                            </span>
                            {puedeEditar && (
                                <Button size="sm" loading={resolviendo}
                                    onClick={() => sacarDeLaLista('anulada_nc')}>
                                    Sí, está anulada
                                </Button>
                            )}
                        </div>
                        ) : (
                            <>Esta factura tiene una <b>nota de crédito</b> del {fmtFecha(pista.nota_credito.fecha)} por{' '}
                            {formatMoney(pista.nota_credito.total)}: el proveedor devolvió o descontó una parte.</>
                        )}
                    </Notice>
                )}
                {!pista?.compra && pista?.gasto && !envio?.enviada && !estadoCarga && (
                    <Notice variant="info" icon={HelpCircle}>
                        El proveedor está clasificado como <b>{pista.gasto}</b>: parece un gasto y no
                        mercadería. Si no es para el inventario, quítala con «No es mercadería».
                    </Notice>
                )}
                {!p && !error && <p className="text-label text-content-3">Leyendo el documento y su archivo…</p>}

                {p && (<>
                    {/* El encabezado: lo que iría en la parte de arriba del
                        formulario del otro sistema. */}
                    <div data-surface="card" className="p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Dato titulo="Proveedor"        valor={p.encabezado.proveedor} />
                        <Dato titulo="Número"           valor={p.documento.codigo_generacion} mono />
                        <Dato titulo="Fecha de la factura" valor={fmtFecha(p.documento.fecha)} nota="con ésta entra a Bodega" />
                        <Dato titulo="Sello de Hacienda" valor={p.documento.sello ? 'Sí' : 'No lo trae'} />
                    </div>

                    {/* Una sola barra: qué se mira a la izquierda; cómo se carga a
                        la derecha (sólo tiene sentido mirando la carga). */}
                    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                        {papel ? <span /> : <SegmentedControl size="sm" label="Ver" value={vista} onChange={setVista} options={VISTAS} />}
                        {vista === 'carga' && (
                            <div className="flex flex-wrap items-end gap-3">
                                <SegmentedControl size="sm" label="La compra es" value={uso}
                                    onChange={(v) => { setUso(v); setRes(null); }} options={USOS} />
                                <div className="w-28">
                                    <PortalInput compact label="Días de crédito" type="number" min="0" value={dias}
                                        placeholder={p.encabezado.dias_credito != null ? String(p.encabezado.dias_credito) : '—'}
                                        onChange={e => { setDias(e.target.value); setRes(null); }} />
                                </div>
                            </div>
                        )}
                    </div>

                    {vista === 'documento' && !papel ? (
                        <div data-surface="card" className="h-[70vh] flex flex-col overflow-hidden">
                            <Suspense fallback={<p className="p-4 text-label text-content-3">Abriendo el documento…</p>}>
                                <VisorDte formData={{ document: {
                                    id: p.documento.id, json_path: p.documento.json_path, pdf_path: p.documento.pdf_path,
                                    fecha_emision: p.documento.fecha, codigo_generacion: p.documento.codigo_generacion,
                                    emisor_nombre: p.documento.emisor, tipo_dte: p.documento.tipo_dte,
                                } }} />
                            </Suspense>
                        </div>
                    ) : (<>
                    {/* Para qué es la compra. Consumo se registra igual en el
                        libro, pero como gasto y sin sumar existencias. */}
                    {uso === 'consumo' && (
                        <Notice variant="info" icon={HelpCircle}>
                            Se registra en el libro de compras como <b>gasto</b>: no suma existencias y cada renglón
                            entra con su descripción. Lo de consumo no se reparte a las salas.
                        </Notice>
                    )}

                    {envio && (envio.enviada === true ? (
                        <Notice variant={envio.verificada ? 'success' : 'warning'} icon={envio.verificada ? CheckCircle2 : AlertTriangle}>
                            <b>Cargada en Bodega{envio.erp_compra_id ? ` (compra ${envio.erp_compra_id})` : ''}.</b>{' '}
                            {envio.verificada
                                ? 'Se leyó de vuelta y cuadra renglón por renglón.'
                                : <>Entró, pero al leerla de vuelta algo no cuadró: {(envio.notas ?? []).join(' ')}</>}
                            {envio.reparto && (envio.reparto.enviando
                                ? <> Se está enviando a {envio.reparto.salas === 1 ? '1 sala' : `${envio.reparto.salas} salas`}: lo reciben en Traslados → En camino.</>
                                : <> <b>No se envió a las salas</b> porque la carga no se pudo comprobar: hay que enviarlo a mano.</>)}
                            {envio.vencidos && (envio.vencidos.en_curso
                                ? <> Lo marcado como error se está pasando a Bodega de vencidos: se ve en la pestaña «Por error».</>
                                : <> <b>Lo marcado como error NO se pasó a vencidos</b> porque la carga no se pudo comprobar: hay que pasarlo a mano.</>)}
                        </Notice>
                    ) : envio.enviada === false ? (
                        <Notice variant="danger" icon={AlertTriangle}>
                            <b>No entró.</b> {envio.error}
                        </Notice>
                    ) : (
                        <Notice variant="danger" icon={AlertTriangle}>
                            <b>No se sabe si entró.</b> {envio.error} No la mandes de nuevo: avisa a Bodega para que la busque.
                        </Notice>
                    ))}

                    {revision && (revision.listo ? (
                        <Notice variant="success" icon={CheckCircle2}>
                            <b>Lista para cargar.</b> {revision.renglones.length} renglones · total{' '}
                            {formatMoney(revision.total_armado)}, igual al del documento.
                            {pendientesDeVence > 0 && (
                                <span className="block mt-1">
                                    {pendientesDeVence === 1 ? 'Un renglón va' : `${pendientesDeVence} renglones van`} sin
                                    vencimiento: la sala que lo reciba la va a tener que poner.
                                </span>
                            )}
                            {(subenDeCosto > 0 || bajanDeCosto > 0 || conMargenMalo > 0) && (
                                <span className="block mt-1">
                                    {[
                                        subenDeCosto > 0 && `${subenDeCosto} ${subenDeCosto === 1 ? 'sube' : 'suben'} de costo`,
                                        bajanDeCosto > 0 && `${bajanDeCosto} ${bajanDeCosto === 1 ? 'baja' : 'bajan'} de costo`,
                                        conMargenMalo > 0 && `${conMargenMalo} con margen bajo o en pérdida: revisa el precio de venta`,
                                    ].filter(Boolean).join(' · ')}.
                                </span>
                            )}
                            {revision.regalos > 0 && (
                                <span className="block mt-1">
                                    Trae {revision.regalos === 1 ? 'un producto' : `${revision.regalos} productos`} de
                                    regalo: su costo se reparte entre todas las unidades, como lo carga Bodega.
                                </span>
                            )}
                            <span className="block text-micro mt-1">Todavía no se manda: esto fue una revisión.</span>
                        </Notice>
                    ) : (
                        <Notice variant="warning" icon={AlertTriangle}>
                            <b>Antes de cargarla hay que resolver {revision.problemas.length === 1 ? 'esto' : `${revision.problemas.length} cosas`}:</b>
                            <ul className="list-disc pl-5 mt-1">
                                {revision.problemas.map((x, k) => (
                                    <li key={k}>
                                        {x.renglon != null ? `Renglón ${x.renglon + 1}: ` : ''}{x.texto}
                                        {x.pistas?.length > 0 && (
                                            <>
                                                <span className="block mt-1 font-bold">Qué revisar:</span>
                                                <ul className="list-[circle] pl-5">
                                                    {x.pistas.map((t, j) => <li key={j}>{t}</li>)}
                                                </ul>
                                            </>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </Notice>
                    ))}

                    {revision?.totales && <TotalesLadoALado t={revision.totales} />}

                    {/* Lo que hay que mirar antes de nada. */}
                    {!revision && uso === 'venta' && faltan > 0 && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            <b>{faltan}</b> de {resumen.renglones} renglones necesitan un ojo:{' '}
                            {/* Sólo lo que de verdad falta. Enumerar las cuatro
                                categorías siempre —incluso en cero— hacía leer
                                «0 sin producto» como si fuera un hallazgo. */}
                            {[
                                [resumen.sin_producto,    'sin producto'],
                                [resumen.a_confirmar,     'con el producto por confirmar'],
                                [resumen.sin_lote,        'sin lote'],
                                [resumen.sin_vencimiento, 'sin vencimiento'],
                            ].filter(([n]) => n > 0).map(([n, texto], i, arr) => (
                                <span key={texto}>
                                    <b>{n}</b> {texto}{i < arr.length - 1 ? ' · ' : '.'}
                                </span>
                            ))}
                        </Notice>
                    )}
                    {uso === 'venta' && !papel && (
                        <PedirFechas documentId={doc.document_id} salas={salasReparto} puedeEditar={puedeEditar}
                            sinFecha={p.renglones.map((r, i) => ({ renglon: i, descripcion: r.descripcion, cantidad: r.cantidad }))
                                .filter(x => !ajustes[x.renglon]?.vence && !ajustes[x.renglon]?.erroneo && !ajustes[x.renglon]?.servicio)}
                            onFechas={usarFechas} />
                    )}
                    {!revision && uso === 'venta' && faltan === 0 && (
                        <Notice variant="success" icon={CheckCircle2}>
                            Los {resumen.renglones} renglones están completos.
                        </Notice>
                    )}

                    <div className="flex flex-col gap-2 mt-3">
                        {p.renglones.map((r, i) => {
                            const k = claveDe(r, i);
                            const elegido = elegidos[k];
                            const o = ORIGEN[elegido ? 'aprendido' : r.match_origen] ?? null;
                            const Icono = o?.icon ?? HelpCircle;
                            const aj = ajustes[i] ?? ajusteInicial(r);
                            const conProducto = !!productoDe(r, i);
                            const factorCambio = conProducto && (r.llave || r.codigo_proveedor)
                                && Number(aj.factor) !== Number(elegido?.factor ?? r.factor_proveedor ?? 1);
                            const sim = entraComo.get(i);
                            const fCarga = Number(aj.factor) || 1;
                            const juicio = juzgarPresentacion({
                                tam: Number(r.tamano_factura) || null,
                                presentaciones: vinetasDe(r, i),
                                nombre: elegido?.nombre ?? r.producto,
                                factor: fCarga,
                                costoNuevoUnidad: Number(r.costo_neto) > 0 ? Number(r.costo_neto) / fCarga : null,
                                // El costo de antes lo trae la lectura de la factura (el navegador
                                // no puede leer el costo del catálogo); con otro producto elegido,
                                // el de ESE producto.
                                costoAntesUnidad: elegido && elegido.product_id !== r.producto_id
                                    ? (elegido.costoUnidadAntes ?? null)
                                    : (Number(r.costo_unidad_antes) > 0 ? Number(r.costo_unidad_antes) : null),
                            });
                            return (
                                <div key={`${r.codigo_proveedor}-${i}`} data-surface="card" className="p-4">
                                    {/* Encabezado: qué producto es y cuánto factura el proveedor. */}
                                    <div className="flex items-start gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-body font-black text-content">
                                                    {uso === 'consumo' || aj.servicio ? r.descripcion
                                                        : aj.erroneo && !conProducto ? 'PRODUCTO ERRONEO DE PROVEEDOR'
                                                        : (elegido?.nombre ?? r.producto ?? '— sin producto —')}
                                                </p>
                                                {uso === 'venta' && !aj.servicio && o && (
                                                    <Badge variant={elegido ? 'success' : o.variant} size="sm">
                                                        <Icono size={11} className="mr-1 inline" />
                                                        {elegido ? 'Confirmado' : o.label}
                                                        {r.match_origen === 'parecido' && !elegido && r.match_similitud != null
                                                            && ` · ${Math.round(r.match_similitud * 100)}%`}
                                                    </Badge>
                                                )}
                                            </div>
                                            {uso === 'venta' && !aj.servicio && (
                                                <p className="mt-0.5 text-caption text-content-3">En la factura: {r.descripcion}</p>
                                            )}
                                            {uso === 'venta' && !aj.servicio && !aj.erroneo && conProducto && (
                                                <PresentacionComparada tam={Number(r.tamano_factura) || null} juicio={juicio}
                                                    presentaciones={vinetasDe(r, i)} nombre={elegido?.nombre ?? r.producto} />
                                            )}
                                            {uso === 'venta' && !aj.servicio && !aj.erroneo && (() => {
                                                // Concentración o tamaño distinto entre la factura y el producto.
                                                const difs = elegido ? elegido.numeros : r.numeros_distintos;
                                                return difs?.length > 0 && (
                                                    <Notice variant="warning" icon={AlertTriangle} className="mt-2">
                                                        <b>¿Es el mismo producto?</b> {difs.join(' · ')}.
                                                        {!elegido && ' Confírmalo o elige el correcto.'}
                                                    </Notice>
                                                );
                                            })()}
                                            {uso === 'venta' && aj.servicio && (
                                                <p className="mt-0.5 text-caption text-content-2 font-bold">
                                                    Flete / servicio: suma al costo de la compra y a su total. No entra al inventario.
                                                </p>
                                            )}
                                            {uso === 'venta' && !aj.servicio && !aj.erroneo && !conProducto && !r.producto_id && (
                                                <p className="mt-1 text-caption text-warning-text font-bold">
                                                    No está en Bodega: ¿es nuevo, o es uno que ya tenemos con otro nombre? ¿O vino por error?
                                                </p>
                                            )}
                                            {uso === 'venta' && aj.erroneo && (
                                                <p className="mt-1 text-caption text-danger-text font-bold">
                                                    Error del proveedor: entra con la compra y pasa a Bodega de vencidos hasta que llegue la nota de crédito.
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-body font-black text-content tabular-nums">
                                                {r.cantidad} × {formatMoney(r.costo)}
                                            </p>
                                            <p className="text-caption text-content-3 tabular-nums">
                                                {formatMoney(Number(r.cantidad) * Number(r.costo))}
                                            </p>
                                        </div>
                                    </div>
                                    {uso === 'venta' && !aj.servicio && (
                                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] gap-3 items-start">
                                            <SeCargaComo r={r} aj={aj} puedeEditar={puedeEditar} juicio={juicio}
                                                presentaciones={[...new Map(vinetasDe(r, i).map(x => [x.factor, x])).values()]}
                                                onCargar={v => ajustarCarga(i, r, v)}
                                                recordar={factorCambio && puedeEditar && Number.isInteger(Number(aj.factor)) ? (() => {
                                                    // Guarda «cada una de este proveedor trae N» para que la
                                                    // próxima factura ya venga así. Sólo con un número parejo,
                                                    // y si Bodega no vende de a N, pregunta dos veces.
                                                    const raro = !tamanoAprendible(aj.factor, vinetasDe(r, i), r);
                                                    const guardar = () => { setDuda(null); confirmar(r, i, { id: productoDe(r, i), nombre: elegido?.nombre ?? r.producto }, { explicito: true }); };
                                                    if (duda === k) return (
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="text-caption font-bold text-warning-text">
                                                                Bodega no vende de a {Number(aj.factor)}. ¿Seguro que cada una trae {Number(aj.factor)}?
                                                            </span>
                                                            <Button size="xs" variant="secondary" tone="warning" loading={guardando === k} onClick={guardar}>Sí, guardar</Button>
                                                            <Button size="xs" variant="ghost" onClick={() => setDuda(null)}>No</Button>
                                                        </div>
                                                    );
                                                    return (
                                                        <Button size="xs" variant="ghost" icon={BookMarked} loading={guardando === k}
                                                            onClick={() => (raro ? setDuda(k) : guardar())}>
                                                            Siempre así: {Number(aj.factor)} por cada una
                                                        </Button>
                                                    );
                                                })() : null} />
                                            <PortalInput compact labelDenso label="Lote" value={aj.lote}
                                                onChange={e => ajustar(i, 'lote', e.target.value)} />
                                            <CampoMesAnio compact label="Vence" value={aj.vence} onChange={v => ajustar(i, 'vence', v)} />
                                            {(() => {
                                                const actual = vinetaActual(r, aj, sim, vinetasDe(r, i));
                                                const nueva = Number(aj.venta);
                                                const cambia = nueva > 0 && actual != null && Math.abs(nueva - actual) >= 0.005;
                                                return (
                                                    <div className="min-w-0">
                                                        <PortalInput compact labelDenso label="Regular" inputMode="decimal" prefix="$"
                                                            readOnly={!puedeEditar || aj.erroneo}
                                                            placeholder={actual != null ? actual.toFixed(2) : 'sin cambio'}
                                                            value={aj.venta ?? ''}
                                                            onChange={e => ajustar(i, 'venta', e.target.value.replace(/[^\d.]/g, ''))} />
                                                        {cambia && (
                                                            <p className={`mt-1 text-caption font-bold tabular-nums ${nueva > actual ? 'text-warning-text' : 'text-success-text'}`}>
                                                                {nueva > actual ? 'Sube' : 'Baja'} {Math.abs((nueva - actual) / actual * 100).toFixed(1)} % · antes {formatMoney(actual)}
                                                            </p>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                            {!aj.erroneo && (
                                                <Llegaron puedeEditar={puedeEditar}
                                                    total={Number(aj.cargar ?? cargarDe(r, aj.factor)) || 0}
                                                    valor={aj.llegaron}
                                                    onChange={v => ajustar(i, 'llegaron', v)} />
                                            )}
                                        </div>
                                    )}
                                    {uso === 'venta' && conProducto && !aj.erroneo && !aj.servicio && aj.vencidos && (
                                        <AVencidos valor={aj.vencidos} puedeEditar={puedeEditar}
                                            total={aj.llegaron !== '' && aj.llegaron != null
                                                ? Math.min(Number(aj.llegaron), Number(aj.cargar ?? cargarDe(r, aj.factor)) || 0)
                                                : Number(aj.cargar ?? cargarDe(r, aj.factor)) || 0}
                                            onChange={v => ajustar(i, 'vencidos', v)} />
                                    )}
                                    {uso === 'venta' && conProducto && !aj.erroneo && !aj.servicio && (
                                        <RepartoASalas salas={salasReparto} puedeEditar={puedeEditar}
                                            total={aj.llegaron !== '' && aj.llegaron != null
                                                ? Math.min(Number(aj.llegaron), Number(aj.cargar ?? cargarDe(r, aj.factor)) || 0)
                                                : Number(aj.cargar ?? cargarDe(r, aj.factor)) || 0}
                                            presentaciones={vinetasDe(r, i)}
                                            valor={aj.reparto} onChange={v => ajustar(i, 'reparto', v)} />
                                    )}
                                    {sim?.linea && !aj.servicio && <ComoEntra sim={sim} costo={costos.get(i)} />}
                                    {sim?.linea && puedeEditar && !aj.erroneo && !aj.servicio && costos.get(i)?.sugerida && !cantidadSospechosa(sim, costos.get(i)) && (
                                        <Notice variant="warning" icon={HelpCircle} className="mt-2">
                                            <span className="flex items-center gap-2 flex-wrap">
                                                <span className="flex-1 min-w-[14rem]">
                                                    El costo sube {costos.get(i).cambio.toFixed(1)} % y la viñeta sigue en {formatMoney(costos.get(i).ventaAntes)}.
                                                    ¿La caja trae precio nuevo? Con el mismo margen de antes ({Math.round(costos.get(i).margenAntes)} %)
                                                    sería <b>{formatMoney(costos.get(i).sugerida)}</b>.
                                                </span>
                                                <Button size="xs" onClick={() => ajustar(i, 'venta', costos.get(i).sugerida.toFixed(2))}>
                                                    Usar {formatMoney(costos.get(i).sugerida)}
                                                </Button>
                                            </span>
                                        </Notice>
                                    )}
                                    {uso === 'venta' && puedeEditar && conProducto && !aj.servicio && !aj.erroneo && (() => {
                                        // Saldo de recargas: el papel no dice cuántos dólares trae.
                                        const e = elegidos[k];
                                        const s = e && 'saldo' in e ? e.saldo : (e && e.product_id !== r.producto_id ? null : r.saldo_sugerido);
                                        if (!s || String(aj.cargar ?? '') === String(s.unidades)) return null;
                                        return (
                                            <Notice variant="info" icon={HelpCircle} className="mt-2">
                                                <span className="flex items-center gap-2 flex-wrap">
                                                    <span className="flex-1 min-w-[14rem]">
                                                        <b>Sugerencia</b> — revisa que cuadre con la factura: el saldo se carga
                                                        en unidades de $1, y la factura no dice cuántos dólares trae.
                                                        Con lo pagado ({formatMoney(s.pagado)}) y el costo de la última compra
                                                        {s.de?.mismo_proveedor ? ' a este proveedor' : ` (${s.de?.proveedor ?? 'otro proveedor'})`}
                                                        {' '}({formatMoney(s.costo_referencia, { decimales: 4 })} por cada $1, {fmtFecha(s.de?.fecha)}),
                                                        serían <b>{s.unidades}</b>{s.exacto ? '' : ' aproximadamente'}.
                                                    </span>
                                                    <Button size="xs" onClick={() => ajustarCarga(i, r, String(s.unidades))}>
                                                        Usar {s.unidades}
                                                    </Button>
                                                </span>
                                            </Notice>
                                        );
                                    })()}
                                    {sim?.linea && puedeEditar && !aj.servicio && (() => {
                                        const sug = cantidadSospechosa(sim, costos.get(i));
                                        return sug && (
                                            <Notice variant="danger" icon={AlertTriangle} className="mt-2">
                                                <span className="flex items-center gap-2 flex-wrap">
                                                    <span className="flex-1 min-w-[14rem]">
                                                        El costo queda {sug.veces} veces {sug.sube ? 'más caro' : 'más barato'} que antes:
                                                        casi siempre es la cantidad. ¿Entran <b>{sug.unidades}</b> y no {sim.existencias}?
                                                    </span>
                                                    <Button size="xs" onClick={() => ajustarCarga(i, r, String(sug.unidades))}>
                                                        Cargar {sug.unidades}
                                                    </Button>
                                                </span>
                                            </Notice>
                                        );
                                    })()}
                                    {/* Acciones al pie, en una sola fila: antes competían con el
                                        nombre y el precio en el encabezado. */}
                                    {uso === 'venta' && puedeEditar && (
                                        <div className="mt-3 pt-3 border-t border-divider flex items-center gap-2 flex-wrap">
                                            {conProducto && !aj.erroneo && !aj.servicio && !aj.reparto && salasReparto.length > 0 && (
                                                <Button size="xs" variant="ghost" icon={Truck} onClick={() => {
                                                    // Por defecto, en la presentación en que se carga.
                                                    const f = Number(aj.factor) || 1;
                                                    ajustar(i, 'reparto', { por: presDelCatalogo(vinetasDe(r, i)).some(x => x.factor === f) ? f : 1 });
                                                }}>
                                                    Enviar a sucursales
                                                </Button>
                                            )}
                                            {conProducto && !aj.erroneo && !aj.servicio && !aj.vencidos && (
                                                <Button size="xs" variant="ghost" icon={Archive}
                                                    onClick={() => ajustar(i, 'vencidos', { modo: 'todo', unidades: '', motivo: '', detalle: '' })}>
                                                    A vencidos
                                                </Button>
                                            )}
                                            <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                                                {!aj.servicio && r.producto_id && !elegido && (r.match_origen === 'parecido' || r.numeros_distintos?.length > 0) && (
                                                    <Button size="xs" loading={guardando === k}
                                                        onClick={() => confirmar(r, i, { id: r.producto_id, nombre: r.producto })}>
                                                        Es correcto
                                                    </Button>
                                                )}
                                                {!aj.servicio && !conProducto && !aj.erroneo && (
                                                    <Button size="xs" icon={PackagePlus} onClick={() => setCreando(i)}
                                                        variant={r.producto_id && r.match_origen === 'parecido' ? 'ghost' : 'primary'}>
                                                        Es nuevo
                                                    </Button>
                                                )}
                                                {!aj.servicio && (
                                                    <Button size="xs" variant="ghost" icon={Search} loading={guardando === k}
                                                        onClick={() => setBusc(buscando === k ? null : k)}>
                                                        {conProducto || r.producto_id ? 'Es otro producto' : 'Elegir producto'}
                                                    </Button>
                                                )}
                                                {!aj.servicio && (
                                                    <Button size="xs" variant={aj.erroneo ? 'secondary' : 'ghost'}
                                                        onClick={() => ajustar(i, 'erroneo', !aj.erroneo)}>
                                                        {aj.erroneo ? 'No es erróneo' : 'Producto erróneo'}
                                                    </Button>
                                                )}
                                                {!aj.erroneo && (
                                                    <Button size="xs" variant={aj.servicio ? 'secondary' : 'ghost'}
                                                        onClick={() => ajustar(i, 'servicio', !aj.servicio)}>
                                                        {aj.servicio ? 'Es un producto' : 'Es flete / servicio'}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {buscando === k && (
                                        <BuscadorProducto
                                            onElegir={(prod) => confirmar(r, i, prod)}
                                            onCancelar={() => setBusc(null)} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    </>)}
                </>)}
                {creando != null && p && (
                    <NuevoProducto renglon={p.renglones[creando]} factor={ajustes[creando]?.factor}
                        documentId={doc.document_id ?? null} manualId={doc.manual_id ?? null}
                        onCerrar={() => setCreando(null)}
                        onUsar={async (producto) => {
                            const i = creando;
                            setCreando(null);
                            await confirmar(p.renglones[i], i, producto);
                        }}
                        onCreado={async (producto, notas) => {
                            const i = creando;
                            setCreando(null);
                            useStaff.getState().appendAuditLog('PRODUCTO_NUEVO_CREADO', String(producto.id), {
                                nombre: producto.nombre, documento: doc.document_id, notas,
                            });
                            await confirmar(p.renglones[i], i, producto);
                            if (notas.length) setError(`Se creó ${producto.nombre} (${producto.id}), pero revisa su ficha: ${notas.join(' · ')}.`);
                        }} />
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                {saliendo ? (
                // Bodega lo confundió con «mandarla a una sucursal» (2026-11-05):
                // el rótulo viejo, «No va a Bodega», se leía como un destino.
                // Lo que hace es SACARLA de la lista sin cargar nada, y eso es
                // lo que tiene que decir antes del clic.
                <div className="flex flex-col gap-2 w-full">
                    <Notice variant="warning" icon={AlertTriangle}>
                        <b>Esta factura no se carga en ningún inventario</b> — ni en Bodega ni en las salas. Sólo sale
                        de esta lista. Úsalo si es un gasto o servicio (luz, ferretería, papelería) o si ya se cargó.
                        <br />¿Querías mandar productos a una sala? Eso es <b>«Enviar a sucursales»</b>, en cada producto.
                    </Notice>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Button size="sm" variant="primary" disabled={resolviendo} onClick={() => setSaliendo(false)}>No, volver</Button>
                        <Button size="sm" variant="secondary" loading={resolviendo}
                            onClick={() => sacarDeLaLista('no_va_a_bodega')}>Sí, quitar esta factura</Button>
                        <Button size="sm" variant="ghost" loading={resolviendo} disabled={!doc.emisor_nit}
                            onClick={() => setConfProv(true)}>Quitar todo lo de este proveedor</Button>
                    </div>
                </div>
                ) : (
                <div className="flex items-center gap-2 w-full flex-wrap">
                    {lista && revision?.listo && revisionVigente && !yaMandada ? (
                        <p className="text-label font-bold text-success-text flex-1 min-w-[12rem] flex items-center gap-1">
                            <CheckCircle2 size={14} className="shrink-0" /> Lista: todo emparejado y revisado. Sólo falta «Cargar en Bodega».
                        </p>
                    ) : (
                        <p className="text-micro text-content-3 flex-1 min-w-[12rem]">
                            «Revisar carga» arma la compra como la recibiría Bodega y la compara con el documento. Se registra sólo con «Cargar en Bodega».
                        </p>
                    )}
                    {puedeEditar && !papel && !envio?.enviada && !estadoCarga && (
                        <Button size="sm" variant="ghost" onClick={() => setSaliendo(true)}>No es mercadería</Button>
                    )}
                    {puedeEditar && papel && !envio?.enviada && onCorregirPapel && (
                        <Button size="sm" variant="ghost" onClick={() => { clearDraft(claveBorrador); onCorregirPapel(); }}>Corregir factura</Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={enviando} onClick={onCerrar}>Cerrar</Button>
                    {p && !yaMandada && (
                        <Button size="sm" variant="ghost" disabled={enviando || revisando}
                            title="Vuelve a traer los productos (costos y presentaciones) y rearma la propuesta. Lo que ya ajustaste se conserva."
                            onClick={cargar}>Actualizar productos</Button>
                    )}
                    {puedeEditar && p && !yaMandada && (
                        <Button size="sm" variant={revision?.listo && revisionVigente ? 'ghost' : 'primary'} loading={revisando}
                            disabled={enviando} onClick={revisar}>Revisar carga</Button>
                    )}
                    {puedeEditar && !yaMandada && revision?.listo && revisionVigente && resultado?.carga_id && (
                        <Button size="sm" onClick={() => setConf(true)} disabled={revisando}>Cargar en Bodega</Button>
                    )}
                </div>
                )}
            </LiquidModal.Footer>
            <ConfirmModal isOpen={confProv} onClose={() => !resolviendo && setConfProv(false)}
                onConfirm={async () => { await sacarDeLaLista('proveedor_no_va'); setConfProv(false); }}
                isProcessing={resolviendo} isDestructive={false}
                title="¿Quitar todo lo de este proveedor?"
                message={`Las facturas de ${doc.emisor_nombre} salen de esta lista: las de hoy y todas las que lleguen después.`}
                confirmText="Sí, sacarlas" />
            <ConfirmModal isOpen={confirmando} onClose={() => !enviando && setConf(false)} onConfirm={enviar}
                isProcessing={enviando} isDestructive={false}
                title="¿Cargar esta compra en Bodega?"
                message={`Se registra la compra de ${doc.emisor_nombre} por ${formatMoney(revision?.total_armado)} en Bodega. Sólo se deshace anulándola allá.`}
                confirmText="Sí, cargar" />
        </LiquidModal>
    );
}

/* Los totales de la factura contra los que se cargan, renglón por renglón,
   para confirmarlos a ojo aunque la revisión diga que cuadran. Una fila sin
   número en la carga (descuento, retención) es algo que la carga no lleva
   aparte: el descuento ya está dentro de cada costo. */
const FILAS_TOTALES = [
    ['gravada',    'Gravado (sin IVA)'],
    ['exenta',     'Exento / no sujeto'],
    ['descuento',  'Descuento'],
    ['iva',        'IVA 13 %'],
    ['percepcion', 'Percepción 1 %'],
    ['retencion',  'Retención'],
    ['total',      'Total'],
];
function TotalesLadoALado({ t }) {
    const filas = FILAS_TOTALES.filter(([k]) => Number(t.documento?.[k]) || Number(t.carga?.[k]) || k === 'total' || k === 'iva');
    // Cada fila es su propia grilla: así la raya del total cruza de lado a lado
    // en vez de cortarse por columna.
    const cols = 'grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_1.5rem] items-center gap-x-4';
    return (
        <div data-surface="card" className="mt-3 px-4 py-3">
            <div className={`${cols} pb-1.5`}>
                <span className="text-caption font-black text-content-3 uppercase tracking-widest">Montos</span>
                <span className="text-caption font-black text-content-3 uppercase tracking-widest text-right">Factura</span>
                <span className="text-caption font-black text-content-3 uppercase tracking-widest text-right">Se carga</span>
                <span />
            </div>
            {filas.map(([k, rotulo]) => {
                const d = t.documento?.[k], c = t.carga?.[k];
                const comparable = d != null && c != null;
                const igual = comparable && Math.abs(Number(d) - Number(c)) <= 0.05;
                const esTotal = k === 'total';
                return (
                    <div key={k} className={`${cols} tabular-nums ${esTotal ? 'mt-1.5 pt-2 border-t border-divider' : 'py-1'}`}>
                        <span className={`min-w-0 ${esTotal ? 'text-body font-black text-content' : 'text-label text-content-2'}`}>
                            {rotulo}
                            {k === 'descuento' && <span className="ml-2 text-micro text-content-3">ya va dentro de cada costo</span>}
                        </span>
                        <span className={`text-right ${esTotal ? 'text-body font-black text-content' : 'text-label text-content'}`}>
                            {d != null ? formatMoney(d) : '—'}
                        </span>
                        <span className={`text-right ${esTotal ? 'text-body font-black text-content' : 'text-label text-content'}`}>
                            {c != null ? formatMoney(c) : <span className="text-content-3">—</span>}
                        </span>
                        <span className="flex justify-end">
                            {comparable && (igual
                                ? <CheckCircle2 size={15} className="text-success-text" aria-label="igual" />
                                : <AlertTriangle size={15} className="text-danger-text" aria-label={`diferencia ${formatMoney(Number(c) - Number(d))}`} />)}
                        </span>
                    </div>
                );
            })}
            {filas.some(([k]) => t.documento?.[k] != null && t.carga?.[k] != null
                && Math.abs(Number(t.documento[k]) - Number(t.carga[k])) > 0.05) && (
                <p className="mt-2 text-micro text-danger-text">Hay montos que no coinciden con la factura: revísalos antes de cargar.</p>
            )}
        </div>
    );
}

/* Cómo entra un renglón a Bodega, después de revisar: en qué presentación,
   cuántas unidades, el costo contra el anterior y el margen con el precio de
   hoy. Cuatro datos en fila, cada uno con su rótulo, en vez de un párrafo. */
/**
 * Facturas sin vencimiento (Sarita): la mercadería llegó a una sala y la
 * factura a Bodega. Bodega le pide las fechas a esa sala; la sala contesta en
 * Traslados y las fechas llenan los renglones vacíos solas (usuario,
 * 2026-10-30: «que bodega pueda solicitar a la sucursal, son para estos casos»).
 */
function PedirFechas({ documentId, sinFecha, salas, puedeEditar, onFechas }) {
    const [pedidos, setPedidos] = useState(null);
    const [sala, setSala] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        const { pedidos: p, error: e } = await fetchPedidosDeVence();
        if (e) setError(e);
        setPedidos(p.filter(x => x.document_id === documentId && x.estado !== 'cancelado'));
    }, [documentId]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    const vivo = (pedidos ?? []).find(x => x.estado === 'pendiente');
    const contestado = (pedidos ?? []).find(x => x.estado === 'respondido');
    useEffect(() => { if (contestado?.respuestas) onFechas(contestado.respuestas); }, [contestado, onFechas]);

    const pedir = async () => {
        setOcupado(true); setError('');
        const { error: e } = await pedirVencesASala(documentId, sala, sinFecha);
        setOcupado(false);
        if (e) { setError(e); return; }
        cargar();
    };
    const cancelar = async () => {
        setOcupado(true); setError('');
        const { error: e } = await cancelarPedidoDeVence(vivo.id);
        setOcupado(false);
        if (e) setError(e);
        cargar();
    };

    if (!pedidos) return null;
    if (vivo) {
        return (
            <Notice variant="info" icon={CalendarRange}>
                <b>Fechas pedidas a {vivo.sala}</b> ({(vivo.renglones ?? []).length} productos), esperando respuesta.
                Cuando conteste, se llenan solas.
                <span className="flex items-center gap-2 mt-1 text-micro">
                    <AvatarConEstado emp={{ id: vivo.pedido_por, name: vivo.pedido_nombre }} px={20} marco="" />
                    {shortEmployeeName(vivo.pedido_nombre)}
                    {puedeEditar && <Button size="xs" variant="ghost" loading={ocupado} onClick={cancelar}>Cancelar pedido</Button>}
                </span>
                {error && <Notice variant="danger">{error}</Notice>}
            </Notice>
        );
    }
    return (
        <>
            {contestado && (
                <Notice variant="success" icon={CheckCircle2}>
                    <b>{contestado.sala} contestó las fechas</b> y ya están puestas en los renglones.
                    <span className="flex items-center gap-2 mt-1 text-micro">
                        <AvatarConEstado emp={{ id: contestado.respondido_por, name: contestado.respondido_nombre }} px={20} marco="" />
                        {shortEmployeeName(contestado.respondido_nombre)}
                    </span>
                </Notice>
            )}
            {sinFecha.length > 0 && puedeEditar && (
                <Notice variant="warning" icon={CalendarRange}>
                    <b>{sinFecha.length === 1 ? 'Un producto no trae' : `${sinFecha.length} productos no traen`} fecha de vencimiento.</b>{' '}
                    Si la mercadería llegó a una sala, pídele las fechas:
                    <span className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="w-[12rem]">
                            <LiquidSelect value={sala} onChange={v => setSala(v || '')} placeholder="¿Qué sala la recibió?"
                                options={salas.map(b => ({ value: String(b.id), label: b.name }))} compact />
                        </span>
                        <Button size="sm" icon={CalendarRange} disabled={!sala || ocupado} loading={ocupado} onClick={pedir}>
                            Pedir fechas
                        </Button>
                    </span>
                    {error && <Notice variant="danger" className="mt-1">{error}</Notice>}
                </Notice>
            )}
        </>
    );
}

/** `{ branchId: '12' }` tecleado → `{ branchId: 12 }` sin vacíos, o null. */
function aRepartir(reparto) {
    if (!reparto) return null;
    // `por`: cuántas unidades trae cada una de lo que se escribió (CAJA 20 →
    // 2 cajas son 40). Al servidor viaja siempre en unidades.
    const por = Number(reparto.por) || 1;
    const limpio = Object.fromEntries(Object.entries(reparto).filter(([b]) => b !== 'por')
        .map(([b, v]) => [b, Number(v) * por]).filter(([, n]) => n > 0));
    return Object.keys(limpio).length ? limpio : null;
}

/**
 * ¿Se envía parte de este renglón a otras salas? (usuario, 2026-10-30). Se
 * escribe en la presentación que se elija (por defecto, la que se carga: 2 cajas
 * de TRAMACET mandaban 2 unidades, 2026-11-07) y viaja en unidades; nunca más
 * de lo que entra, y si se envía menos se dice cuánto queda en Bodega.
 */
/**
 * «A vencidos» (Bodega, 2026-11-05): el producto es el correcto, entra con su
 * nombre, y todas o algunas unidades pasan al área de vencidos de Bodega al
 * cargar — se devuelve, viene corto de vencimiento, llegó dañado. El motivo es
 * obligatorio: es lo que después decide qué se hace con esas unidades.
 */
const MOTIVOS_VENCIDOS = [
    { value: 'devolucion', label: 'Se devuelve al proveedor' },
    { value: 'corto_vencimiento', label: 'Corto vencimiento' },
    { value: 'danado', label: 'Dañado' },
    { value: 'otro', label: 'Otro' },
];
function AVencidos({ valor, total, onChange, puedeEditar }) {
    const poner = (k, v) => onChange({ ...valor, [k]: v });
    const n = Number(valor.unidades);
    const algunas = valor.modo === 'algunas';
    const aviso = algunas && valor.unidades !== '' && (!Number.isInteger(n) || n < 1 || n > total)
        ? `Tiene que ser un número entero entre 1 y ${total}.` : null;
    return (
        <div className="mt-3 pt-3 border-t border-divider">
            <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-caption font-black text-content-3 uppercase tracking-widest flex items-center gap-1">
                    <Archive size={12} /> A vencidos de Bodega
                </p>
                {puedeEditar && (
                    <Button size="xs" variant="ghost" onClick={() => onChange(null)}>Quitar</Button>
                )}
            </div>
            <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,10rem)_minmax(0,1fr)] items-end">
                <SegmentedControl size="sm" label="¿Cuántas?" value={valor.modo}
                    onChange={(v) => poner('modo', v)}
                    options={[{ value: 'todo', label: `Todas (${total})` }, { value: 'algunas', label: 'Algunas' }]} />
                {algunas ? (
                    <PortalInput compact label="Unidades" type="number" min="1" max={total} value={valor.unidades}
                        placeholder={`de ${total}`} onChange={(e) => poner('unidades', e.target.value)} />
                ) : <span className="hidden sm:block" />}
                <div className="flex flex-col">
                    <span className={rotuloCampo('text-content-3', { denso: true })}>Motivo</span>
                    <LiquidSelect compact placeholder="¿Por qué va a vencidos?" value={valor.motivo || ''} clearable={false}
                        options={MOTIVOS_VENCIDOS} onChange={(v) => poner('motivo', v || '')} />
                </div>
            </div>
            {valor.motivo === 'otro' && (
                <div className="mt-2">
                    <PortalInput compact label="¿Cuál?" value={valor.detalle} maxLength={200}
                        placeholder="Escribe el motivo" onChange={(e) => poner('detalle', e.target.value)} />
                </div>
            )}
            {aviso && <Notice variant="danger" className="mt-1">{aviso}</Notice>}
            <p className="mt-2 text-caption text-content-3">
                Se carga con su nombre y, al terminar, {algunas && n > 0 ? `${n} ${n === 1 ? 'unidad pasa' : 'unidades pasan'}` : 'todas pasan'} al
                área de vencidos de Bodega. Queda en «Productos erróneos» con su motivo.
            </p>
        </div>
    );
}

function RepartoASalas({ salas, total, valor, presentaciones, onChange, puedeEditar }) {
    // El botón para abrirlo vive al pie de la tarjeta, con las demás acciones.
    if (!valor) return null;
    const pres = presDelCatalogo(presentaciones);
    const por = Number(valor.por) || 1;
    const cuantas = Object.entries(valor).filter(([b]) => b !== 'por')
        .reduce((t, [, v]) => t + (Number(v) || 0), 0);
    const suma = cuantas * por;
    const quedan = total - suma;
    const elegida = pres.find(x => x.factor === por);
    const enPres = (n) => por > 1 && elegida ? `${n} × ${nombrePres(elegida)} = ${n * por} unidades` : `${n}`;
    return (
        <div className="mt-3 pt-3 border-t border-divider">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-caption font-black text-content-3 uppercase tracking-widest flex items-center gap-1">
                    <Truck size={12} /> Enviar a sucursales
                </p>
                <div className="flex items-center gap-2">
                    {pres.length > 1 && (
                        <div className="w-44">
                            <LiquidSelect compact clearable={false} disabled={!puedeEditar} ariaLabel="Se envía en"
                                value={String(por)}
                                options={pres.map(x => ({ value: String(x.factor), label: nombrePres(x) }))}
                                onChange={v => v && onChange({ ...valor, por: Number(v) })} />
                        </div>
                    )}
                    {puedeEditar && (
                        <Button size="xs" variant="ghost" onClick={() => onChange(null)}>No enviar</Button>
                    )}
                </div>
            </div>
            <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {salas.map(sala => (
                    <PortalInput key={sala.id} compact labelDenso label={sala.name} inputMode="numeric"
                        readOnly={!puedeEditar} placeholder="0"
                        value={valor[sala.id] ?? ''}
                        onChange={e => onChange({ ...valor, [sala.id]: String(e.target.value).replace(/[^\d]/g, '') })} />
                ))}
            </div>
            {suma > 0 && (
                <p className={`mt-1 text-micro font-bold tabular-nums ${quedan < 0 ? 'text-danger' : quedan > 0 ? 'text-warning' : 'text-content-2'}`}>
                    {quedan < 0 ? `Se envían ${enPres(cuantas)} y entran ${total}: no se puede enviar más de lo que entra.`
                        : quedan > 0 ? `Se envían ${enPres(cuantas)} · quedan ${quedan} unidades en el inventario de Bodega.`
                        : `Se envían ${enPres(cuantas)}: no queda nada en Bodega.`}
                </p>
            )}
        </div>
    );
}

// Si el costo nuevo es un múltiplo entero (×2 o más) del de antes, lo más
// probable es que la caja del proveedor traiga otra cantidad de unidades:
// 50 «CAJA X 10» cargadas como 50 unidades dejan cada una 10 veces más cara.
function cantidadSospechosa(sim, costo) {
    const antes = Number(costo?.antes), nuevo = Number(costo?.nuevo);
    if (!(antes > 0 && nuevo > 0)) return null;
    const sube = nuevo > antes;
    const razon = sube ? nuevo / antes : antes / nuevo;
    const veces = Math.round(razon);
    if (veces < 2 || Math.abs(razon - veces) / veces > 0.12) return null;
    const unidades = sube ? sim.existencias * veces : sim.existencias / veces;
    return Number.isInteger(unidades) && unidades > 0 ? { veces, sube, unidades } : null;
}

function SeCargaComo({ r, aj, presentaciones, juicio, puedeEditar, onCargar, recordar }) {
    const cant = Number(r.cantidad) || 0;
    const f = Number(aj.factor) || 0;
    const unidades = aj.cargar ?? cargarDe(r, aj.factor);
    // Una presentación con factor 0 es la copia del catálogo que no pudo
    // guardar el tamaño (saldo Tigo: «UNIDAD (0.25)» en una columna entera, y
    // la de 1 pisada por tener el mismo tipo). No se ofrece ni se juzga con
    // ella: la revisión lee las presentaciones reales del sistema.
    const pres = [...presentaciones].filter(x => x.factor > 0).sort((a, b) => a.factor - b.factor);
    const coincide = pres.some(x => x.factor === f);
    const [otra, setOtra] = useState(false);
    const abierta = otra || !coincide || pres.length === 0;
    const r3 = (n) => Math.round(n * 1000) / 1000;
    const nombreDe = (x) => x.nombre ?? (x.factor > 1 ? 'CAJA' : 'UNIDAD');
    const aviso = cargarAyuda(r, aj);
    return (
        <div className="min-w-0">
            <p className={rotuloCampo('text-content-3', { denso: true })}>Se carga como</p>
            {pres.length > 0 && (
                <LiquidSelect compact clearable={false} disabled={!puedeEditar} ariaLabel="Se carga como"
                    value={abierta ? OTRA : String(f)}
                    options={[
                        ...pres.map(x => ({ value: String(x.factor), label: `${r3(cant)} × ${nombreDe(x)} (${x.factor})` })),
                        { value: OTRA, label: 'Otra cantidad de unidades…' },
                    ]}
                    onChange={v => {
                        if (!v) return;
                        if (v === OTRA) { setOtra(true); return; }
                        setOtra(false);
                        onCargar(String(cant * Number(v)));
                    }} />
            )}
            {abierta && (
                <div className={pres.length > 0 ? 'mt-2' : ''}>
                    <PortalInput compact inputMode="numeric" readOnly={!puedeEditar}
                        aria-label="Unidades que entran" placeholder="Unidades que entran"
                        value={unidades} onChange={e => onCargar(e.target.value)} />
                </div>
            )}
            {/* Con «Otra cantidad» se valida contra las presentaciones del
                sistema, igual que al cargar (Bodega, 2026-11-05): escribir un
                número no sirve de nada si el producto no tiene cómo recibirlo.
                Entra en la presentación de ese tamaño, o suelto en la de 1
                unidad; si no tiene ninguna de las dos, se dice ANTES. */}
            {(() => {
                const u = Number(unidades) || 0;
                if (!abierta || pres.length === 0) {
                    return (
                        <>
                            <p className="mt-1 text-caption text-content-2 tabular-nums">
                                Entran <b className="text-content">{u}</b> {u === 1 ? 'unidad' : 'unidades'}
                                {f > 1 && Number.isInteger(r3(f)) ? ` · ${r3(f)} por cada una` : ''}
                            </p>
                            {aviso && <p className="mt-0.5 text-caption font-bold text-warning-text">{aviso}</p>}
                        </>
                    );
                }
                if (!(u > 0)) return <p className="mt-1 text-caption text-content-3">Escribe cuántas unidades entran en total.</p>;
                // Mismo freno que el servidor (`lineaDelSobre`): cada una de la
                // factura trae un número ENTERO de unidades. Si llegó menos, eso
                // no se escribe acá —escondería el faltante en un costo inflado—:
                // va en «¿Llegó todo? → Faltó».
                if (!Number.isInteger(r3(f))) {
                    const abajo = Math.floor(f) * cant, arriba = Math.ceil(f) * cant;
                    return (
                        <p className="mt-1 text-caption font-bold text-danger-text tabular-nums">
                            {u < cant
                                ? `La factura cobra ${r3(cant)}: se cargan las ${r3(cant)}. Si llegaron ${u}, márcalo en «¿Llegó todo? → Faltó».`
                                : `${u} no se reparte entre las ${r3(cant)} de la factura (saldrían ${Math.round(f * 100) / 100} por cada una). Tiene que ser múltiplo de ${r3(cant)}: ${abajo > 0 ? `${abajo} o ` : ''}${arriba}.`}
                        </p>
                    );
                }
                const exacta = pres.find(x => x.factor === r3(f));
                const suelta = pres.find(x => x.factor === 1);
                if (exacta) {
                    return (
                        <p className="mt-1 text-caption text-content-2 tabular-nums">
                            Entra como <b className="text-content">{r3(cant)} × {nombreDe(exacta)} ({exacta.factor})</b> · {u} unidades
                        </p>
                    );
                }
                if (suelta) {
                    return (
                        <p className="mt-1 text-caption text-content-2 tabular-nums">
                            Entran <b className="text-content">{u} × {nombreDe(suelta)}</b> · {r3(f)} por cada una de la factura
                        </p>
                    );
                }
                return (
                    <p className="mt-1 text-caption font-bold text-danger-text">
                        No se puede cargar así: en el sistema este producto sólo se vende como{' '}
                        {pres.map(x => `${nombreDe(x)} (${x.factor})`).join(', ')}, y {u} unidades no caben en ninguna.
                        Elige una de la lista, o pide que le creen la presentación de 1 unidad.
                    </p>
                );
            })()}
            {(() => {
                // El tamaño elegido contra lo que dice la factura y lo que vende
                // Bodega: 140 por caja cuando la factura dice 100 (RINOKEM).
                const tam = Number(r.tamano_factura) || null;
                const fr = r3(f);
                if (!(fr > 1)) return null;
                // Sólo si el juicio de la presentación no lo descartó: VALPAKINE
                // va de a 4 blísteres por caja de 40 tabletas, y está bien.
                if (tam && fr !== tam && juicio?.aviso) {
                    return <p className="mt-0.5 text-caption font-bold text-warning-text">Ojo: la factura dice caja de {tam}, y aquí van {fr} por cada una.</p>;
                }
                if (!tam && pres.length > 0 && !pres.some(x => x.factor === fr)) {
                    return <p className="mt-0.5 text-caption font-bold text-warning-text">Ojo: Bodega no vende de a {fr}. Revisa que cada una de la factura traiga {fr}.</p>;
                }
                return null;
            })()}
            {recordar && <div className="mt-1">{recordar}</div>}
        </div>
    );
}

/* Lo que dice la factura de la presentación, al lado de lo que vende Bodega.
 * Si la caja cambió de tamaño, lo dice y sugiere qué crear (2026-11-06). */
function PresentacionComparada({ tam, presentaciones, nombre, juicio }) {
    const pres = presDelCatalogo(presentaciones);
    if (!pres.length) return null;
    // Quién decide si cambió: `juzgarPresentacion` (el costo, y si no hay, el
    // nombre). Las alarmas falsas de «x 40» contra «CAJA (4)» salían de acá.
    const cambio = !!juicio?.aviso;
    const confirmado = juicio?.aviso === 'confirmado';
    const nuevo = cambio ? nombreConTamano(nombre, tam) : null;
    return (
        <>
            <p className="mt-0.5 text-caption text-content-3">
                {tam ? <>La factura trae <b className="text-content-2">caja de {tam}</b> · </> : null}
                En Bodega: {pres.map(nombrePres).join(', ')}
            </p>
            {cambio && (
                <Notice variant="warning" icon={AlertTriangle} className="mt-2">
                    {confirmado ? (
                        <><b>Cambió la presentación.</b> La factura trae caja de {tam}, no de {juicio.tamanoBodega}: cargada así, cada
                        unidad queda {Math.round(Math.abs(juicio.sube))} % más {juicio.sube > 0 ? 'cara' : 'barata'}, justo lo que da {tam} ÷ {juicio.tamanoBodega}.</>
                    ) : (
                        <><b>¿Cambió la presentación?</b> La factura trae caja de {tam} y Bodega no la tiene.</>
                    )}
                    {' '}Si es así, hay que crear la presentación de {tam}
                    {nuevo ? <> y cambiar el nombre del producto a <b>«{nuevo}»</b></> : null}.
                    {pres.some(x => x.factor === 1) ? ' Mientras tanto entra en unidades.' : ''}
                </Notice>
            )}
        </>
    );
}

function ComoEntra({ sim, costo }) {
    const cambio = costo?.cambio;
    const parejo = cambio == null || Math.abs(cambio) < 0.5;
    const notaCosto = costo?.antes == null ? 'sin costo anterior'
        : parejo ? 'igual que antes'
        : `${cambio > 0 ? 'sube' : 'baja'} ${Math.abs(cambio).toFixed(1)} % · antes ${formatMoney(costo.antes, { decimales: 4 })}`;
    // Sin «Se carga como»: ya lo dice el campo de arriba. Acá va lo que resulta
    // de cargar: cuánto entra, a qué costo y con qué margen.
    return (
        <div className="mt-3 pt-3 border-t border-divider grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            <Dato titulo="Entran al inventario" valor={`${sim.existencias} unidades`}
                nota={sim.vence_pendiente ? 'el vencimiento lo pone la sala' : null} />
            {costo && (
                <div className="min-w-0">
                    <p className="text-caption font-black text-content-3 uppercase tracking-widest">Costo por unidad</p>
                    <p className="text-body font-bold text-content tabular-nums">{formatMoney(costo.nuevo, { decimales: 4 })}</p>
                    <p className={`text-caption tabular-nums truncate ${parejo ? 'text-content-3' : cambio > 0 ? 'text-warning-text' : 'text-success-text'}`}>
                        {notaCosto}
                    </p>
                </div>
            )}
            {costo && (
                <div className="min-w-0">
                    <p className="text-caption font-black text-content-3 uppercase tracking-widest">Precio regular</p>
                    <p className="text-body font-bold text-content tabular-nums">
                        {formatMoney(costo.venta)}
                        {costo.ventaAntes > 0 && Math.abs(costo.venta - costo.ventaAntes) >= 0.005 && (
                            <span className="ml-1 text-caption font-bold text-warning-text">antes {formatMoney(costo.ventaAntes)}</span>
                        )}
                    </p>
                    <p className="text-caption text-content-3 tabular-nums flex items-center gap-1">
                        {costo.margen != null ? `margen ${Math.round(costo.margen)} %` : 'sin margen'}
                        {costo.alerta && <Badge variant={costo.alerta.variante} size="sm">{costo.alerta.label}</Badge>}
                    </p>
                </div>
            )}
        </div>
    );
}

function Dato({ titulo, valor, nota, mono }) {
    return (
        <div className="min-w-0">
            <p className="text-caption font-black text-content-3 uppercase tracking-widest">{titulo}</p>
            <p className={`text-content truncate ${mono ? 'font-mono text-micro' : 'text-body font-bold'}`}>
                {valor ?? '—'}
            </p>
            {nota && <p className="text-caption text-content-3 truncate">{nota}</p>}
        </div>
    );
}

/* ─── Todo lo que hay por confirmar, en una sola lista ─────────────────────── */
//
// La otra pestaña se recorre documento por documento, que es lo correcto para
// cargar una factura pero pésimo para sembrar el diccionario: la misma pregunta
// —«¿qué producto es el código 21AG de GAMMA?»— vuelve a aparecer en cada
// factura de ese proveedor. Acá la pregunta aparece **una vez**, con cuánto
// destraba, y la respuesta vale para todas.
//
// Por eso la lista se ordena por peso y no por fecha: responder las primeras
// diez resuelve muchísimos más renglones que responder diez cualesquiera.
