import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, Camera, Search, Stethoscope, User, X } from 'lucide-react';
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
const EditorDeReceta = lazy(() => import('./EditorDeReceta'));
import {
    CLASE_CLIENTE, JUNTAS_QUE_PRESCRIBEN, buscarMedicoLocal, buscarMedicosLocalPorNombre,
    completarRenglon, consultarConsejo, fetchRecetasAbiertas, guardarMedico, subirFotoDeReceta,
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
        fetchRecetasAbiertas(branchId).then(({ recetas }) => {
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

        if (e) { setAvisoBusqueda(e); return; }
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

    const faltaMedico = !medico && !(numJunta.trim() && nombreMedico.trim());

    // Lo entregado en ESTE renglón contra lo que el médico recetó. Negativo
    // significa que se entregó de más, y eso NO es una dispensación total: es un
    // dato que no puede ser. El servidor ya lo rechaza, pero decir «TOTAL» en
    // verde hasta que alguien apriete guardar es una pantalla que miente —
    // reportado con 1 recetado y 3 entregados.
    const pendiente = Number(prescrita) - Number(renglon.cantidad ?? 0);
    const entregoDeMas = Number(prescrita) > 0 && pendiente < 0;

    const puedeGuardar = paciente.trim() && !faltaMedico && Number(prescrita) > 0 && !entregoDeMas;

    const guardar = useCallback(async () => {
        setGuardando(true);
        setError(null);

        // 1. El médico. Si ya se resolvió contra nuestra tabla se reusa; si no,
        //    se guarda con lo que dice la receta.
        let medicoId = medico?.id ?? null;
        if (!medicoId) {
            const { id, error: e1 } = await guardarMedico({
                numeroJunta: numJunta, nombre: nombreMedico, junta,
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
    }, [medico, numJunta, nombreMedico, junta, archivo, branchId, renglon.id,
        paciente, prescrita, fechaReceta, edad, documento, recetaId, notas,
        claveBorrador, onCerrar]);

    return (
        <LiquidModal open onClose={guardando ? undefined : () => onCerrar(false)}
            maxWidth="max-w-2xl" ariaLabel="Completar el renglón del libro">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Completar el folio {renglon.folio_txt}</h3>
                    <p className="text-caption text-content-3 truncate">
                        {fmtFecha(renglon.fecha)}
                        {renglon.correlativo_doc ? ` · documento ${renglon.correlativo_doc}` : ''}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {/* Lo que se entregó, en grande y arriba. Es lo que hay que
                    comparar contra la receta que se tiene en la mano, y estaba
                    en el subtítulo del encabezado —gris, a 10px y truncado—.
                    Reportado: «dame más clara la info, casi no se nota ni se ve». */}
                <div data-surface="card" className="p-3 space-y-2">
                    <p className="text-body-lg font-black text-content leading-snug">
                        {renglon.producto_nombre}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-body font-black text-brand-text tabular-nums">
                            {num(renglon.cantidad)} <span className="text-body-sm font-bold text-content-2">
                                {Number(renglon.cantidad) === 1 ? 'entregada' : 'entregadas'}
                            </span>
                        </span>
                        {renglon.laboratorio && (
                            <span className="text-body-sm text-content-2">{renglon.laboratorio}</span>
                        )}
                        {renglon.lote && (
                            <Badge variant="chart-3" size="sm" uppercase={false}>Lote {renglon.lote}</Badge>
                        )}
                        {renglon.vence && (
                            <Badge variant="neutral" size="sm" uppercase={false}>Vence {fmtVence(renglon.vence)}</Badge>
                        )}
                    </div>
                    <p className="text-label text-content-3">
                        Vendido a {renglon.cliente || 'sin cliente'}
                        {renglon.vendedor ? ` · atendió ${renglon.vendedor}` : ''}
                    </p>
                </div>
                {/* ── ¿Es la segunda entrega de una receta que ya existe? ── */}
                {compatibles.length > 0 && (
                    <div data-surface="card" className="p-3 space-y-2">
                        <p className="text-body-sm font-bold text-content">
                            Hay {compatibles.length === 1 ? 'una receta abierta' : `${compatibles.length} recetas abiertas`} en esta sala
                        </p>
                        <p className="text-label text-content-3">
                            Ligala a la misma receta si es el resto de una entrega que ya se empezó,
                            <strong className="font-bold"> o si es otro medicamento del mismo papel</strong> —
                            una receta con dos medicamentos es UNA receta. De ahí sale que la dispensación
                            sea parcial o total.
                        </p>
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
                    </div>
                )}

                {/* ── Paciente ── */}
                {!clase.sirve && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <span className="font-bold">{clase.titulo}</span>
                        <span className="block mt-0.5 font-normal text-content-2">{clase.aviso}</span>
                        <span className="block mt-1 font-normal text-content-3">
                            La venta quedó a nombre de: {renglon.cliente || 'sin nombre'}
                        </span>
                    </Notice>
                )}

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
                        placeholder="DUI"
                        inputClassName="tabular-nums"
                    />
                </div>

                {/* ── Médico ── */}
                {/* Las tres juntas del Art. 19 de la Ley de Medicamentos y
                    ninguna más: médico, odontólogo y médico veterinario.
                    Enfermería y químico farmacéutico NO prescriben, y ofrecerlas
                    invitaría a registrar una receta que la ley no reconoce. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <p className="text-label font-bold uppercase tracking-widest text-content-3 mb-1.5">
                            Quién recetó
                        </p>
                        <LiquidSelect
                            value={junta} onChange={(v) => { setJunta(v || 'P01'); invalidar(); }}
                            options={JUNTAS_QUE_PRESCRIBEN} clearable={false}
                        />
                    </div>
                    <div>
                        <p className="text-label font-bold uppercase tracking-widest text-content-3 mb-1.5">
                            Cómo buscarlo
                        </p>
                        <SegmentedControl
                            value={modo}
                            onChange={(v) => { setModo(v); invalidar(); }}
                            options={MODOS}
                        />
                    </div>
                </div>

                {!medico && (modo === 'numero' ? (
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
                            Consejo: «JOSE ROBERTO JULE SEGURA» escrito entero en
                            el campo de nombres devuelve CERO resultados, que en
                            pantalla se lee igual que «ese médico no existe». */}
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
                            Nombres y apellidos van separados, como en el registro del Consejo. Con sólo el
                            apellido también busca.
                        </p>
                    </>
                ))}

                {medico && (
                    <Notice variant="success" icon={BadgeCheck}
                        action={(
                            <Button variant="ghost" size="xs" icon={X} onClick={quitarMedico}>
                                Cambiar
                            </Button>
                        )}>
                        <span className="font-bold">{medico.nombre}</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            N.º {medico.numero_junta}
                            {medico.carrera ? ` · ${medico.carrera}` : ''}
                            {medico.verificado_at || medico.delConsejo
                                ? ' · confirmado contra el registro del Consejo'
                                : ' · tomado de una receta'}
                        </span>
                    </Notice>
                )}

                {/* Varios resultados: se elige, no se adivina. Elegir por la
                    máquina el primero de doce sería guardar otro médico con
                    apellido parecido. */}
                {candidatos.length > 0 && !medico && (
                    <div data-surface="card" className="p-3 space-y-2">
                        <p className="text-body-sm font-bold text-content">
                            {candidatos.length} coinciden — elige cuál
                        </p>
                        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                            {candidatos.map((c) => (
                                <li key={`${c.junta}-${c.numero_junta}`}>
                                    <ListRow
                                        surface="row" density="sm"
                                        icon={Stethoscope}
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

                {buscado && !medico && candidatos.length === 0 && (
                    <>
                        <Notice variant="info">
                            <span className="font-bold">No apareció ni en el portal ni en el registro del Consejo.</span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                Escribe el nombre y el número como aparecen en el sello de la receta y queda
                                guardado: la próxima vez que ese médico recete, ya va a estar. La norma pide
                                los datos del prescriptor en la RECETA, y esa receta se está fotografiando.
                            </span>
                        </Notice>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <PortalInput
                                label="Nombre del médico" name="nombre_medico" icon={Stethoscope} required colSpan={2}
                                value={nombreMedico} onChange={(e) => setNombreMedico(e.target.value)}
                                placeholder="Como aparece en el sello"
                                hasError={!nombreMedico.trim()}
                            />
                            <PortalInput
                                label="N.º de junta" name="numero_junta_manual" required
                                value={numJunta} onChange={(e) => setNumJunta(e.target.value)}
                                placeholder="12345" inputClassName="tabular-nums"
                                hasError={!numJunta.trim()}
                            />
                        </div>
                    </>
                )}

                {/* ── Lo prescrito ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PortalInput
                        label="Cuánto recetó el médico" name="prescrita" type="number" inputMode="decimal"
                        step="0.001" min="0" required alto
                        value={prescrita} onChange={(e) => setPrescrita(e.target.value)}
                        inputClassName="tabular-nums"
                        hasError={entregoDeMas}
                        readOnly={Boolean(recetaElegida?.item)}
                    />
                    <div>
                        <p className="text-label font-bold uppercase tracking-widest text-content-3 mb-1.5">
                            Fecha de la receta
                        </p>
                        <LiquidDatePicker value={fechaReceta} onChange={(v) => setFechaReceta(v || '')} />
                    </div>
                </div>

                {/* Parcial o total no se elige: se ve. Y el tercer caso —haber
                    entregado de más— no es un estado de la dispensación: es un
                    error, y por eso corta el guardado en vez de pintarse verde. */}
                {entregoDeMas ? (
                    <Notice variant="danger" icon={AlertTriangle}>
                        <span className="font-bold">
                            Se entregaron {num(renglon.cantidad)} pero la receta dice {num(prescrita)}.
                        </span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            No se puede entregar más de lo recetado. Revisa la receta: si el médico
                            recetó {num(renglon.cantidad)} o más, corregí el número; si de verdad se
                            entregó de más, el renglón se anula y se rehace la venta.
                        </span>
                    </Notice>
                ) : Number(prescrita) > 0 && (
                    <Notice variant={pendiente > 0 ? 'warning' : 'success'}>
                        {pendiente > 0
                            ? `Dispensación PARCIAL — quedan ${num(pendiente)} por entregar de ${num(prescrita)}.`
                            : `Dispensación TOTAL — se entregó todo lo recetado (${num(prescrita)}).`}
                    </Notice>
                )}

                {/* ── La foto ── */}
                <FileField
                    label="Foto de la receta"
                    file={archivo}
                    onChange={(f) => {
                        // Un PDF ya viene de un escáner: no hay nada que
                        // recortar ni aclarar, y meterlo por el editor lo
                        // convertiría en una imagen peor que el original.
                        if (f && f.type?.startsWith('image/')) setPorEditar(f);
                        else setArchivo(f);
                    }}
                    accept="image/*,application/pdf"
                    maxSizeMB={10}
                    hint="Se recorta y se endereza antes de guardarla, y todas salen del mismo tamaño. La norma manda retener una copia por al menos un año."
                />

                {porEditar && (
                    <Suspense fallback={null}>
                        <EditorDeReceta
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
                <Button variant="ghost" onClick={() => onCerrar(false)} disabled={guardando}>
                    Cancelar
                </Button>
                <Button variant="primary" icon={Camera} onClick={guardar}
                    loading={guardando} disabled={!puedeGuardar}>
                    Guardar en el libro
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
