import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, Camera, Search, Stethoscope, User } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import FileField from '../common/FileField';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import {
    CLASE_CLIENTE, buscarMedicoLocal, completarRenglon, fetchRecetasAbiertas,
    guardarMedico, subirFotoDeReceta,
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
// ═══════════════════════════════════════════════════════════════════════════

const JUNTAS = [
    { value: 'P01', label: 'Junta Médica' },
    { value: 'P02', label: 'Junta Odontológica' },
    { value: 'P03', label: 'Junta de Enfermería' },
    { value: 'P06', label: 'Junta Químico Farmacéutica' },
    { value: 'P07', label: 'Junta Médico Veterinario' },
];

const num = (v) => (v === null || v === undefined ? '—' : String(Number(v)));

export default function CompletarRenglon({ renglon, branchId, onCerrar }) {
    const clase = CLASE_CLIENTE[renglon.clase_cliente] || CLASE_CLIENTE.sin_ficha;

    const [paciente, setPaciente] = useState(() => (clase.sirve ? (renglon.cliente || '') : ''));
    const [edad, setEdad]         = useState('');
    const [documento, setDocumento] = useState('');

    const [junta, setJunta]       = useState('P01');
    const [numJunta, setNumJunta] = useState('');
    const [medico, setMedico]     = useState(null);      // el resuelto
    const [nombreMedico, setNombreMedico] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [buscado, setBuscado]   = useState(false);     // ya se buscó este número

    const [prescrita, setPrescrita] = useState(() => String(Number(renglon.cantidad ?? 0)));
    const [fechaReceta, setFechaReceta] = useState(renglon.fecha || '');
    const [recetaId, setRecetaId] = useState(null);
    const [abiertas, setAbiertas] = useState([]);

    const [archivo, setArchivo]   = useState(null);
    const [notas, setNotas]       = useState('');
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

    // Sólo las que tienen pendiente de ESTE medicamento: ofrecer una receta de
    // otro producto invita a ligar cosas que no van juntas.
    const compatibles = useMemo(() => abiertas.filter(r =>
        (r.items || []).some(i => i.erp_product_id === renglon.erp_product_id
            && Number(i.entregado) < Number(i.prescrito))), [abiertas, renglon.erp_product_id]);

    const buscarMedico = useCallback(async () => {
        const n = numJunta.trim();
        if (!n) return;
        setBuscando(true);
        setError(null);
        const { medico: m } = await buscarMedicoLocal(n, junta);
        setBuscando(false);
        setBuscado(true);
        if (m) { setMedico(m); setNombreMedico(m.nombre); }
        else   { setMedico(null); setNombreMedico(''); }
    }, [numJunta, junta]);

    // Cambiar el número invalida lo encontrado: si no, se guardaría el médico
    // anterior con el número nuevo.
    const cambiarNumero = useCallback((v) => {
        setNumJunta(v);
        setMedico(null);
        setBuscado(false);
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
        const item = (r.items || []).find(i => i.erp_product_id === renglon.erp_product_id);
        if (item) setPrescrita(String(Number(item.prescrito)));
        setPaciente(r.paciente || '');
        if (r.medico_id) {
            setMedico({ id: r.medico_id, nombre: r.medico });
            setNombreMedico(r.medico || '');
        }
    }, [compatibles, renglon.erp_product_id]);

    const faltaMedico = !medico && !(numJunta.trim() && nombreMedico.trim());
    const puedeGuardar = paciente.trim() && !faltaMedico && Number(prescrita) > 0;

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
        onCerrar(true);
    }, [medico, numJunta, nombreMedico, junta, archivo, branchId, renglon.id,
        paciente, prescrita, fechaReceta, edad, documento, recetaId, notas, onCerrar]);

    const pendiente = Number(prescrita) - Number(renglon.cantidad ?? 0);

    return (
        <LiquidModal open onClose={guardando ? undefined : () => onCerrar(false)}
            maxWidth="max-w-2xl" ariaLabel="Completar el renglón del libro">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Completar el folio {renglon.folio_txt}</h3>
                    <p className="text-caption text-content-3 truncate">
                        {renglon.producto_nombre} · {num(renglon.cantidad)} entregadas
                        {renglon.lote ? ` · lote ${renglon.lote}` : ''}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {/* ── ¿Es la segunda entrega de una receta que ya existe? ── */}
                {compatibles.length > 0 && (
                    <div data-surface="card" className="p-3 space-y-2">
                        <p className="text-body-sm font-bold text-content">
                            Hay {compatibles.length === 1 ? 'una receta abierta' : `${compatibles.length} recetas abiertas`} de este medicamento
                        </p>
                        <p className="text-label text-content-3">
                            Si esta entrega es el resto de una receta que ya se empezó, ligala a la misma
                            en vez de crear una nueva: de ahí sale que la dispensación sea parcial o total.
                        </p>
                        <LiquidSelect
                            value={recetaId ? String(recetaId) : ''}
                            onChange={elegirReceta}
                            options={compatibles.map(r => ({
                                value: String(r.id),
                                label: `${r.correlativo_txt} · ${r.paciente}`,
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
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    <div className="sm:col-span-2">
                        <LiquidSelect
                            label="Junta"
                            value={junta} onChange={(v) => { setJunta(v || 'P01'); setBuscado(false); setMedico(null); }}
                            options={JUNTAS} clearable={false}
                        />
                    </div>
                    <PortalInput
                        label="N.º de junta" name="numero_junta" icon={Stethoscope} required
                        value={numJunta} onChange={(e) => cambiarNumero(e.target.value)}
                        placeholder="12345" inputClassName="tabular-nums"
                    />
                    <Button variant="secondary" icon={Search} onClick={buscarMedico}
                        loading={buscando} disabled={!numJunta.trim()}>
                        Buscar
                    </Button>
                </div>

                {medico && (
                    <Notice variant="success" icon={BadgeCheck}>
                        <span className="font-bold">{medico.nombre}</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            N.º {medico.numero_junta}
                            {medico.carrera ? ` · ${medico.carrera}` : ''}
                            {medico.verificado_at ? ' · confirmado contra el registro del Consejo' : ' · tomado de una receta'}
                        </span>
                    </Notice>
                )}

                {buscado && !medico && (
                    <>
                        <Notice variant="info">
                            <span className="font-bold">Ese número todavía no está en el registro del portal.</span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                Escribe el nombre como aparece en el sello de la receta y queda guardado:
                                la próxima vez que ese médico recete, ya va a estar.
                            </span>
                        </Notice>
                        <PortalInput
                            label="Nombre del médico" name="nombre_medico" icon={Stethoscope} required
                            value={nombreMedico} onChange={(e) => setNombreMedico(e.target.value)}
                            placeholder="Como aparece en el sello"
                            hasError={!nombreMedico.trim()}
                        />
                    </>
                )}

                {/* ── Lo prescrito ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PortalInput
                        label="Cuánto recetó el médico" name="prescrita" type="number" inputMode="decimal"
                        step="0.001" min="0" required alto
                        value={prescrita} onChange={(e) => setPrescrita(e.target.value)}
                        inputClassName="tabular-nums"
                        helperText={`En este renglón se entregaron ${num(renglon.cantidad)}`}
                        readOnly={Boolean(recetaElegida)}
                    />
                    <PortalInput
                        label="Fecha de la receta" name="fecha_receta" type="date"
                        value={fechaReceta} onChange={(e) => setFechaReceta(e.target.value)}
                    />
                </div>

                {/* Parcial o total no se elige: se ve. */}
                {Number(prescrita) > 0 && (
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
                    onChange={setArchivo}
                    accept="image/*,application/pdf"
                    maxSizeMB={10}
                    hint="La norma manda retener una copia de la receta por al menos un año."
                />

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
