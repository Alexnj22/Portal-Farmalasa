import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, Check, Search, Stethoscope, User, X } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import FileField from '../common/FileField';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidModal from '../common/LiquidModal';
import ListRow from '../common/ListRow';
import LiquidSelect from '../common/LiquidSelect';
import SegmentedControl from '../common/SegmentedControl';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import { clearDraft, loadDraft, saveDraft } from '../../utils/draftUtils';

/* El editor se baja al ELEGIR el archivo, no al abrir el formulario: arrastra
 * el canónico de recorte y no hace falta hasta que hay una foto. */
const EditorDeDocumento = lazy(() => import('../common/EditorDeDocumento'));
import {
    CLASE_CLIENTE, JUNTAS_QUE_PRESCRIBEN, avisarFallaDelConsejo, buscarMedicoLocal,
    buscarMedicosLocalPorNombre, completarRenglon, consultarConsejo, fetchRecetasRecientes,
    guardarMedicoDelConsejo, subirFotoDeReceta,
} from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Completar un renglón del libro.
//
// Se le piden CUATRO cosas y ni una más: paciente, médico, cuánto recetó el
// médico, y la foto. Todo lo demás —producto, cantidad, lote, vencimiento,
// documento, cliente, quién vendió— ya vino de la venta y se muestra de sólo
// lectura, para que se pueda comparar contra el papel sin volver a teclearlo.
//
// ── El paciente sale del cliente, pero sólo si el cliente es una persona ────
// Con un cliente genérico o una empresa el campo arranca VACÍO y con su aviso.
// Prellenarlo igual sería sembrar el libro de pacientes llamados «Cliente
// Frecuente», y eso no se detecta después: se lee como un dato.
//
// ── El médico se busca por número, y nunca traba ───────────────────────────
// Primero nuestra tabla; si no está, se escribe el nombre y se guarda. Lo que
// la norma exige (ítem 3.13) es que la RECETA traiga los datos del prescriptor,
// y esa receta se está fotografiando.
//
// ── Cuánto recetó NO es cuánto se entregó ──────────────────────────────────
// De esa resta sale parcial o total. Por eso el campo se pide aparte y arranca
// en lo entregado (el caso más común: se dio todo de una), no porque sean lo
// mismo.
//
// ── Se guarda solo mientras se escribe ─────────────────────────────────────
// Las sesiones de sala se cierran a los 5 minutos de inactividad, y llenar esto
// es mirar un papel y teclear: se pasa fácil. El borrador va por FOLIO —dos
// renglones distintos no comparten lo escrito— y NO incluye la foto: un File no
// se puede guardar, y prometer que quedó guardada cuando no es cierto es peor
// que no guardar nada.
// ═══════════════════════════════════════════════════════════════════════════

const MODOS = [
    { value: 'numero', label: 'Por número' },
    { value: 'nombre', label: 'Por nombre' },
];

/**
 * El rótulo de un control que no lo trae puesto.
 *
 * `PortalInput` pone su `<label htmlFor>` solo; `LiquidSelect`,
 * `SegmentedControl` y `LiquidDatePicker` no reciben etiqueta, así que en este
 * archivo el mismo bloque de cinco clases estaba escrito **cinco veces** — y
 * con dos separaciones distintas. No es un componente compartido nuevo: es la
 * misma línea, dicha una vez, en el único archivo que la repetía.
 *
 * Envuelve al control en el `<label>` en vez de ponerlo al lado, así que hacer
 * clic en el texto enfoca el control — que es exactamente lo que el §15.11 de
 * DESIGN.md cuenta que NINGUNO de los ~20 campos a mano hacía.
 */
const Rotulo = ({ texto, ayuda, children }) => (
    <label className="block">
        <span className="block text-label font-bold uppercase tracking-widest text-content-3 mb-1.5">
            {texto}
        </span>
        {children}
        {ayuda && <span className="block mt-1 text-label text-content-3">{ayuda}</span>}
    </label>
);

/**
 * Una de las cuatro cosas que hay que llenar, con su número y su palomita.
 *
 * El formulario eran doce bloques apilados con la misma separación y ningún
 * título: para saber dónde estaba uno había que releer los campos. El ordinal
 * da la espina —cuatro pasos, en orden— y la palomita contesta «¿éste ya?» sin
 * subir al riel del encabezado.
 *
 * Es una fila con una regla arriba, no una tarjeta: adentro de un modal, una
 * tarjeta es una tarjeta dentro de otra.
 */
const Seccion = ({ n, titulo, listo, children }) => (
    <section className="space-y-2.5">
        <div className="flex items-center gap-2">
            <span aria-hidden className={`flex items-center justify-center w-5 h-5 shrink-0 rounded-full text-label font-black tabular-nums transition-colors duration-[var(--dur-fast)] ${
                listo ? 'bg-success/15 text-success-text' : 'bg-surface-card text-content-3 border border-border-card'}`}>
                {listo ? <Check className="w-3 h-3" /> : n}
            </span>
            <h4 className="text-label font-black uppercase tracking-widest text-content-2">{titulo}</h4>
            <span aria-hidden className="flex-1 h-px bg-border-card" />
        </div>
        {children}
    </section>
);

const num = (v) => (v === null || v === undefined ? '—' : String(Number(v)));

const fmtFecha = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    : '—');

// El vencimiento SIEMPRE con año: «vence 01-ene» no dice nada — puede ser de
// hace tres años o del que viene, y es justo el dato con el que se decide si un
// lote se pudo dispensar.
const fmtVence = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '—');

export default function CompletarRenglon({ renglon, branchId, onCerrar }) {
    const clase = CLASE_CLIENTE[renglon.clase_cliente] || CLASE_CLIENTE.sin_ficha;
    const claveBorrador = `bitacora-renglon-${renglon.id}`;
    const borrador = useMemo(() => loadDraft(claveBorrador) || {}, [claveBorrador]);

    const [paciente, setPaciente] = useState(() => borrador.paciente ?? (clase.sirve ? (renglon.cliente || '') : ''));
    const [edad, setEdad]         = useState(() => borrador.edad ?? '');
    const [documento, setDocumento] = useState(() => borrador.documento ?? '');

    const [junta, setJunta]       = useState(() => borrador.junta ?? 'P01');
    const [numJunta, setNumJunta] = useState(() => borrador.numJunta ?? '');
    const [medico, setMedico]     = useState(null);      // el resuelto
    const [nombreMedico, setNombreMedico] = useState(() => borrador.nombreMedico ?? '');
    const [modo, setModo]         = useState(() => borrador.modo ?? 'numero');
    const [nombresBusca, setNombresBusca]   = useState(() => borrador.nombresBusca ?? '');
    const [apellidosBusca, setApellidosBusca] = useState(() => borrador.apellidosBusca ?? '');
    const [buscando, setBuscando] = useState(false);
    const [buscado, setBuscado]   = useState(false);     // ya se buscó con estos datos
    const [candidatos, setCandidatos] = useState([]);    // varios resultados: hay que elegir
    const [avisoBusqueda, setAvisoBusqueda] = useState(null);

    const [prescrita, setPrescrita] = useState(() => borrador.prescrita ?? String(Number(renglon.cantidad ?? 0)));
    const [fechaReceta, setFechaReceta] = useState(() => borrador.fechaReceta ?? (renglon.fecha || ''));
    const [recetaId, setRecetaId] = useState(() => borrador.recetaId ?? null);
    const [abiertas, setAbiertas] = useState([]);

    const [archivo, setArchivo]   = useState(null);
    const [porEditar, setPorEditar] = useState(null);   // el archivo recién elegido
    const [notas, setNotas]       = useState(() => borrador.notas ?? '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError]       = useState(null);

    // Las recetas que ya tienen algo pendiente en esta sala: si el paciente
    // vuelve por el resto, esta entrega se liga a la MISMA receta. Crear una
    // receta nueva por cada visita es lo que rompe el cálculo de parcial/total.
    useEffect(() => {
        let vivo = true;
        fetchRecetasRecientes(branchId).then(({ recetas }) => {
            if (vivo) setAbiertas(recetas);
        });
        return () => { vivo = false; };
    }, [branchId]);

    // El borrador se escribe en cada tecla. La foto NO va: un File no se
    // serializa, y guardar su nombre haría creer que quedó adjunta.
    useEffect(() => {
        saveDraft(claveBorrador, {
            paciente, edad, documento, junta, numJunta, nombreMedico,
            prescrita, fechaReceta, recetaId, notas, modo, nombresBusca, apellidosBusca,
        });
    }, [claveBorrador, paciente, edad, documento, junta, numJunta, nombreMedico,
        prescrita, fechaReceta, recetaId, notas, modo, nombresBusca, apellidosBusca]);

    // ── Se ofrecen TODAS las recetas abiertas, no sólo las de este medicamento
    //
    // Una receta trae varios medicamentos. Medido en agosto: 10 facturas con más
    // de un renglón bajo receta, y una de ellas es RANITIDINA + ROCEFORT al
    // mismo paciente, en el mismo documento — o sea, casi con seguridad la misma
    // receta con dos renglones.
    //
    // El filtro anterior sólo ofrecía las recetas con pendiente de ESTE
    // producto, así que el segundo medicamento no podía ligarse a la receta que
    // acababa de crearse: obligaba a inventar una receta nueva por medicamento,
    // y entonces el correlativo del libro dejaba de corresponder a un papel.
    //
    // Cada una se rotula con lo que la distingue: si ya tiene este medicamento
    // pendiente es una CONTINUACIÓN (la segunda entrega); si no, es OTRO
    // medicamento de la misma receta.
    const compatibles = useMemo(() => abiertas.map((r) => {
        const item = (r.items || []).find(i => i.erp_product_id === renglon.erp_product_id);
        const pendiente = item ? Number(item.prescrito) - Number(item.entregado) : 0;
        return { ...r, item, pendiente, continuacion: Boolean(item && pendiente > 0) };
    }), [abiertas, renglon.erp_product_id]);

    // Primero NUESTRA tabla, después el registro del Consejo. Ese orden no es
    // por velocidad: un médico que ya recetó acá tiene el nombre con el que se
    // guardó, y pisarlo con el del Consejo cambiaría cómo se lee el mismo
    // prescriptor en recetas distintas.
    const buscarMedico = useCallback(async () => {
        setBuscando(true);
        setError(null);
        setAvisoBusqueda(null);
        setCandidatos([]);

        const porNumero = modo === 'numero';
        const n   = numJunta.trim();
        const nom = nombresBusca.trim();
        const ape = apellidosBusca.trim();

        if (porNumero ? !n : !(nom || ape)) { setBuscando(false); return; }

        // 1 · Lo nuestro.
        if (porNumero) {
            const { medico: m } = await buscarMedicoLocal(n, junta);
            if (m) {
                setMedico(m); setNombreMedico(m.nombre);
                setBuscando(false); setBuscado(true);
                return;
            }
        } else {
            const { medicos } = await buscarMedicosLocalPorNombre(nom, ape, junta);
            if (medicos.length > 0) {
                setCandidatos(medicos.map(m => ({ ...m, local: true })));
                setBuscando(false); setBuscado(true);
                return;
            }
        }

        // 2 · El Consejo. Nunca traba: si no responde, se sigue a mano.
        const { profesionales, total, recortado, error: e } = await consultarConsejo({
            junta, numero: porNumero ? n : '', nombres: nom, apellidos: ape,
        });
        setBuscando(false);
        setBuscado(true);

        if (e) {
            // El registro caído deja a la sala sin poder completar NADA, porque
            // el médico sólo se puede tomar de ahí. Se avisa a quien lo pidió;
            // la base limita a un aviso por hora.
            setAvisoBusqueda(e);
            avisarFallaDelConsejo(`Al buscar ${porNumero ? `el N.º ${n}` : `${nom} ${ape}`.trim()}: ${e}`);
            return;
        }
        if (!profesionales.length) return;

        if (porNumero && profesionales.length === 1) {
            const p0 = profesionales[0];
            setMedico({ nombre: p0.nombre, numero_junta: p0.numero_junta, carrera: p0.carrera, delConsejo: true });
            setNombreMedico(p0.nombre);
            setNumJunta(p0.numero_junta);
            return;
        }
        setCandidatos(profesionales.map(p => ({ ...p, delConsejo: true })));
        // Una lista recortada en silencio se lee como «éstos son todos».
        if (recortado) {
            setAvisoBusqueda(
                `El registro del Consejo encontró ${total} y muestra ${profesionales.length}. `
                + 'Agrega el nombre además del apellido, o busca por número de junta.',
            );
        }
    }, [modo, numJunta, nombresBusca, apellidosBusca, junta]);

    // Cambiar cualquier término invalida lo encontrado: si no, se guardaría el
    // médico anterior con el número nuevo.
    const invalidar = useCallback(() => {
        setMedico(null);
        setBuscado(false);
        setCandidatos([]);
        setAvisoBusqueda(null);
    }, []);

    // Deshacer una elección equivocada: se limpia todo lo del médico y vuelve la
    // búsqueda. Sin esto, un médico puesto por error no se podía sacar.
    const quitarMedico = useCallback(() => {
        setMedico(null);
        setNombreMedico('');
        setBuscado(false);
        setCandidatos([]);
        setAvisoBusqueda(null);
    }, []);

    const elegirCandidato = useCallback((c) => {
        setMedico(c);
        setNombreMedico(c.nombre);
        if (c.numero_junta) setNumJunta(String(c.numero_junta));
        setCandidatos([]);
    }, []);

    const recetaElegida = useMemo(
        () => compatibles.find(r => String(r.id) === String(recetaId)) || null,
        [compatibles, recetaId],
    );

    // Elegir una receta existente rellena paciente, médico y lo prescrito: esa
    // receta ya los decidió y no se vuelven a preguntar.
    //
    // Va en el manejador y NO en un efecto: es una acción de la persona, no una
    // sincronización con algo de afuera. En un efecto, además, volvería a pisar
    // lo que se escribió a mano en cada render.
    const elegirReceta = useCallback((v) => {
        setRecetaId(v || null);
        const r = compatibles.find(x => String(x.id) === String(v));
        if (!r) return;
        // Si la receta ya trae este medicamento, lo prescrito lo manda ella. Si
        // es otro medicamento del mismo papel, la cantidad es propia y se
        // pregunta — heredarla sería copiar la cantidad de otro fármaco.
        const item = (r.items || []).find(i => i.erp_product_id === renglon.erp_product_id);
        if (item) setPrescrita(String(Number(item.prescrito)));
        else setPrescrita(String(Number(renglon.cantidad ?? 0)));
        setPaciente(r.paciente || '');
        if (r.medico_id) {
            setMedico({ id: r.medico_id, nombre: r.medico });
            setNombreMedico(r.medico || '');
        }
    }, [compatibles, renglon.erp_product_id, renglon.cantidad]);

    // Sin médico resuelto no se guarda. No hay ruta alternativa.
    const faltaMedico = !medico;

    // Lo entregado en ESTE renglón contra lo que el médico recetó. Negativo
    // significa que se entregó de más, y eso NO es una dispensación total: es un
    // dato que no puede ser. El servidor ya lo rechaza, pero decir «TOTAL» en
    // verde hasta que alguien apriete guardar es una pantalla que miente —
    // reportado con 1 recetado y 3 entregados.
    const pendiente = Number(prescrita) - Number(renglon.cantidad ?? 0);
    const entregoDeMas = Number(prescrita) > 0 && pendiente < 0;

    const puedeGuardar = paciente.trim() && !faltaMedico && Number(prescrita) > 0 && !entregoDeMas;

    // Guardar SIN la copia se puede —una cámara que falla no puede dejar el
    // libro sin renglón— pero el botón lo dice con todas las letras. El ítem
    // 3.12 pide la copia de la receta resguardada al menos un año, y un renglón
    // que dice «completa» sin ella es un renglón que miente en silencio.
    const sinCopia = Boolean(puedeGuardar) && !archivo;

    // Un lote vencido al momento de dispensar es un ítem CRÍTICO de la guía
    // (6.1). Acá se marca en rojo el vencimiento: quien completa el renglón
    // tiene el frasco en la mano y es el último que puede notarlo.
    const venceAntes = Boolean(renglon.vence && renglon.fecha && renglon.vence < renglon.fecha);

    const guardar = useCallback(async () => {
        setGuardando(true);
        setError(null);

        // 1. El médico. Si salió de nuestra tabla ya tiene id; si salió del
        //    registro del Consejo, se guarda ahora con esa confirmación. NO hay
        //    camino a mano: la base rechaza un prescriptor que el registro no
        //    confirmó.
        let medicoId = medico?.id ?? null;
        if (!medicoId) {
            const { id, error: e1 } = await guardarMedicoDelConsejo({
                numeroJunta: medico.numero_junta, nombre: medico.nombre,
                junta, carrera: medico.carrera ?? null,
            });
            if (e1) { setGuardando(false); setError(e1); return; }
            medicoId = id;
        }

        // 2. La foto. Se sube ANTES de completar: si falla, no queda un renglón
        //    marcado como completo sin su copia de receta.
        let fotoUrl = null;
        if (archivo) {
            const { url, error: e2 } = await subirFotoDeReceta(archivo, branchId);
            if (e2) { setGuardando(false); setError(e2); return; }
            fotoUrl = url;
        }

        const { error: e3 } = await completarRenglon({
            dispensacionId: renglon.id,
            pacienteNombre: paciente,
            medicoId,
            cantidadPrescrita: prescrita,
            fechaPrescripcion: fechaReceta || null,
            pacienteEdad: edad,
            pacienteDocumento: documento,
            fotoUrl,
            recetaId: recetaId || null,
            notas,
        });
        setGuardando(false);
        if (e3) { setError(e3); return; }
        clearDraft(claveBorrador);
        onCerrar(true);
    }, [medico, junta, archivo, branchId, renglon.id,
        paciente, prescrita, fechaReceta, edad, documento, recetaId, notas,
        claveBorrador, onCerrar]);


    // ── Los cuatro requisitos, y en qué va cada uno ─────────────────────────
    //
    // Están acá y no adentro del botón porque un botón deshabilitado no dice
    // QUÉ falta: dice que no. Con la receta en una mano y el cliente enfrente,
    // «te falta la foto» y «te falta el médico» son dos trabajos distintos, y
    // el que los tiene que hacer no puede averiguarlo a fuerza de bajar y subir
    // por un formulario de doce bloques.
    //
    // La foto NO impide guardar —una cámara que falla no puede dejar el libro
    // sin renglón— pero cuenta como requisito y el botón lo dice: el ítem 3.12
    // de la guía pide la copia de la receta, y guardarla sin ella en silencio
    // es sembrar renglones que dicen «completa» y no lo están.
    const requisitos = [
        { clave: 'paciente', label: 'Paciente',  ok: Boolean(paciente.trim()) },
        { clave: 'medico',   label: 'Médico',    ok: !faltaMedico },
        { clave: 'cantidad', label: 'Cantidad',  ok: Number(prescrita) > 0 && !entregoDeMas },
        { clave: 'foto',     label: 'Copia',     ok: Boolean(archivo) },
    ];
    const listos = requisitos.filter(r => r.ok).length;

    return (
        <LiquidModal open onClose={guardando ? undefined : () => onCerrar(false)}
            maxWidth="max-w-2xl" ariaLabel="Completar el renglón del libro">

            {/* ── El encabezado ES la comparación contra el papel ────────────
                Lo que se entregó vivía en una tarjeta dentro del cuerpo, o sea
                una tarjeta adentro de otra, y competía en peso con los campos
                que hay que llenar. Acá arriba tiene el lugar que le toca: es
                contexto de sólo lectura, se mira una vez, y no se vuelve a
                tocar. Reportado antes como «dame más clara la info, casi no se
                nota ni se ve». */}
            <LiquidModal.Header>
                <div className="min-w-0 space-y-1.5">
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-label font-black tabular-nums text-content-2">
                            {renglon.folio_txt}
                        </span>
                        <span className="text-caption text-content-3">
                            {fmtFecha(renglon.fecha)}
                            {renglon.correlativo_doc ? ` · ${renglon.correlativo_doc}` : ''}
                            {renglon.vendedor ? ` · ${renglon.vendedor}` : ''}
                        </span>
                    </div>

                    <h3 className="text-body-lg font-black text-content leading-tight">
                        {renglon.producto_nombre}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-body font-black text-brand-text tabular-nums">
                            {num(renglon.cantidad)}
                            <span className="ml-1 text-caption font-bold uppercase tracking-wider text-content-3">
                                {Number(renglon.cantidad) === 1 ? 'entregada' : 'entregadas'}
                            </span>
                        </span>
                        {renglon.lote && (
                            <Badge variant="chart-3" size="sm" uppercase={false}>Lote {renglon.lote}</Badge>
                        )}
                        {renglon.vence && (
                            <Badge variant={venceAntes ? 'danger' : 'neutral'} size="sm" uppercase={false}>
                                Vence {fmtVence(renglon.vence)}
                            </Badge>
                        )}
                        {renglon.laboratorio && (
                            <span className="text-caption text-content-3 truncate">{renglon.laboratorio}</span>
                        )}
                    </div>

                    {/* El riel de requisitos. Cuatro pasos, siempre visibles. */}
                    <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1">
                        {requisitos.map((r, i) => (
                            <li key={r.clave} className="flex items-center gap-1.5">
                                {i > 0 && <span aria-hidden className="text-content-3 opacity-40">·</span>}
                                <span className={`flex items-center gap-1 text-label font-bold ${
                                    r.ok ? 'text-success-text' : 'text-content-3'}`}>
                                    {r.ok
                                        ? <Check className="w-3 h-3 shrink-0" aria-hidden />
                                        : <span aria-hidden
                                            className="w-3 h-3 shrink-0 rounded-full border border-current opacity-60" />}
                                    {r.label}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-5">
                {!clase.sirve && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <span className="font-bold">{clase.titulo}</span>
                        <span className="block mt-0.5 font-normal text-content-2">{clase.aviso}</span>
                        <span className="block mt-1 font-normal text-content-3">
                            La venta quedó a nombre de: {renglon.cliente || 'sin nombre'}
                        </span>
                    </Notice>
                )}

                {/* ── 1 · Paciente ────────────────────────────────────────── */}
                <Seccion n={1} titulo="Quién se lo lleva" listo={requisitos[0].ok}>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <PortalInput
                            label="Paciente" name="paciente" icon={User} required colSpan={2}
                            value={paciente} onChange={(e) => setPaciente(e.target.value)}
                            placeholder="Nombre completo, como está en la receta"
                            helperText={clase.sirve ? 'Se tomó del cliente de la venta' : undefined}
                            hasError={!paciente.trim()}
                        />
                        <PortalInput
                            label="Edad" name="edad" type="number" inputMode="numeric" min="0" max="130"
                            value={edad} onChange={(e) => setEdad(e.target.value)}
                            placeholder="—" inputClassName="tabular-nums"
                        />
                        <PortalInput
                            label="Documento" name="documento"
                            value={documento} onChange={(e) => setDocumento(e.target.value)}
                            placeholder="DUI" inputClassName="tabular-nums"
                        />
                    </div>
                </Seccion>

                {/* ── 2 · Prescriptor ──────────────────────────────────────
                    Resuelto, la sección se PLIEGA a una línea. Dejar los cuatro
                    controles de búsqueda abiertos después de encontrar al
                    médico es dejar en pantalla un trabajo que ya se hizo, y en
                    un formulario largo eso cuesta el doble: ocupa y confunde. */}
                <Seccion n={2} titulo="Quién la recetó" listo={requisitos[1].ok}>
                    {medico ? (
                        /* El médico resuelto es un VALOR, no una alerta. Estaba
                           pintado con un `Notice` verde, que es el mismo envase
                           que usa «se entregó de más»: gastar el vocabulario de
                           aviso en un dato que salió bien es lo que hace que los
                           avisos de verdad dejen de mirarse. Es una fila, y la
                           fila canónica es `ListRow`. */
                        <ListRow
                            surface="row" density="sm"
                            icon={BadgeCheck} iconClass="text-success-text"
                            title={medico.nombre}
                            subtitle={`N.º ${medico.numero_junta}${
                                medico.carrera ? ` · ${medico.carrera}` : ''}${
                                medico.verificado_at || medico.delConsejo
                                    ? ' · confirmado en el registro del Consejo'
                                    : ' · tomado de una receta'}`}
                            trailing={(
                                <Button variant="ghost" size="xs" icon={X} onClick={quitarMedico}>
                                    Cambiar
                                </Button>
                            )}
                        />
                    ) : (
                        <div className="space-y-3">
                            {/* Las tres juntas del Art. 19 de la Ley de Medicamentos y
                                ninguna más: médico, odontólogo y médico veterinario.
                                Enfermería y químico farmacéutico NO prescriben, y
                                ofrecerlas invitaría a registrar una receta que la ley
                                no reconoce. */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Rotulo texto="Profesión">
                                    <LiquidSelect
                                        value={junta} onChange={(v) => { setJunta(v || 'P01'); invalidar(); }}
                                        options={JUNTAS_QUE_PRESCRIBEN} clearable={false}
                                    />
                                </Rotulo>
                                <Rotulo texto="Cómo buscarlo">
                                    <SegmentedControl
                                        value={modo}
                                        onChange={(v) => { setModo(v); invalidar(); }}
                                        options={MODOS}
                                    />
                                </Rotulo>
                            </div>

                            {modo === 'numero' ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                                    <PortalInput
                                        label="N.º de junta" name="numero_junta" icon={Stethoscope} required
                                        value={numJunta} onChange={(e) => { setNumJunta(e.target.value); invalidar(); }}
                                        placeholder="12345" inputClassName="tabular-nums"
                                    />
                                    <Button variant="secondary" icon={Search} onClick={buscarMedico}
                                        loading={buscando} disabled={!numJunta.trim()}>
                                        Buscar
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    {/* DOS campos y no uno. Medido contra el registro del
                                        Consejo: «JOSE ROBERTO JULE SEGURA» escrito entero
                                        en el campo de nombres devuelve CERO resultados, y
                                        eso en pantalla se lee igual que «no existe». */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                                        <PortalInput
                                            label="Nombres" name="med_nombres" icon={User}
                                            value={nombresBusca} onChange={(e) => { setNombresBusca(e.target.value); invalidar(); }}
                                            placeholder="José Roberto"
                                        />
                                        <PortalInput
                                            label="Apellidos" name="med_apellidos"
                                            value={apellidosBusca} onChange={(e) => { setApellidosBusca(e.target.value); invalidar(); }}
                                            placeholder="Jule Segura"
                                        />
                                        <Button variant="secondary" icon={Search} onClick={buscarMedico}
                                            loading={buscando} disabled={!nombresBusca.trim() && !apellidosBusca.trim()}>
                                            Buscar
                                        </Button>
                                    </div>
                                    <p className="text-label text-content-3">
                                        Van separados, como en el registro del Consejo. Con sólo el apellido
                                        también busca.
                                    </p>
                                </>
                            )}

                            {/* Varios resultados: se elige, no se adivina. Que la
                                máquina tome el primero de doce sería guardar a otro
                                médico con apellido parecido. */}
                            {candidatos.length > 0 && (
                                <div className="space-y-1.5">
                                    <p className="text-label font-bold uppercase tracking-widest text-content-3">
                                        {candidatos.length} coinciden — elige cuál
                                    </p>
                                    <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                                        {candidatos.map((c) => (
                                            <li key={`${c.junta}-${c.numero_junta}`}>
                                                <ListRow
                                                    surface="row" density="sm" icon={Stethoscope}
                                                    title={c.nombre}
                                                    subtitle={`N.º ${c.numero_junta}${c.carrera ? ` · ${c.carrera}` : ''}${c.local ? ' · ya está en el portal' : ''}`}
                                                    onClick={() => elegirCandidato(c)}
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {avisoBusqueda && <Notice variant="info" compact>{avisoBusqueda}</Notice>}

                            {/* NO hay alta a mano. Decisión del usuario: «si agregamos
                                un dato irreal sería falso; si no está ahí, no existe».
                                Un prescriptor inventado es peor que un renglón
                                incompleto — el incompleto se ve y se corrige, el
                                inventado se lee como un dato bueno y sostiene una
                                dispensación que quizá nadie recetó. La base lo rechaza
                                también, no sólo esta pantalla. */}
                            {buscado && candidatos.length === 0 && !avisoBusqueda && (
                                <Notice variant="danger" icon={AlertTriangle}>
                                    <span className="font-bold">
                                        Ese profesional no está en el registro del Consejo.
                                    </span>
                                    <span className="block mt-0.5 font-normal text-content-2">
                                        Revisa el número o el apellido del sello: un dígito de más no
                                        encuentra a nadie. Si de verdad no está, esa receta no la firmó un
                                        profesional inscrito y no se puede registrar como tal; hay que
                                        hablarlo con el regente.
                                    </span>
                                </Notice>
                            )}
                        </div>
                    )}
                </Seccion>

                {/* ── 3 · La receta ────────────────────────────────────────
                    Ligar la entrega a una receta abierta vive ACÁ y no arriba
                    de todo. Es la misma pregunta que «cuánto recetó»: de qué
                    papel es esta entrega. Al principio del formulario
                    interrumpía antes de que se supiera de qué se estaba
                    hablando. */}
                <Seccion n={3} titulo="Qué dice la receta" listo={requisitos[2].ok}>
                    <div className="space-y-3">
                        {compatibles.length > 0 && (
                            <Rotulo texto="¿Es de una receta que ya existe?"
                                ayuda="Una receta con dos medicamentos es UNA receta. De ahí sale que la dispensación sea parcial o total.">
                                <LiquidSelect
                                    value={recetaId ? String(recetaId) : ''}
                                    onChange={elegirReceta}
                                    options={compatibles.map(r => ({
                                        value: String(r.id),
                                        label: r.continuacion
                                            ? `${r.correlativo_txt} · ${r.paciente} — faltan ${num(r.pendiente)} de este medicamento`
                                            : `${r.correlativo_txt} · ${r.paciente} — otro medicamento de esta receta`,
                                    }))}
                                    placeholder="Es una receta nueva"
                                />
                            </Rotulo>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <PortalInput
                                label="Cuánto recetó el médico" name="prescrita" type="number" inputMode="decimal"
                                step="0.001" min="0" required alto
                                value={prescrita} onChange={(e) => setPrescrita(e.target.value)}
                                inputClassName="tabular-nums"
                                hasError={entregoDeMas}
                                readOnly={Boolean(recetaElegida?.item)}
                            />
                            <Rotulo texto="Fecha de la receta">
                                <LiquidDatePicker value={fechaReceta} onChange={(v) => setFechaReceta(v || '')} />
                            </Rotulo>
                        </div>

                        {/* Parcial o total no se elige: se LEE. Y por eso no es un
                            aviso —no hay nada que atender— sino el resultado de la
                            resta, dicho donde se hizo la resta. Haber entregado de
                            más sí es un error, y ahí sí grita. */}
                        {entregoDeMas ? (
                            <Notice variant="danger" icon={AlertTriangle}>
                                <span className="font-bold">
                                    Se entregaron {num(renglon.cantidad)} y la receta dice {num(prescrita)}.
                                </span>
                                <span className="block mt-0.5 font-normal text-content-2">
                                    No se puede entregar más de lo recetado. Revisa la receta: si el médico
                                    recetó {num(renglon.cantidad)} o más, corregí el número; si de verdad se
                                    entregó de más, el renglón se anula y se rehace la venta.
                                </span>
                            </Notice>
                        ) : Number(prescrita) > 0 && (
                            <p className={`text-body-sm font-bold ${
                                pendiente > 0 ? 'text-warning-text' : 'text-success-text'}`}>
                                {pendiente > 0
                                    ? `Entrega parcial: quedan ${num(pendiente)} de ${num(prescrita)}.`
                                    : `Entrega total: se dio todo lo recetado (${num(prescrita)}).`}
                            </p>
                        )}
                    </div>
                </Seccion>

                {/* ── 4 · La copia ─────────────────────────────────────────── */}
                <Seccion n={4} titulo="La copia de la receta" listo={requisitos[3].ok}>
                    <FileField
                        /* Sin el editor de `FileField`: esta pantalla abre el suyo, con
                        el tipo de papel que sabe que va a recibir. Que lo abriera
                        también el canónico serían DOS editores encadenados sobre la
                        misma foto. El QR del teléfono sí queda. */
                        conEditor={false}
                        label="Foto de la receta"
                        file={archivo}
                        onChange={(f, { yaPreparado } = {}) => {
                            // Un PDF ya viene de un escáner: no hay nada que recortar
                            // ni aclarar, y meterlo por el editor lo convertiría en
                            // una imagen peor que el original.
                            //
                            // Y `yaPreparado` significa que la foto llegó del teléfono
                            // ya recortada y enderezada: volver a abrir el editor es
                            // pedir dos veces el mismo trabajo, sobre una foto que
                            // alguien ya cuadró. Ver el contrato de `onChange` en
                            // `FileField`.
                            if (f && !yaPreparado && f.type?.startsWith('image/')) setPorEditar(f);
                            else setArchivo(f);
                        }}
                        accept="image/*,application/pdf"
                        maxSizeMB={10}
                        hint="Se recorta y se endereza antes de guardarla, y todas salen del mismo tamaño. La norma manda retener una copia por al menos un año."
                    />
                </Seccion>

                {porEditar && (
                    <Suspense fallback={null}>
                        <EditorDeDocumento
                            tipo="receta"
                            file={porEditar}
                            onCancel={() => setPorEditar(null)}
                            onConfirm={(lista) => { setArchivo(lista); setPorEditar(null); }}
                        />
                    </Suspense>
                )}

                <PortalTextarea
                    label="Notas (opcional)" name="notas"
                    value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
                    placeholder="Por ejemplo: queda pendiente el resto por falta de existencia."
                />

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                {/* Lo que falta, dicho en palabras. Un contador «3 de 4» obliga a
                    volver a buscar cuál es el que falta. */}
                <p className="mr-auto text-label text-content-3 hidden sm:block">
                    {listos === requisitos.length
                        ? 'Todo listo'
                        : `Falta ${requisitos.filter(r => !r.ok).map(r => r.label.toLowerCase()).join(', ')}`}
                </p>
                <Button variant="ghost" onClick={() => onCerrar(false)} disabled={guardando}>
                    Cancelar
                </Button>
                <Button variant="primary" icon={sinCopia ? AlertTriangle : Check} onClick={guardar}
                    loading={guardando} disabled={!puedeGuardar}>
                    {sinCopia ? 'Guardar sin la copia' : 'Guardar en el libro'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
