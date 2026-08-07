import React, { useState, useEffect, useMemo } from 'react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { ClipboardCheck, X, Check, Building2, FlaskConical, ShieldAlert, ListChecks, Search, Repeat, Loader2, Layers, Hash, Printer, Radio } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { fetchLaboratoriosBasic } from '../../data/laboratorios';
import { searchActiveProductsForConteo, fetchBranchIdsConInventario } from '../../data/conteoInventario';
import SegmentedControl from '../common/SegmentedControl';
import PortalInput from '../common/PortalInput';
import Notice from '../common/Notice';
import { mensajeAmigable } from '../../utils/errorMessages';

// Etiquetas de UNA línea: en `layout="block"` la píldora es de alto fijo (h-11),
// así que un label que envuelve no crece — se desborda. Van en text-caption
// uppercase con tracking-widest, que ensancha mucho: lo que en prosa parece
// corto acá ocupa el doble. El paréntesis explicativo se movió al aviso.
const SCOPE_OPTIONS = [
    { value: 'CICLICO', label: 'Cíclico del mes', icon: Repeat },
    { value: 'TOTAL', label: 'Todo el inventario', icon: ListChecks },
    { value: 'LABORATORIO', label: 'Por laboratorio', icon: FlaskConical },
    { value: 'BAJO_RECETA', label: 'Bajo Receta', icon: ShieldAlert },
    { value: 'MANUAL', label: 'Selección manual', icon: Search },
];

// El detalle del renglón es un eje APARTE del alcance: se puede querer un
// cíclico sencillo o un total por lote. Por eso son dos controles y no siete
// opciones de alcance — mezclarlos obligaría a inventar "Total sencillo",
// "Cíclico sencillo", etc., que es la misma decisión escrita dos veces.
const MODO_OPTIONS = [
    { value: 'LOTE', label: 'Por lote y vencimiento', icon: Layers },
    { value: 'SIMPLE', label: 'Solo cantidades', icon: Hash },
];

// Y un tercer eje: contra QUÉ existencia se compara lo que se cuenta. Hasta
// ahora había uno solo —el de la existencia del momento— y no se decía en
// ninguna parte, así que una venta hecha entre imprimir la hoja y teclearla
// aparecía como diferencia de anaquel.
const FUENTE_OPTIONS = [
    { value: 'HOJA', label: 'Según la hoja', icon: Printer },
    { value: 'VIVO', label: 'En vivo', icon: Radio },
];

const TAMANO_DEFAULT = 200;

// El reparto lo decide el servidor; acá solo se explica, para que quien arma el
// conteo sepa qué está pidiendo antes de pedirlo.
const SEGMENTO_LABEL = {
    BAJO_RECETA: 'Bajo Receta',
    A: 'Clase A',
    B: 'Clase B',
    C: 'Clase C / sin clasificar',
};
// El servidor devuelve un objeto JSON y su orden de claves es arbitrario — salía
// "B, C, Bajo Receta, A". Se muestran en el orden en que se sortean.
const SEGMENTO_ORDEN = ['BAJO_RECETA', 'A', 'B', 'C'];

const islandClass = "bg-surface-card rounded-3xl p-4 md:p-5 border border-border-card shadow-[var(--shadow-glass-3)]";
const fieldLabel = "text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between";
const reqBadge = <Badge variant="danger" uppercase={false}>Requerido</Badge>;

const AREA_TYPE_LABEL = { FARMACIA: 'Farmacias', BODEGA: 'Bodega', ADMINISTRATIVA: 'Administración', EXTERNA: 'Personal Externo' };
const TYPE_ORDER = ['FARMACIA', 'BODEGA', 'ADMINISTRATIVA', 'EXTERNA'];
// `conInventario` = ids mapeados al ERP. Mientras no hayan cargado se muestran
// todas: es preferible a que la lista aparezca vacía por un instante.
const buildBranchOpts = (branches, conInventario) => TYPE_ORDER.flatMap((type) => {
    const group = (branches || []).filter((b) => (b.type || 'FARMACIA') === type
        && (!conInventario || conInventario.has(String(b.id))));
    if (!group.length) return [];
    return [
        { value: `__header_${type}`, label: AREA_TYPE_LABEL[type], isSeparator: true },
        ...group.map((b) => ({ value: String(b.id), label: b.name })),
    ];
});

export default function NuevoConteoModal({ isOpen, onClose, onCreated }) {
    const { showToast } = useToastStore();
    const { user, hasPermission, getScope } = useAuth();
    const branches = useStaffStore((s) => s.branches);
    const crearConteoInventario = useStaffStore((s) => s.crearConteoInventario);
    const previewMuestraCiclica = useStaffStore((s) => s.previewMuestraCiclica);

    const isBranchScoped = getScope('conteo_inventario') === 'BRANCH';

    const [branchId, setBranchId] = useState('');
    const [scopeType, setScopeType] = useState('TOTAL');
    const [modo, setModo] = useState('LOTE');
    const [fuenteSistema, setFuenteSistema] = useState('HOJA');
    const [laboratorioId, setLaboratorioId] = useState('');
    const [laboratorios, setLaboratorios] = useState([]);
    const [manualResults, setManualResults] = useState([]);
    const [manualSelected, setManualSelected] = useState([]);
    const [saving, setSaving] = useState(false);
    const [tamano, setTamano] = useState(String(TAMANO_DEFAULT));
    const [preview, setPreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [branchIdsConInv, setBranchIdsConInv] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        setBranchId(isBranchScoped ? String(user?.branchId || '') : '');
        setScopeType('CICLICO');
        setModo('LOTE');
        setFuenteSistema('HOJA');
        setLaboratorioId('');
        setManualResults([]);
        setManualSelected([]);
        setTamano(String(TAMANO_DEFAULT));
        setPreview(null);
    }, [isOpen, isBranchScoped, user?.branchId]);

    // La muestra se sortea en el servidor; esta llamada solo la muestra. Cada
    // sorteo es distinto (prioriza lo más viejo y desempata al azar), así que la
    // vista previa es indicativa de la COMPOSICIÓN, no de los productos exactos.
    const tamanoNum = parseInt(tamano, 10);
    useEffect(() => {
        if (!isOpen || scopeType !== 'CICLICO' || !branchId) { setPreview(null); return; }
        if (!Number.isInteger(tamanoNum) || tamanoNum < 1) { setPreview(null); return; }
        let cancelado = false;
        setPreviewLoading(true);
        previewMuestraCiclica(parseInt(branchId, 10), tamanoNum)
            .then((data) => { if (!cancelado) setPreview(data); })
            .catch((err) => { if (!cancelado) { console.error('preview muestra ciclica:', err.message); setPreview(null); } })
            .finally(() => { if (!cancelado) setPreviewLoading(false); });
        return () => { cancelado = true; };
    }, [isOpen, scopeType, branchId, tamanoNum, previewMuestraCiclica]);

    useEffect(() => {
        if (!isOpen || scopeType !== 'LABORATORIO') return;
        fetchLaboratoriosBasic().then(({ data, error }) => {
            if (error) console.error('NuevoConteoModal: fetch laboratorios failed:', error.message);
            setLaboratorios(data || []);
        });
    }, [isOpen, scopeType]);

    // Una sola vez al abrir: son 7 filas y no cambian entre aperturas.
    useEffect(() => {
        if (!isOpen || branchIdsConInv) return;
        fetchBranchIdsConInventario().then(({ data, error }) => {
            if (error) { console.error('NuevoConteoModal: erp_sucursal_map failed:', error.message); return; }
            setBranchIdsConInv(new Set((data || []).map((r) => String(r.branch_id))));
        });
    }, [isOpen, branchIdsConInv]);

    const branchOpts = useMemo(() => buildBranchOpts(branches, branchIdsConInv), [branches, branchIdsConInv]);
    const laboratorioOpts = laboratorios.map((l) => ({ value: String(l.id), label: l.nombre }));

    const handleManualSearch = async (q) => {
        if (!q || q.trim().length < 2) { setManualResults([]); return; }
        const { data, error } = await searchActiveProductsForConteo(q.trim());
        if (error) console.error('NuevoConteoModal: search products failed:', error.message);
        setManualResults((data || []).filter((p) => !manualSelected.some((s) => s.id === p.id)));
    };

    const canEdit = hasPermission('conteo_inventario', 'can_edit');
    const institucionMissing = scopeType === 'LABORATORIO' && !laboratorioId;
    const manualMissing = scopeType === 'MANUAL' && manualSelected.length === 0;
    const tamanoMissing = scopeType === 'CICLICO' && (!Number.isInteger(tamanoNum) || tamanoNum < 1);
    const isValid = branchId && scopeType && !institucionMissing && !manualMissing && !tamanoMissing;

    const handleCreate = async () => {
        if (!isValid) return;
        setSaving(true);
        try {
            const conteoId = await crearConteoInventario({
                branchId: parseInt(branchId, 10),
                scopeType,
                scopeFilter: scopeType === 'LABORATORIO' ? { laboratorio_id: parseInt(laboratorioId, 10) }
                    : scopeType === 'CICLICO' ? { tamano: tamanoNum }
                        : null,
                erpProductIds: scopeType === 'MANUAL' ? manualSelected.map((p) => p.id) : null,
                modo,
                fuenteSistema,
            });
            showToast('Conteo iniciado', 'Se generó el snapshot de inventario', 'success');
            onCreated?.(conteoId);
            onClose();
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;
    // §1.5 · sin vidrio propio: es un portaícono dentro de una superficie que ya
    // es vidrio (misma constante que en PracticanteModal — están duplicadas).
    const squircleClass = "w-12 h-12 flex items-center justify-center rounded-2xl shrink-0 border border-border-card shadow-[var(--shadow-elevation-sm)] bg-surface-card";

    return (
        <LiquidModal open={isOpen} onClose={onClose} maxWidth="max-w-2xl" className="max-h-[90vh] h-fit" ariaLabel="Nuevo Conteo de Inventario">
            <div className="flex-none bg-transparent px-6 md:px-10 py-6 border-b border-border-card flex items-center justify-between relative z-base shrink-0">
                <div className="flex items-center gap-4">
                    <div className={`${squircleClass} text-chart-9-text`}><ClipboardCheck size={22} strokeWidth={2.5} /></div>
                    <div>
                        <h3 className="font-black text-content uppercase tracking-tighter text-lg md:text-xl leading-none mb-1">Nuevo Conteo de Inventario</h3>
                        <p className="text-caption md:text-label font-bold text-content-3 uppercase tracking-[0.2em]">Auditoría Física</p>
                    </div>
                </div>
                <Button variant="ghost" icon={X} iconOnly onClick={onClose} />
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide relative z-base w-full">
                <div className="flex flex-col min-h-full w-full px-6 md:px-10 py-6 gap-4">
                    <div className={islandClass}>
                        <label className={fieldLabel}><span>Sucursal</span>{!branchId && reqBadge}</label>
                        <LiquidSelect invalid={!branchId} value={branchId} onChange={setBranchId} options={branchOpts} placeholder="Seleccionar sucursal..." icon={Building2} clearable={false} disabled={isBranchScoped} />

                        {/* Sin wrapper de grilla: SegmentedControl en `layout="block"`
                            YA arma su propia grilla. Envolverlo en un
                            `md:grid-cols-2` lo metía en media pantalla, y adentro
                            él partía esa mitad en dos — cada píldora terminaba con
                            un cuarto del ancho del modal y el texto en tres líneas. */}
                        <label className={`${fieldLabel} mt-4`}>Alcance del conteo</label>
                        <SegmentedControl
                            layout="block" columns={2} tone="chart-9"
                            options={SCOPE_OPTIONS.map(opt => ({ value: opt.value, label: opt.label, icon: opt.icon }))}
                            value={scopeType} onChange={setScopeType} label="Alcance del conteo" />

                        {scopeType === 'CICLICO' && (
                            <div className="mt-4 flex flex-col gap-3">
                                {/* Cantidad y su unidad en una fila: el label solo
                                    ocupaba un renglón entero para acompañar a un
                                    campo de tres dígitos. */}
                                <div className="flex items-end gap-3">
                                    <div className="w-28 shrink-0">
                                        <label className={fieldLabel}><span>Cantidad</span>{tamanoMissing && reqBadge}</label>
                                        <PortalInput
                                            aria-label="Cantidad de productos de la muestra"
                                            type="number"
                                            min="1"
                                            step="1"
                                            value={tamano}
                                            onChange={(e) => setTamano(e.target.value)}
                                            inputClassName="text-body-xl"
                                        />
                                    </div>
                                    <p className="text-label text-content-3 pb-2.5 leading-snug">
                                        productos al mes, por sucursal
                                    </p>
                                </div>

                                {/* El aviso decía la regla, el desempate, el caso sin
                                    ABC y el porqué — cuatro renglones en negrita que
                                    nadie lee. Queda la regla; la letra chica va abajo
                                    en tono normal, que es lo que la hace legible. */}
                                <Notice variant="info" icon={Repeat}>
                                    Entran <strong>todos</strong> los Bajo Receta. El resto se sortea 60% clase A · 25% B · 15% C.
                                </Notice>
                                <p className="text-caption text-content-3 leading-snug -mt-1">
                                    Elige primero lo que lleva más tiempo sin contarse y desempata al azar, así nada queda sin
                                    contarse nunca y nadie puede predecir qué cae. Una sucursal sin clasificación ABC publicada
                                    rota por antigüedad.
                                </p>

                                {/* El mismo recuadro mientras carga y ya cargado: el
                                    sorteo tarda ~5s contra prod, y una línea suelta
                                    que después se convierte en una caja hace saltar
                                    todo el modal. */}
                                {previewLoading ? (
                                    // Texto y no SkeletonText: medido en este modal, las
                                    // barras del skeleton no contrastan contra
                                    // `surface-card-hover` y la caja se lee VACÍA los ~5s
                                    // que tarda el sorteo — peor que no poner nada.
                                    <div className="rounded-2xl bg-surface-card-hover border border-border-card p-3">
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-2">Vista previa de la muestra</p>
                                        <p className="text-label text-content-2 flex items-center gap-2">
                                            <Loader2 size={13} className="animate-spin shrink-0" />
                                            Sorteando la muestra de esta sucursal…
                                        </p>
                                    </div>
                                ) : preview?.muestra ? (
                                    // Recuadro liviano, no `islandClass`: esto vive DENTRO
                                    // de una isla y anidar dos daba doble borde y doble radio.
                                    <div className="rounded-2xl bg-surface-card-hover border border-border-card p-3">
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-2">Vista previa de la muestra</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {SEGMENTO_ORDEN.filter((seg) => preview.muestra[seg] != null).map((seg) => (
                                                <Badge key={seg} variant={seg === 'BAJO_RECETA' ? 'danger' : 'chart-9'} uppercase={false}>
                                                    {SEGMENTO_LABEL[seg]}: {preview.muestra[seg]}
                                                </Badge>
                                            ))}
                                        </div>
                                        {preview.cobertura && (
                                            <p className="text-caption text-content-3 mt-2 leading-snug">
                                                Universo de la sucursal: <strong className="tabular-nums">{preview.cobertura.universo}</strong> productos ·{' '}
                                                <strong className="tabular-nums">{preview.cobertura.nunca_contados}</strong> nunca contados ·{' '}
                                                <strong className="tabular-nums">{preview.cobertura.mas_de_6_meses}</strong> sin contarse hace más de 6 meses.
                                            </p>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        )}

                        {scopeType === 'LABORATORIO' && (
                            <div className="mt-4">
                                <label className={fieldLabel}><span>Laboratorio</span>{institucionMissing && reqBadge}</label>
                                <LiquidSelect invalid={institucionMissing} value={laboratorioId} onChange={setLaboratorioId} options={laboratorioOpts} placeholder="Seleccionar laboratorio..." icon={FlaskConical} clearable={false} />
                            </div>
                        )}

                        {scopeType === 'MANUAL' && (
                            <div className="mt-4">
                                <label className={fieldLabel}><span>Productos a incluir</span>{manualMissing && reqBadge}</label>
                                <LiquidSelect value={null} onChange={(val) => {
                                    const found = manualResults.find((p) => String(p.id) === val);
                                    if (found) { setManualSelected((prev) => [...prev, found]); setManualResults((prev) => prev.filter((p) => p.id !== found.id)); }
                                }} options={manualResults.map((p) => ({ value: String(p.id), label: `${p.nombre}${p.laboratorios?.nombre ? ` · ${p.laboratorios.nombre}` : ''}` }))} placeholder="Buscar producto..." serverSearch onSearchChange={handleManualSearch} icon={Search} />
                                {manualSelected.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {manualSelected.map((p) => (
                                            <span key={p.id} className="flex items-center gap-1 text-caption font-semibold bg-chart-9/10 text-chart-9-text border border-chart-9/30 px-2 py-1 rounded-full">
                                                {p.nombre}
                                                <Button variant="ghost" icon={X} iconOnly onClick={() => setManualSelected((prev) => prev.filter((x) => x.id !== p.id))} />
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Isla propia y no un campo más de la de arriba: el detalle
                        del renglón no depende del alcance ni lo modifica —cada
                        alcance se puede contar de las dos formas—, y metido bajo
                        "Alcance del conteo" se leía como una opción suya. */}
                    <div className={islandClass}>
                        <label className={fieldLabel}>Detalle del conteo</label>
                        <SegmentedControl
                            layout="block" columns={2} tone="chart-9"
                            options={MODO_OPTIONS}
                            value={modo} onChange={setModo} label="Detalle del conteo" />

                        {/* El aviso cambia con la elección en vez de describir las
                            dos: quien ya eligió no necesita leer la que descartó. */}
                        <div className="mt-3">
                            {modo === 'SIMPLE' ? (
                                <Notice variant="info" icon={Hash}>
                                    Se pide <strong>una sola cantidad</strong> por producto y presentación. No hay que anotar
                                    lote ni fecha de vencimiento.
                                </Notice>
                            ) : (
                                <Notice variant="info" icon={Layers}>
                                    Un renglón por <strong>cada lote</strong>, con su fecha de vencimiento — es el detalle que
                                    hace falta para corregir la existencia lote por lote.
                                </Notice>
                            )}
                        </div>
                        <p className="text-caption text-content-3 leading-snug mt-2">
                            {modo === 'SIMPLE'
                                ? 'Un mismo producto sigue separado por presentación cuando cambia el tamaño del empaque (la caja de 10 y la unidad se cuentan aparte, como están en el anaquel). Dos nombres distintos para el mismo empaque van en un solo renglón.'
                                : 'Es la forma más detallada y la que permite ver qué está vencido o por vencer mientras se cuenta. En una sucursal completa son bastantes más renglones que contar.'}
                        </p>
                    </div>

                    {/* Tercera isla, y no un campo de la anterior: el detalle del
                        renglón dice CÓMO se anota y esto contra QUÉ se compara.
                        Son decisiones distintas y cualquier combinación es
                        válida. */}
                    <div className={islandClass}>
                        <label className={fieldLabel}>Tipo de conteo</label>
                        <SegmentedControl
                            layout="block" columns={2} tone="chart-9"
                            options={FUENTE_OPTIONS}
                            value={fuenteSistema} onChange={setFuenteSistema} label="Tipo de conteo" />

                        <div className="mt-3">
                            {fuenteSistema === 'HOJA' ? (
                                <Notice variant="info" icon={Printer}>
                                    La existencia queda <strong>como salió impresa</strong>. Lo que se cuenta en el papel
                                    y lo que califica la diferencia son el mismo número.
                                </Notice>
                            ) : (
                                <Notice variant="warning" icon={Radio}>
                                    La existencia <strong>se sigue actualizando</strong>: cada renglón se compara contra
                                    la que haya en el momento de teclearlo.
                                </Notice>
                            )}
                        </div>
                        <p className="text-caption text-content-3 leading-snug mt-2">
                            {fuenteSistema === 'HOJA'
                                ? 'Lo que se venda mientras se cuenta no aparece como faltante. Es lo que hay que elegir cuando se cuenta con hoja impresa: la hoja se imprime una vez y se llena después.'
                                : 'Sirve para contar con la sucursal abierta y vendiendo, tecleando en el momento. Contra una hoja impresa hace ruido: cada venta hecha entre imprimirla y teclearla sale como diferencia.'}
                        </p>
                    </div>
                </div>
            </div>

            <LiquidModal.Footer>
                <Button variant="secondary" size="lg" disabled={saving} onClick={onClose}>Cancelar</Button>
                <Button size="lg" onClick={handleCreate} icon={Check}
                    disabled={saving || !isValid || !canEdit} loading={saving}>
                    {saving ? 'Generando snapshot…' : 'Iniciar Conteo'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
