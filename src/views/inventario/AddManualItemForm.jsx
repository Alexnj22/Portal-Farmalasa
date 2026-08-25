import React, { useCallback, useState, lazy, Suspense } from 'react';
import { Plus, X, PackagePlus, ScanLine, Camera, Search, Check, Loader2, AlertTriangle } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import useCapturaDeCarne from '../../hooks/useCapturaDeCarne';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { Campo, CajaFecha } from './camposDeConteo';
import {
    searchActiveProductsForConteo, fetchProductPresentacionesForConteo,
    fetchErpSucursalIdsForBranch, fetchInventoryLotesForProduct,
} from '../../data/conteoInventario';

// Mismo motivo que en la vista: `@zxing` sólo hace falta al tocar «Escanear», y
// este formulario ya viaja diferido. Estático lo volvería a meter en el paquete
// de una pantalla que se abre de pie frente a un anaquel.
const LectorDeCodigo = lazy(() => import('../../components/common/LectorDeCodigo'));

/**
 * Alta manual de un producto (o de un lote) dentro de un conteo en curso.
 *
 * Sale de `ConteoDetailView` el 2026-08-23 por peso, no por orden: son líneas
 * que sólo existen cuando alguien toca «Agregar», y viajaban en el paquete de
 * una pantalla que se abre de pie frente a un anaquel. El `bundle-gate` lo vio.
 *
 * Se carga con `lazy` + `Suspense` y montado SÓLO mientras está abierto: si se
 * montara siempre, `lazy` bajaría su trozo al entrar y no habría diferido nada.
 *
 * ── Rehecho el 2026-08-25, sobre el pedido del usuario ────────────────────
 * «que se pueda escanear el código ahí también, sea con lector / cámara, y que
 * sea más amigable». Tres cosas cambiaron, y las tres tienen su motivo:
 *
 * 1. **Se llega al producto por el código, no sólo por el nombre.** Quien está
 *    de pie frente al anaquel tiene la caja en la mano: leerle el código es un
 *    gesto, y escribir «acetaminofén 500 mg tabletas» son doce teclas y una
 *    duda de ortografía. El buscador YA miraba `codigo_barras` —lo hace
 *    `filtroProductoOCodigo`—, así que lo que faltaba no era la consulta: era
 *    la forma de meter el código sin teclearlo.
 *
 *    Los DOS caminos, porque las salas no tienen el mismo equipo: la cámara
 *    (`LectorDeCodigo`, el mismo canónico del buscador de la vista) y el lector
 *    físico, que teclea. El lector no necesita que nadie apriete nada — está
 *    armado mientras el formulario esté abierto.
 *
 * 2. **El paso 2 no se dibuja hasta que hay producto.** Antes los cuatro campos
 *    estaban siempre, deshabilitados, con «Elige un producto primero» adentro:
 *    cuatro controles muertos ocupando la mitad del formulario. Ahora el
 *    formulario tiene el tamaño del trabajo que queda.
 *
 * 3. **El producto elegido se VE.** Un `LiquidSelect` con un valor puesto es
 *    una línea de texto que se corta; acá es una tarjeta con el nombre, el
 *    laboratorio y el código —que es justamente lo que hay que poder comparar
 *    contra la caja que se tiene en la mano cuando el escaneo eligió solo—.
 *
 * ── Por qué el lector físico se acepta aunque «no pruebe presencia» ───────
 * `useCapturaDeCarne` nació para el carné, donde un código tecleado no vale:
 * ahí el código ES la credencial. Un código de barras de producto no prueba
 * nada de nadie, así que la reja no protege nada y sólo estorbaría. Va con
 * `aceptarTecleado: false` igual, pero por otro motivo: es lo que impide que
 * escribir «acetaminofen» en el buscador de al lado se lea como un escaneo.
 * Y con `sinEnter: true`, porque hay lectores sin sufijo Enter — lo aprendimos
 * con el ticket de traslado el 2026-08-24.
 */

/** Qué se le muestra a alguien que acaba de pasar un código y no salió nada. */
const SIN_RESULTADO = 'sin-resultado';
const VARIOS = 'varios';
const FALLO = 'fallo';

export default function AddManualItemForm({ branchId, onAdd, onCancel, simple = false }) {
    const { showToast } = useToastStore();
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [presentacionOpts, setPresentacionOpts] = useState([]);
    const [presentacion, setPresentacion] = useState('');
    const [loteOpts, setLoteOpts] = useState([]);
    const [lote, setLote] = useState('');
    const [loteOtro, setLoteOtro] = useState('');
    const [fechaVencimiento, setFechaVencimiento] = useState('');
    const [saving, setSaving] = useState(false);
    const [camaraAbierta, setCamaraAbierta] = useState(false);
    // Qué pasó con el último código leído. Es estado y no un toast porque el
    // aviso tiene que quedarse a la vista mientras se decide qué hacer: un
    // toast se va solo a los pocos segundos y quien está contando estaba
    // mirando el anaquel, no la pantalla.
    const [avisoDeCodigo, setAvisoDeCodigo] = useState(null);
    const [buscandoCodigo, setBuscandoCodigo] = useState(false);

    // Antes se filtraban los productos ya presentes en el conteo, lo que hacía
    // imposible el caso más común de una farmacia: el snapshot trae el lote A y
    // en el anaquel aparece también el B. El duplicado real es
    // (producto, presentación, lote), y ahora lo rechaza agregar_item_conteo.
    const handleSearch = async (q) => {
        if (!q || q.trim().length < 2) { setResults([]); return; }
        const { data, error } = await searchActiveProductsForConteo(q.trim());
        if (error) console.error('handleSearch: product search failed:', error.message);
        setResults(data || []);
    };

    // Elegir un producto y traer con qué se cuenta. Recibe la FILA y no un id:
    // el escaneo llega con el producto ya resuelto y no tiene por qué existir en
    // `results` —su búsqueda es otra—, así que buscarlo ahí lo dejaría sin
    // seleccionar sin lanzar ningún error.
    const seleccionarProducto = useCallback(async (found) => {
        setSelected(found);
        setPresentacion('');
        setLote('');
        setLoteOtro('');
        setFechaVencimiento('');
        setPresentacionOpts([]);
        setLoteOpts([]);
        if (!found) return;

        const [{ data: precios, error: preciosErr }, { data: erpMap, error: erpMapErr }] = await Promise.all([
            fetchProductPresentacionesForConteo(found.id),
            fetchErpSucursalIdsForBranch(branchId),
        ]);
        if (preciosErr) console.error('seleccionarProducto: fetch product_precios failed:', preciosErr.message);
        if (erpMapErr) console.error('seleccionarProducto: fetch erp_sucursal_map failed:', erpMapErr.message);
        const tipos = [...new Set((precios || []).map((p) => p.presentaciones?.tipo).filter(Boolean))];
        setPresentacionOpts(tipos.map((t) => ({ value: t, label: t })));

        // Los lotes solo se piden si el conteo los lleva: en sencillo esta
        // consulta no alimentaría ningún campo.
        const erpIds = (erpMap || []).map((m) => m.erp_sucursal_id);
        if (erpIds.length && !simple) {
            const { data: lotes, error: lotesErr } = await fetchInventoryLotesForProduct(found.id, erpIds);
            if (lotesErr) console.error('seleccionarProducto: fetch lotes failed:', lotesErr.message);
            const seen = new Map();
            (lotes || []).forEach((l) => { if (!seen.has(l.lote)) seen.set(l.lote, l.fecha_vencimiento); });
            setLoteOpts(Array.from(seen.entries()).map(([value, fecha]) => ({ value, fecha })));
        }
    }, [branchId, simple]);

    const handleSelectProduct = (val) => {
        setAvisoDeCodigo(null);
        seleccionarProducto(results.find((p) => String(p.id) === val) || null);
    };

    /**
     * Un código leído —por la cámara o por el lector— se resuelve a UN producto.
     *
     * Se elige solo únicamente si la respuesta es una: con varias, elegir por el
     * llamador sería adivinar cuál de dos productos tiene la caja en la mano, y
     * un renglón agregado al producto equivocado no falla ni se nota — queda
     * como una diferencia de inventario que nadie sabe explicar.
     */
    const resolverCodigo = useCallback(async (codigo) => {
        const q = (codigo || '').trim();
        if (q.length < 2) return;
        setBuscandoCodigo(true);
        setAvisoDeCodigo(null);
        try {
            const { data, error } = await searchActiveProductsForConteo(q);
            if (error) throw error;
            const filas = data || [];
            if (filas.length === 1) {
                await seleccionarProducto(filas[0]);
                setResults(filas);
                return;
            }
            // Con varias, el buscador queda cargado con lo que salió: la lista
            // ya está ahí y sólo falta que una persona diga cuál.
            setResults(filas);
            setAvisoDeCodigo({ tipo: filas.length ? VARIOS : SIN_RESULTADO, codigo: q, cuantos: filas.length });
        } catch (err) {
            // Un escaneo que revienta NO puede quedarse mudo: quien lo pasó está
            // mirando el anaquel y sólo vuelve la vista al oír el pitido. Sin
            // esto, un fallo de red se veía idéntico a un código que no existe.
            console.error('resolverCodigo: product search failed:', err?.message || err);
            setAvisoDeCodigo({ tipo: FALLO, codigo: q, detalle: mensajeAmigable(err) });
        } finally {
            setBuscandoCodigo(false);
        }
    }, [seleccionarProducto]);

    // El lector físico está armado mientras el formulario vive. No hay botón que
    // apretar a propósito: un lector se usa apuntando, y obligar a preparar la
    // pantalla antes de cada caja es exactamente el paso que hace que la gente
    // vuelva a teclear.
    const { manual: escaneoTecleado } = useCapturaDeCarne(true, resolverCodigo, { sinEnter: true });

    const handleSelectLote = (val) => {
        setLote(val);
        if (val === '__OTRO__') { setFechaVencimiento(''); return; }
        const match = loteOpts.find((l) => l.value === val);
        setFechaVencimiento(match?.fecha || '');
    };

    const finalLote = lote === '__OTRO__' ? loteOtro.trim() : lote;
    const canSubmit = selected && presentacion && (simple || finalLote);

    // El costo ya no lo manda el cliente: lo pone agregar_item_conteo con el
    // mismo criterio que el snapshot (costo de la presentación de la línea).
    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            await onAdd({
                erpProductId: selected.id,
                presentacion,
                lote: simple ? null : finalLote,
                fechaVencimiento: simple ? null : (fechaVencimiento || null),
            });
            showToast('Producto agregado', selected.nombre, 'success');
        } catch (err) {
            showToast('No se agregó el producto', mensajeAmigable(err), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div data-surface="card" className="border-chart-9/30 bg-chart-9/[0.06] p-4 md:p-5 flex flex-col gap-4">
            {/* ── Encabezado ───────────────────────────────────────────────
                El título decía «Producto no listado en el snapshot». «Snapshot»
                es jerga de la tubería y quien cuenta no tiene por qué saber que
                existe (CLAUDE.md: la pantalla habla del PORTAL). Lo que hace
                falta decir es CUÁNDO se usa esto, que es la duda real de quien
                lo tiene delante. */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                    <span className="shrink-0 mt-0.5 w-9 h-9 rounded-btn bg-chart-9/15 flex items-center justify-center">
                        <PackagePlus size={18} strokeWidth={2.5} className="text-chart-9-text" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-body-sm font-black text-content">Agregar al conteo</p>
                        <p className="text-caption text-content-2">
                            Para lo que apareció en el anaquel y no está en la lista
                            {simple ? '.' : ', o para un lote que no venía.'}
                        </p>
                    </div>
                </div>
                <Button variant="ghost" icon={X} iconOnly aria-label="Cerrar sin agregar" onClick={onCancel} />
            </div>

            {/* ── Paso 1 · qué producto ────────────────────────────────────
                Con el producto ya elegido este bloque se va y deja la tarjeta:
                buscar es el paso terminado, y un buscador que se queda invita a
                volver a tocarlo y perder lo que ya se eligió. */}
            {!selected ? (
                <div className="flex flex-col gap-2">
                    <Paso numero={1} titulo="Busca o escanea el producto" />
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <div className="flex-1 min-w-0">
                            <LiquidSelect
                                value={null}
                                onChange={handleSelectProduct}
                                options={results.map((p) => ({
                                    value: String(p.id),
                                    label: `${p.nombre}${p.laboratorios?.nombre ? ` · ${p.laboratorios.nombre}` : ''}`,
                                }))}
                                placeholder="Nombre o código del producto..."
                                ariaLabel="Buscar el producto por nombre o por código"
                                icon={Search}
                                serverSearch
                                onSearchChange={handleSearch}
                            />
                        </div>
                        {/* La cámara, para el equipo que no tiene lector. `sm:w-auto`
                            y no un ícono suelto: en el teléfono es el camino
                            principal, y un botón de ancho completo con su rótulo
                            es lo que lo dice. */}
                        <Button
                            variant="secondary" icon={Camera}
                            loading={buscandoCodigo}
                            onClick={() => setCamaraAbierta(true)}
                            className="sm:w-auto"
                        >
                            Escanear
                        </Button>
                    </div>

                    {/* Que el lector físico YA está escuchando. Sin decirlo, nadie
                        lo prueba: un lector que funciona y un lector que nadie
                        sabe que funciona se ven igual. */}
                    <p className="text-micro text-content-3 flex items-center gap-1.5 ml-1">
                        {buscandoCodigo
                            ? <><Loader2 size={12} className="animate-spin" /> Buscando el código…</>
                            : <><ScanLine size={12} /> …o pasa el lector por el código de la caja: no hace falta tocar nada.</>}
                    </p>

                    {escaneoTecleado && !buscandoCodigo && (
                        <p className="text-micro text-warning-text ml-1">
                            Eso llegó tecleado, no leído. Escribe el nombre en el buscador o vuelve a pasar el código.
                        </p>
                    )}

                    {avisoDeCodigo?.tipo === SIN_RESULTADO && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            El código <strong className="font-mono">{avisoDeCodigo.codigo}</strong> no
                            está en el catálogo. Búscalo por nombre — y si tampoco aparece, es un producto
                            que todavía no existe en el portal.
                        </Notice>
                    )}
                    {avisoDeCodigo?.tipo === FALLO && (
                        <Notice variant="danger" icon={AlertTriangle}>
                            No se pudo buscar el código <strong className="font-mono">{avisoDeCodigo.codigo}</strong>.
                            {avisoDeCodigo.detalle ? ` ${avisoDeCodigo.detalle}` : ''} Vuelve a pasarlo, o búscalo por nombre.
                        </Notice>
                    )}
                    {avisoDeCodigo?.tipo === VARIOS && (
                        <Notice variant="info" icon={Search}>
                            <strong className="tabular-nums">{avisoDeCodigo.cuantos}</strong> productos
                            coinciden con <strong className="font-mono">{avisoDeCodigo.codigo}</strong>.
                            Elige cuál en la lista de arriba.
                        </Notice>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <Paso numero={1} titulo="Producto" listo />
                    {/* La tarjeta del elegido. Existe para poder COMPARARLA contra
                        la caja que se tiene en la mano: cuando el escaneo eligió
                        solo, ésta es la única oportunidad de ver que eligió bien. */}
                    <div data-surface="card" className="p-3 flex items-center gap-3">
                        <span className="shrink-0 w-8 h-8 rounded-full bg-success/15 flex items-center justify-center">
                            <Check size={16} strokeWidth={3} className="text-success" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-label font-black text-content truncate">{selected.nombre}</p>
                            <p className="text-micro text-content-3 truncate">
                                {selected.laboratorios?.nombre || 'Sin laboratorio'}
                                {selected.codigo_barras ? <> · <span className="font-mono">{selected.codigo_barras}</span></> : null}
                            </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => seleccionarProducto(null)}>Cambiar</Button>
                    </div>
                </div>
            )}

            {/* ── Paso 2 · cómo viene ──────────────────────────────────────
                No se dibuja sin producto. Antes estaban siempre, deshabilitados
                y con «Elige un producto primero» adentro: cuatro controles
                muertos ocupando la mitad del formulario, y ninguno decía nada
                que el paso 1 no dijera ya.

                En un conteo sencillo el renglón se identifica con producto y
                presentación: los otros tres campos no describen nada que ese
                conteo guarde. Las columnas son literales y no calculadas —
                Tailwind escanea el fuente, un `grid-cols-` armado con una variable
                no existiría en el CSS. */}
            {selected && (
                <div className="flex flex-col gap-2">
                    <Paso numero={2} titulo={simple ? 'Cómo viene' : 'Presentación, lote y vencimiento'} />
                    <div className={`grid grid-cols-1 gap-2 ${simple ? 'md:grid-cols-2' : lote === '__OTRO__' ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                        <Campo label="Presentación">
                            <LiquidSelect
                                value={presentacion || null}
                                onChange={setPresentacion}
                                options={presentacionOpts}
                                placeholder={presentacionOpts.length ? 'Presentación...' : 'Este producto no tiene ninguna'}
                                disabled={!presentacionOpts.length}
                                clearable={false}
                                ariaLabel="Presentación"
                            />
                        </Campo>
                        {!simple && (
                            <Campo label="Lote">
                                <LiquidSelect
                                    value={lote || null}
                                    onChange={handleSelectLote}
                                    options={[...loteOpts.map((l) => ({ value: l.value, label: l.value })), { value: '__OTRO__', label: '+ Otro lote (nuevo)' }]}
                                    placeholder="Lote..."
                                    clearable={false}
                                    ariaLabel="Lote"
                                />
                            </Campo>
                        )}
                        {!simple && lote === '__OTRO__' && (
                            <Campo label="Número de lote">
                                <PortalInput
                                    aria-label="Número de lote nuevo"
                                    value={loteOtro}
                                    onChange={(e) => setLoteOtro(e.target.value)}
                                    placeholder="Ej. A-1234"
                                    inputClassName="text-body-xl"
                                />
                            </Campo>
                        )}
                        {/* Un lote que ya existe en el ERP trae su vencimiento: se muestra
                            pero no se edita, porque cambiarlo acá no cambiaría el del ERP.
                            `aria-disabled` + `title` para que no sea solo un gris. */}
                        {!simple && (
                            <Campo label={lote === '__OTRO__' ? 'Vencimiento' : 'Vencimiento (del lote)'}>
                                <CajaFecha
                                    inerte={lote !== '__OTRO__'}
                                    titulo={lote !== '__OTRO__' ? 'El vencimiento lo trae el lote' : undefined}
                                >
                                    <LiquidDatePicker value={fechaVencimiento} onChange={setFechaVencimiento} />
                                </CajaFecha>
                            </Campo>
                        )}
                    </div>
                </div>
            )}

            {/* El botón cierra el formulario, no es uno de sus campos: fila propia,
                a la derecha. Y el ícono va por la prop `icon`, no como hijo — como
                hijo entra al mismo <span> que el texto y el botón se partía en dos
                renglones ("+" arriba, "Agregar al conteo" abajo).

                Qué falta se dice al LADO del botón y no deshabilitándolo a secas:
                un botón gris no explica por qué, y acá hay dos motivos posibles. */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                {selected && !canSubmit && (
                    <span className="text-micro text-content-3 mr-auto">
                        {!presentacion ? 'Falta elegir la presentación.' : 'Falta el lote.'}
                    </span>
                )}
                <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
                <Button tone="chart-9" icon={Plus} loading={saving} disabled={!canSubmit || saving} onClick={handleSubmit}>
                    Agregar al conteo
                </Button>
            </div>

            {/* Sólo se monta al abrirlo: montado siempre, `lazy` bajaría el trozo
                de la cámara al abrir el formulario y no habría diferido nada. */}
            {camaraAbierta && (
                <Suspense fallback={null}>
                    <LectorDeCodigo
                        abierto={camaraAbierta}
                        onCerrar={() => setCamaraAbierta(false)}
                        onLeer={resolverCodigo}
                        titulo="Escanear el producto"
                    />
                </Suspense>
            )}
        </div>
    );
}

/**
 * El rótulo de un paso. Numerado porque el formulario tiene DOS y el segundo
 * sólo aparece cuando el primero está resuelto: sin el número, el segundo bloque
 * parece haber salido de la nada.
 */
function Paso({ numero, titulo, listo = false }) {
    return (
        <div className="flex items-center gap-2">
            <Badge variant={listo ? 'success' : 'neutral'} size="sm">{numero}</Badge>
            <span className="text-micro font-black uppercase tracking-widest text-content-3">{titulo}</span>
        </div>
    );
}
