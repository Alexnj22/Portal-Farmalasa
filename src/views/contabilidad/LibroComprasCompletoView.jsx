import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, AlertTriangle, SearchX, Mail, Percent, Scale, Lock } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { usePestanaEnUrl } from '../../hooks/usePestanaEnUrl';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/formatNumber';
import { formatearNit, formatearNrc } from '../../utils/nitUtils';
import { normalizeText } from '../../utils/helpers';
import { exportCsv } from '../../utils/csvExport';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchLibroComprasCompleto, fetchLibroComprasDeclarable } from '../../data/libroComprasCompleto';

// ─────────────────────────────────────────────────────────────────────────────
// Libro de compras COMPLETO — vista propia, no una pestaña de Libros IVA.
//
// Separada a propósito y por pedido explícito (2026-08-02): el libro de Libros
// IVA sale del ERP y su valor es que se puede cotejar contra el archivo del
// origen —mismo contenido, mismo formato— para confirmar que no sobra ni falta
// nada. Mezclarlos rompería esa prueba.
//
// Éste responde otra pregunta: **qué compró la farmacia de verdad**. Suma a las
// compras del ERP los DTE que llegaron por correo y nunca se registraron como
// compra.
//
// Y hace dos cosas mejor que el ERP, a propósito:
//   · el número de documento va COMPLETO (el ERP lo corta a 20 y así su libro no
//     identifica sus propios documentos);
//   · cada fila dice de dónde salió, para que la diferencia sea auditable.
//
// Lo que las dos primeras pestañas NO hacen: restar las notas de crédito. Eso
// vive en la tercera —«Declarable», agregada el 2026-08-13— y sale de su propia
// consulta, porque la pregunta es otra: no qué se compró, sino qué de eso puede
// reclamarse. Las dos verdades conviven a propósito y su diferencia se mide.
//
// NOTA DE ESTRUCTURA: los componentes se llaman con la MISMA firma que
// `LibrosIvaView`, que es la vista hermana y la que está probada. La primera
// versión inventó props (`FilterBar.Pill`, `searchValue` en GlassViewLayout,
// `TablePagination` sin `totalPages`) y reventó con React #130 al abrirla. Si
// hay que cambiar algo acá, mirar primero cómo lo hace la de al lado.
// ─────────────────────────────────────────────────────────────────────────────

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const mesActual = () => {
    const sv = new Date(Date.now() - 6 * 3600_000);
    return `${sv.getUTCFullYear()}-${String(sv.getUTCMonth() + 1).padStart(2, '0')}`;
};
const etiquetaMes = (mes) => {
    const [y, m] = mes.split('-').map(Number);
    return `${MESES[m - 1]} ${y}`;
};
const rangoDelMes = (mes) => {
    const [y, m] = mes.split('-').map(Number);
    const fin = new Date(y, m, 0).getDate();
    return [`${mes}-01`, `${mes}-${String(fin).padStart(2, '0')}`];
};
const correrMes = (mes, delta) => {
    const [y, m] = mes.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// DD/MM/YYYY. Se parte la cadena en vez de construir un Date: `new Date('2026-06-01')`
// es UTC y en El Salvador (−6) retrocede un día.
const fmtFecha = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
};

// El dinero va SIEMPRE con dos decimales. Sin esto el CSV escribía el número
// crudo de JavaScript: `5` en vez de `5.00`, y en la fila de totales
// `30549.219999999994` — la suma de flotantes asomando en un archivo contable.
const num = (n) => (Number(n) || 0).toFixed(2);
// Vacío ≠ 0.00: NULL significa "no sabemos si hubo percepción", y escribir cero
// sería afirmar que no la hubo. Misma regla que en el libro de compras.
const numOpcional = (n) => (n == null ? '' : num(n));

// Los rótulos hablan del PORTAL: nunca se nombra el sistema de origen ni la
// procedencia del dato (ver CLAUDE.md). Lo que la vista quiere decir no es "de
// dónde vino" sino en qué estado está: la compra quedó registrada, o solo existe
// el documento que emitió el proveedor.
const TABS = [
    { key: 'todos',      label: 'Todos'          },
    { key: 'sin_compra', label: 'Sin registrar'  },
    // «Declarable» es otra PREGUNTA, no otro filtro de la misma lista: las dos
    // primeras dicen qué se compró, ésta dice qué de eso puede reclamarse como
    // crédito fiscal. Sale de su propia consulta porque aplica tres reglas que
    // el libro completo no mira — notas de crédito y débito (Art. 62), la
    // deducibilidad confirmada del proveedor (Art. 65), y que una factura no da
    // crédito por más IVA que traiga.
    { key: 'declarable', label: 'Declarable'     },
];

const COLS = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'origen',    label: 'Registro',   align: 'left'  },
    { key: 'documento', label: 'Documento',  align: 'left'  },
    { key: 'proveedor', label: 'Proveedor',  align: 'left'  },
    // `2xl` y no `lg`/`xl`: a 1440 las nueve columnas piden 1,152px contra los
    // 1,046 del marco y **Total se salía 106px**, cortado a media cifra. NRC y
    // NIT son identificadores del proveedor —contexto— y el total es la fila.
    // Los dos siguen enteros en el detalle y en el CSV.
    { key: 'nrc',       label: 'NRC',        align: 'left',  hideBelow: '2xl' },
    { key: 'nit',       label: 'NIT',        align: 'left',  hideBelow: '2xl' },
    { key: 'gravadas',  label: 'Gravadas',   align: 'right' },
    { key: 'credito',   label: 'Crédito',    align: 'right', hideBelow: 'md' },
    { key: 'total',     label: 'Total',      align: 'right' },
];

// El libro declarable tiene otra forma: no hay sucursal (el libro es por NRC) y
// aparece el TIPO, porque una nota de crédito resta y una factura no da crédito
// — dos cosas que en el libro completo no existían como distinción.
const COLS_DECL = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'  },
    { key: 'tipo',      label: 'Tipo',       align: 'left'  },
    { key: 'documento', label: 'Documento',  align: 'left',  hideBelow: 'lg' },
    { key: 'proveedor', label: 'Proveedor',  align: 'left'  },
    { key: 'gravadas',  label: 'Gravadas',   align: 'right', hideBelow: 'md' },
    { key: 'credito',   label: 'Crédito',    align: 'right' },
    { key: 'total',     label: 'Total',      align: 'right', hideBelow: 'md' },
    // 92px y un rótulo de una palabra. El motivo completo va en el `title` y,
    // agregado, en el aviso de arriba de la tabla: nada se descarta en silencio.
    { key: 'computa',   label: 'Cuenta',     align: 'center', className: 'w-[92px]' },
];

export default function LibroComprasCompletoView({ openModal }) {
    const { getScope, hasPermission } = useAuth();
    // Canon de permisos 2026-08-03.
    const canDownload  = hasPermission('libro_compras_completo_descargar');
    const canVerMontos = hasPermission('libro_compras_completo_ver_montos');
    const branches = useStaffStore((s) => s.branches);

    const [activeTab, setActiveTab]   = usePestanaEnUrl(TABS, 'todos');
    const [mes, setMes]               = useState(mesActual());
    const [filterBranch, setFB]       = useState('');
    const [filas, setFilas]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [error, setError]           = useState('');
    const [busqueda, setBusqueda]     = useState('');
    const [pagina, setPagina]         = useState(1);
    const [tamPagina, setTamPagina]   = useState(50);

    // El declarable sale de OTRA consulta, así que vive en su propio estado. No
    // se deriva del completo filtrando: aquél no trae notas de crédito ni de
    // débito, así que no hay nada que filtrar — habría que inventarlo.
    const esDecl = activeTab === 'declarable';

    const cargar = useCallback(async () => {
        setLoading(true);
        setError('');
        const [desde, hasta] = rangoDelMes(mes);
        try {
            const data = esDecl
                ? await fetchLibroComprasDeclarable(desde, hasta)
                : await fetchLibroComprasCompleto(desde, hasta, filterBranch);
            // `fetchAllRows` devuelve null si el PRIMER trozo falló. Tratarlo como
            // lista vacía convertiría una consulta rota en "no hay compras", que es
            // exactamente cómo un error vive semanas sin que nadie lo note.
            if (data === null) throw new Error('No se pudo leer el libro.');
            setFilas(data);
        } catch (e) {
            setError(mensajeAmigable(e, esDecl
                ? 'No se pudo cargar el libro declarable'
                : 'No se pudo cargar el libro de compras completo'));
            setFilas([]);
        } finally {
            setLoading(false);
        }
    }, [mes, filterBranch, esDecl]);

    useEffect(() => { cargar(); }, [cargar]);

    // Abrir el documento desde la fila, con el MISMO visor que Facturas de
    // compra (`viewPurchaseDte`) — no una vista nueva: el que existe ya sabe
    // leer el JSON del DTE, mostrar el PDF y armar el ZIP.
    //
    // Sólo cuando hay documento. Medido en julio 2026: de 467 compras
    // registradas, 87 no tienen DTE —el sistema registró la compra y el
    // documento nunca llegó por correo—, y esas filas quedan quietas. Un clic
    // que no abre nada es peor que una fila que no invita a hacer clic.
    const abrirDocumento = useCallback((r) => {
        if (!r?.json_path) return;
        openModal?.('viewPurchaseDte', {
            document: {
                id: r.dte_id,
                json_path: r.json_path,
                pdf_path: r.pdf_path,
                tipo_dte: r.tipo_dte,
                numero_control: r.numero_control,
                codigo_generacion: r.documento_completo,
                // El visor busca `supplier_nombre || emisor_nombre`; el libro
                // ya trae el nombre resuelto en `proveedor`.
                emisor_nombre: r.proveedor,
                invalidado: false,
            },
        });
        useStaffStore.getState().appendAuditLog('LIBRO_COMPRAS_VER_DOCUMENTO', String(r.dte_id ?? ''), {
            documento: r.documento_completo, tipo: r.documento_tipo,
        });
    }, [openModal]);

    const nombreSucursal = useCallback(
        (id) => branches.find(b => b.id === id)?.name ?? (id ? `Suc. ${id}` : 'Sin sucursal'),
        [branches]);

    const delTab = useMemo(
        () => (activeTab === 'sin_compra' ? filas.filter(r => r.origen !== 'registrada') : filas),
        [filas, activeTab]);

    // Totales del declarable. `credito_fiscal` ya viene con su signo del
    // servidor —la nota de crédito llega en negativo— así que sumar alcanza.
    // `trabado` es el que acciona: lo que se destrabaría al confirmar la
    // clasificación de esos proveedores.
    const totDecl = useMemo(() => {
        const acc = { docs: 0, credito: 0, sinCuenta: 0, trabado: 0, motivos: new Map(),
                      repRenglones: 0, repDocs: 0, repCredito: 0 };
        if (!esDecl) return acc;
        for (const r of filas) {
            acc.docs++;
            acc.credito += Number(r.credito_fiscal || 0);

            // ── El documento que entró dos veces ──────────────────────────
            // El servidor ya contó cuántos renglones del libro son el MISMO
            // documento fiscal (`veces_en_el_libro`); acá sólo se agrega.
            //
            // Se reparte cada renglón entre sus copias en vez de agruparlos a
            // mano: `1/veces` suma exactamente 1 por documento y
            // `credito × (veces−1)/veces` da el crédito que sobra —exacto
            // cuando las copias son idénticas, que es el caso real—. Agrupar
            // por número de documento del lado del cliente no serviría: cuando
            // el documento no se pudo identificar, dos copias pueden llegar con
            // números distintos y quedarían sin agrupar.
            const veces = Number(r.veces_en_el_libro || 1);
            if (veces > 1) {
                acc.repRenglones++;
                acc.repDocs    += 1 / veces;
                acc.repCredito += Number(r.credito_fiscal || 0) * (veces - 1) / veces;
            }

            if (r.computa_credito) continue;
            acc.sinCuenta++;
            acc.motivos.set(r.motivo, (acc.motivos.get(r.motivo) || 0) + 1);
            // El IVA que NO se contó: el servidor lo puso en cero, así que se
            // estima desde el total. Es una referencia de cuánto está en juego,
            // no una cifra para declarar — por eso el rótulo dice «aprox.».
            if (String(r.motivo || '').startsWith('Falta confirmar')) {
                const t = Math.abs(Number(r.total || 0));
                acc.trabado += t - t / 1.13;
            }
        }
        return acc;
    }, [filas, esDecl]);

    const filasVistas = useMemo(() => {
        const q = normalizeText(busqueda.trim());
        if (!q) return delTab;
        return delTab.filter(r =>
            normalizeText(r.proveedor || '').includes(q) ||
            normalizeText(r.documento_completo || '').includes(q) ||
            normalizeText(r.nit || '').includes(q) ||
            // «Repetido» se busca porque se ve: es el rótulo que la fila lleva
            // puesto, y el aviso de arriba manda a buscarlo. Sin esto, dar con
            // 2 renglones entre 300 sería pasar el ojo por la tabla entera.
            (q.length >= 3 && Number(r.veces_en_el_libro || 1) > 1 && 'repetido'.includes(q)));
    }, [delTab, busqueda]);

    const totales = useMemo(() => {
        const acc = { docs: 0, credito: 0, total: 0, sinCompra: 0, creditoSinCompra: 0 };
        for (const r of filas) {
            acc.docs++;
            acc.credito += Number(r.credito_fiscal || 0);
            acc.total   += Number(r.total || 0);
            if (r.origen !== 'registrada') {
                acc.sinCompra++;
                acc.creditoSinCompra += Number(r.credito_fiscal || 0);
            }
        }
        return acc;
    }, [filas]);

    const totalPaginas = Math.max(1, Math.ceil(filasVistas.length / tamPagina));
    const paginadas = useMemo(() => {
        const ini = (pagina - 1) * tamPagina;
        return filasVistas.slice(ini, ini + tamPagina);
    }, [filasVistas, pagina, tamPagina]);

    useEffect(() => { setPagina(1); }, [busqueda, activeTab, mes, filterBranch]);

    const exportar = useCallback(() => {
        const [desde] = rangoDelMes(mes);

        // El declarable exporta SUS columnas, no las del completo. Reusar las
        // otras dejaría afuera el motivo —lo único que explica por qué una fila
        // suma cero— y escribiría una sucursal que este libro no tiene.
        if (esDecl) {
            exportCsv(
                // «REPETIDO» viaja al CSV: quien arma la declaración trabaja
                // sobre el archivo, no sobre la pantalla, y ahí el aviso rojo no
                // existe. Una columna vacía en 300 filas y un «SI ×2» en dos es
                // exactamente lo que hay que ver antes de presentar.
                ['FECHA', 'TIPO', 'DOCUMENTO', 'NRC', 'NIT', 'PROVEEDOR',
                 'GRAVADAS', 'CREDITO FISCAL', 'TOTAL', 'CUENTA', 'REPETIDO',
                 'MOTIVO', 'CLASIFICACION'],
                [
                    ...filas.map(r => [
                        fmtFecha(r.fecha), r.documento_tipo || '', r.documento_completo || '',
                        r.nrc || '', r.nit || '', r.proveedor || '',
                        num(r.compras_gravadas), num(r.credito_fiscal), num(r.total),
                        r.computa_credito ? 'SI' : 'NO',
                        Number(r.veces_en_el_libro || 1) > 1 ? `SI x${r.veces_en_el_libro}` : '',
                        r.motivo || '', r.clasificacion || '',
                    ]),
                    ['TOTALES', '', '', '', '', '', '',
                     num(totDecl.credito), '', '', '', '', ''],
                ],
                `libro-compras-declarable_${desde.slice(0, 7)}.csv`,
            );
            useStaffStore.getState().appendAuditLog('LIBRO_COMPRAS_DECLARABLE_EXPORT', mes, {
                documentos: totDecl.docs, credito_fiscal: totDecl.credito,
                sin_contar: totDecl.sinCuenta,
                documentos_repetidos: Math.round(totDecl.repDocs),
                credito_repetido: totDecl.repCredito,
            });
            return;
        }

        // El orden es `(headers, rows, filename)`. Estaba llamado
        // `(filename, headers, rows)`, así que `buildCsvText` recibía el nombre
        // del archivo como fila de encabezado y hacía `"…".map(...)` sobre una
        // cadena: TypeError antes de generar un solo byte. El botón no daba
        // ningún aviso — el error moría en la consola y no pasaba nada.
        exportCsv(
            ['FECHA', 'REGISTRO', 'SUCURSAL', 'TIPO', 'DOCUMENTO', 'NRC', 'NIT', 'PROVEEDOR',
             'EXENTAS', 'GRAVADAS', 'CREDITO FISCAL', 'TOTAL', 'PERCEPCION', 'RETENCION', 'ANULADA'],
            [
                ...filas.map(r => [
                    fmtFecha(r.fecha),
                    r.origen === 'registrada' ? 'Registrada' : 'Sin registrar',
                    nombreSucursal(r.branch_id),
                    r.documento_tipo || '',
                    // El COMPLETO, no el cortado a 20 del ERP: es justamente lo
                    // que este libro hace mejor que su origen.
                    r.documento_completo || '',
                    r.nrc || '', r.nit || '', r.proveedor || '',
                    num(r.compras_exentas), num(r.compras_gravadas),
                    num(r.credito_fiscal), num(r.total),
                    numOpcional(r.percepcion_iva),
                    numOpcional(r.retencion_iva),
                    r.anulada ? 'SI' : '',
                ]),
                ['TOTALES', '', '', '', '', '', '', '', '', '',
                 num(totales.credito), num(totales.total), '', '', ''],
            ],
            // Con la extensión: sin ella el navegador guarda un archivo sin tipo
            // y Excel no lo abre con doble click.
            `libro-compras-completo_${desde.slice(0, 7)}.csv`,
        );
        useStaffStore.getState().appendAuditLog('LIBRO_COMPRAS_COMPLETO_EXPORT', mes, {
            documentos: totales.docs, credito_fiscal: totales.credito,
            sin_registrar: totales.sinCompra,
        });
    }, [filas, mes, totales, nombreSucursal, esDecl, totDecl]);

    const branchOptions = useMemo(
        () => branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);
    const puedeElegirSucursal = getScope('libro_compras_completo') !== 'BRANCH';

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar proveedor, documento o NIT…"
        />
    );

    const barraFiltros = (
        <FilterBar
            onClear={() => { setFB(''); setMes(mesActual()); }}
            activeCount={[filterBranch, mes !== mesActual()].filter(Boolean).length}
            acciones={!canDownload ? [] : [{
                key: 'exportar',
                icon: Download,
                label: 'Exportar',
                soloIcono: true,
                title: esDecl
                    ? `Exportar el libro declarable en CSV — ${filas.length} filas, con el motivo de cada una que no cuenta`
                    : `Exportar el libro de compras completo en CSV — ${filas.length} filas, con el número de documento completo`,
                onClick: exportar,
                disabled: loading || filas.length === 0,
            }]}>
            {/* La sucursal no se ofrece en «Declarable»: ese libro es por NRC y
                los documentos que sólo llegaron por correo no tienen sucursal,
                así que filtrar por una omitiría cientos de CCF sin avisar. */}
            {!esDecl && puedeElegirSucursal && branchOptions.length > 0 && (
                <FilterBar.Section active={!!filterBranch} onClear={() => setFB('')} label="sucursal">
                    <FilterBar.Sucursal value={filterBranch}
                        onChange={val => setFB(val || '')} options={branchOptions} />
                </FilterBar.Section>
            )}
            <FilterBar.Section active={mes !== mesActual()} onClear={() => setMes(mesActual())} label="período">
                <PeriodStepper
                    unit="mes"
                    label={etiquetaMes(mes)}
                    onPrev={() => setMes(m => correrMes(m, -1))}
                    onNext={() => setMes(m => correrMes(m, 1))}
                    nextDisabled={mes >= mesActual()}
                    onReset={() => setMes(mesActual())}
                    isCurrent={mes === mesActual()}
                    resetLabel="Ir al mes actual"
                />
            </FilterBar.Section>
        </FilterBar>
    );

    // El vacío se explica en vez de quedar en "no hay datos": un fallo de la
    // consulta y un mes sin movimiento se ven igual, y confundirlos es lo que
    // haría presentar un libro incompleto sin saberlo.
    const vacio = error
        ? { icon: AlertTriangle,
            message: 'No se pudo generar el libro',
            subtext: 'Es un fallo de la consulta, no un mes sin movimiento. No presentes nada de esta pantalla.' }
        : busqueda.trim()
            ? { icon: SearchX,
                message: `Sin coincidencias para «${busqueda.trim()}»`,
                subtext: 'La búsqueda recorta lo que ves; el CSV sigue saliendo con el libro completo.' }
            : { icon: BookOpen,
                message: `Sin compras en ${etiquetaMes(mes)}`,
                subtext: activeTab === 'sin_compra'
                    ? 'Todos los documentos del mes ya están registrados como compra.'
                    : esDecl
                        ? 'No hay documentos de compra en el período.'
                        : undefined };

    return (
        <GlassViewLayout
            icon={BookOpen}
            title="Compras completo"
            filtersContent={filtersContent}
            transparentBody={true}
        >
            <div className="p-5 md:p-6 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen del libro">
                        {esDecl ? (<>
                            <StatCard icon={BookOpen} label="Documentos" value={totDecl.docs} loading={loading}
                                sub={`${totDecl.docs - totDecl.sinCuenta} cuentan · ${totDecl.sinCuenta} no`} />
                            {canVerMontos && (
                                <StatCard icon={Scale} label="Crédito declarable" value={formatMoney(totDecl.credito)}
                                    sub="Ya con las notas de crédito restadas" loading={loading} />
                            )}
                            {/* La tarjeta que acciona: lo que se destrabaría al
                                confirmar la deducibilidad de esos proveedores. */}
                            {canVerMontos && totDecl.trabado > 0 && (
                                <StatCard icon={Lock} label="Trabado por clasificar"
                                    value={`≈ ${formatMoney(totDecl.trabado)}`}
                                    sub="Se libera al confirmar el proveedor" loading={loading} />
                            )}
                        </>) : (<>
                            <StatCard icon={BookOpen} label="Documentos" value={totales.docs} loading={loading}
                                sub={`${totales.docs - totales.sinCompra} registradas · ${totales.sinCompra} sin registrar`} />
                            {/* Documentos queda siempre: es lo que dice si el libro está
                                completo (cuántas sin registrar), y no revela cifras. */}
                            {canVerMontos && (
                                <>
                                    <StatCard icon={Mail} label="Compras" value={formatMoney(totales.total)}
                                        sub="Del período" loading={loading} />
                                    <StatCard icon={Percent} label="Crédito fiscal" value={formatMoney(totales.credito)}
                                        sub="Documentado" loading={loading} />
                                </>
                            )}
                        </>)}
                    </CarrilCards>
                    <div className="flex justify-end min-w-0">{barraFiltros}</div>
                </div>

                {error && (
                    <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>
                )}

                {esDecl ? (
                    <Notice variant="info" icon={Scale} compact>
                        Lo que de estas compras puede reclamarse como crédito fiscal: las notas
                        de crédito <b>restan</b> y las de débito <b>suman</b> (Art. 62), una factura
                        no da crédito por más IVA que traiga (Art. 65), y sólo cuenta el proveedor
                        con su deducibilidad <b>confirmada</b>. Lo que no cuenta <b>igual aparece</b>,
                        con su motivo.
                    </Notice>
                ) : (
                    <Notice variant="info" icon={BookOpen} compact>
                        Todas las compras del período, incluidas las que llegaron como documento
                        del proveedor y todavía no se registraron. El número de documento va
                        completo. Para presentar, el libro del Art. 86 sigue siendo el de <b>Libros IVA</b>.
                    </Notice>
                )}

                {/* El documento que entró dos veces. Va ARRIBA de los motivos y
                    en rojo porque es el único aviso de esta pantalla que dice
                    que hay crédito fiscal de MÁS: los otros dicen que falta.
                    Un renglón repetido no es un detalle de forma —el Art. 141
                    lit. b) CT manda anotar cada comprobante «en forma separada e
                    individualizada»— y encima deduce dos veces el mismo IVA. */}
                {esDecl && !loading && totDecl.repRenglones > 0 && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        <b>{Math.round(totDecl.repDocs)}</b> documento(s) están registrados más
                        de una vez — <b>{totDecl.repRenglones}</b> renglón(es) del libro.
                        {/* El monto sólo si lo hay: un documento repetido que no
                            computaba crédito igual está mal anotado, pero decir
                            «$0.00 de crédito repetido» sería ruido. */}
                        {canVerMontos && totDecl.repCredito > 0 && <> Se está
                        contando <b>{formatMoney(totDecl.repCredito)}</b> de crédito fiscal repetido.</>}
                        {' '}Van marcados <b>«Repetido»</b> en la tabla y en el CSV. Dejá
                        <b> uno solo</b> antes de declarar: una factura que trae productos de dos
                        salas se registra <b>completa una vez</b> y lo que es de la otra se
                        traslada por inventario.
                    </Notice>
                )}

                {/* Los motivos, agregados. Un `title` por fila no alcanza: sin
                    esto habría que pasar el mouse por 300 filas para saber qué
                    quedó afuera y por qué. */}
                {esDecl && !loading && totDecl.sinCuenta > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <b>{totDecl.sinCuenta}</b> de {totDecl.docs} documento(s) no suman crédito fiscal:
                        <ul className="mt-1.5 space-y-0.5">
                            {[...totDecl.motivos.entries()]
                                .sort((a, b) => b[1] - a[1])
                                .map(([motivo, n]) => (
                                    <li key={motivo} className="text-body-sm">
                                        <b className="tabular-nums">{n}</b> — {motivo}
                                    </li>
                                ))}
                        </ul>
                    </Notice>
                )}

                {!esDecl && !loading && totales.sinCompra > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <b>{totales.sinCompra}</b> documento(s) del proveedor todavía no están
                        registrados como compra — <b>{formatMoney(totales.creditoSinCompra)}</b> de
                        crédito fiscal que no entra al libro del Art. 86. La Ley de IVA da tres
                        períodos para reclamarlo.
                    </Notice>
                )}

                {/* La inferencia daba `Fecha` como identidad —es la primera
                    columna con rótulo— y la ficha abría con «05/07/2025» de
                    título. De una compra, lo que la identifica es el PROVEEDOR;
                    la fecha y el estado son contexto. El número de documento va
                    a la hoja, donde entra completo y con su rótulo. */}
                {esDecl ? (
                <DataTable columns={COLS_DECL} dense loading={loading} empty={vacio}
                    /* `apilada`: el nombre del proveedor es un `line-clamp-2` y
                       en la mitad izquierda de la ficha se recortaba — medido,
                       161px en 15 de 54 tarjetas, que es el peor del portal.
                       A ancho completo las dos líneas entran. Ver §32.9. */
                    movil={{ identidad: 'proveedor', chips: ['fecha', 'tipo', 'computa'], usarAccionDeFila: true, apilada: true }}>
                    {paginadas.map((r, i) => (
                        <DataRow key={`d-${r.documento_completo}-${i}`}
                            onClick={r.json_path ? () => abrirDocumento(r) : undefined}>
                            <DataCell>{fmtFecha(r.fecha)}</DataCell>
                            <DataCell>
                                {/* La nota de crédito se marca: es la fila que
                                    RESTA, y leerla como una compra más es
                                    exactamente el error que este libro corrige. */}
                                <Badge size="sm"
                                    variant={r.documento_tipo === 'NOTA DE CRÉDITO' ? 'danger'
                                        : r.documento_tipo === 'CCF' ? 'neutral' : 'warning'}>
                                    {r.documento_tipo === 'NOTA DE CRÉDITO' ? 'N. crédito'
                                        : r.documento_tipo === 'NOTA DE DÉBITO' ? 'N. débito'
                                        : r.documento_tipo}
                                </Badge>
                                {/* Va acá y no en «Documento», que se esconde
                                    bajo `lg`: la marca que dice «este crédito
                                    está contado dos veces» no puede depender del
                                    ancho de la pantalla. */}
                                {Number(r.veces_en_el_libro || 1) > 1 && (
                                    <Badge variant="danger" size="sm"
                                        title="Este mismo documento está en más de un renglón del libro: su crédito fiscal se está contando repetido.">
                                        Repetido ×{r.veces_en_el_libro}
                                    </Badge>
                                )}
                            </DataCell>
                            <DataCell className="max-w-[15rem]" hideBelow="lg">
                                <span className="font-mono text-micro break-all">{r.documento_completo || '—'}</span>
                            </DataCell>
                            <DataCell className="max-w-[16rem]">
                                <span className="line-clamp-2 break-words leading-tight">{r.proveedor || '—'}</span>
                            </DataCell>
                            <DataCell align="right" hideBelow="md">
                                <span className="whitespace-nowrap">{formatMoney(r.compras_gravadas)}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className={`whitespace-nowrap ${Number(r.credito_fiscal) < 0 ? 'text-danger-text font-bold' : ''}`}>
                                    {formatMoney(r.credito_fiscal)}
                                </span>
                            </DataCell>
                            <DataCell align="right" hideBelow="md">
                                <span className="font-black whitespace-nowrap">{formatMoney(r.total)}</span>
                            </DataCell>
                            <DataCell align="center">
                                {r.computa_credito
                                    ? <Badge variant="success" size="sm">Sí</Badge>
                                    : <Badge variant="warning" size="sm" title={r.motivo || ''}>No</Badge>}
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
                ) : (
                <DataTable columns={COLS} dense loading={loading} empty={vacio}
                    movil={{ identidad: 'proveedor', chips: ['fecha', 'origen'], usarAccionDeFila: true, apilada: true }}>
                    {paginadas.map((r, i) => (
                        <DataRow key={`${r.origen}-${r.documento_completo}-${i}`}
                            onClick={r.json_path ? () => abrirDocumento(r) : undefined}>
                            <DataCell>{fmtFecha(r.fecha)}</DataCell>
                            <DataCell>
                                <Badge variant={r.origen === 'registrada' ? 'neutral' : 'warning'} size="sm">
                                    {r.origen === 'registrada' ? 'Registrada' : 'Sin registrar'}
                                </Badge>
                            </DataCell>
                            <DataCell className="max-w-[15rem]">
                                <span className="font-mono text-micro break-all">
                                    {r.documento_completo || '—'}
                                </span>
                                {/* Sin archivo no hay nada que abrir, y la fila
                                    no reacciona. Decirlo evita que se lea como
                                    un clic que falla. */}
                                {!r.json_path && (
                                    <span className="block text-micro text-content-3 mt-0.5">Sin documento</span>
                                )}
                            </DataCell>
                            <DataCell className="max-w-[16rem]">
                                <span className="line-clamp-2 break-words leading-tight">
                                    {r.proveedor || '—'}
                                </span>
                            </DataCell>
                            <DataCell hideBelow="2xl">
                                {r.nrc
                                    ? <span className="font-mono text-caption whitespace-nowrap">{formatearNrc(r.nrc)}</span>
                                    : <Badge variant="warning" size="sm">Falta</Badge>}
                            </DataCell>
                            <DataCell hideBelow="2xl">
                                {r.nit
                                    ? <span className="font-mono text-caption whitespace-nowrap">{formatearNit(r.nit)}</span>
                                    : <Badge variant="warning" size="sm">Falta</Badge>}
                            </DataCell>
                            <DataCell align="right">
                                <span className="whitespace-nowrap">{formatMoney(r.compras_gravadas)}</span>
                            </DataCell>
                            <DataCell align="right" hideBelow="md">
                                <span className="whitespace-nowrap">{formatMoney(r.credito_fiscal)}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="font-black whitespace-nowrap">{formatMoney(r.total)}</span>
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
                )}

                {filasVistas.length > 0 && (
                    <TablePagination
                        page={pagina}
                        totalPages={totalPaginas}
                        onPageChange={setPagina}
                        pageSize={tamPagina}
                        onPageSizeChange={setTamPagina}
                        total={delTab.length}
                        filteredTotal={busqueda.trim() ? filasVistas.length : undefined}
                        unit="documentos"
                    />
                )}
            </div>
        </GlassViewLayout>
    );
}
