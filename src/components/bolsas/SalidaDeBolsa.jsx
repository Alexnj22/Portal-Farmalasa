import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense, useRef } from 'react';
import useBorrador from '../../hooks/useBorrador';
import { AlertTriangle, ArrowLeft, ArrowRight, HandCoins, Package, ScanLine } from 'lucide-react';
import Button from '../common/Button';
import FileField from '../common/FileField';
import IdentidadDeQuienRetira from './IdentidadDeQuienRetira';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import {
    boletaYaRegistrada, fetchEntidadesDeSalida, fetchTiposDeSalida,
    guardarLecturaDeBoleta, leerBoleta, registrarSalida, subirComprobante,
} from '../../data/bolsas';
import { disponibles, elegirBolsas, totalDisponible } from '../../utils/bolsasReparto';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';

/* El editor de la foto se baja al elegir el archivo, no al abrir el formulario:
 * arrastra el canónico de recorte, y la mayoría de las salidas del día no piden
 * foto (`bolsas_tipos_salida.foto = 'NO'`). */
const EditorDeDocumento = lazy(() => import('../common/EditorDeDocumento'));

/**
 * Sacar dinero de una bolsa — el «Entrega de remesas» que pidió el usuario.
 *
 * ── El portal elige la bolsa, no la persona ────────────────────────────────
 * Regla del usuario: **la más vieja que alcance sola**. Se muestra cuál eligió y
 * cuánto va a quedarle, porque el papel que va a entrar a esa bolsa dice
 * exactamente eso. Sólo combina cuando ninguna alcanza, y entonces lo avisa: dos
 * vales en dos bolsas no es lo mismo que uno. La cuenta vive en
 * `utils/bolsasReparto` para poder probarla.
 *
 * ── El formulario sale del CATÁLOGO ────────────────────────────────────────
 * Qué campos exige cada motivo son datos (`bolsas_tipos_salida`), no `if`s
 * escritos acá: una remesa pide remesadora, boleta y foto; un anticipo no pide
 * ninguno. Escrito a mano, un motivo nuevo aparecería en la base y no en la
 * pantalla.
 *
 * Y desde el 2026-08-17 **las opciones de ese campo también** salen de una tabla
 * (`bolsas_entidades`): las ocho remesadoras con las que trabaja la sala. Un
 * campo libre recibía la misma remesadora escrita de tres formas y después no
 * había con qué agruparlas. El motivo que no tiene lista —«Pago a proveedor»—
 * sigue siendo un campo libre: lo decide el catálogo, no un `if` acá.
 *
 * ── La foto tiene TRES estados, no dos (2026-08-19) ────────────────────────
 * `bolsas_tipos_salida.foto` es `NO` / `OPCIONAL` / `OBLIGATORIA`. Con un
 * booleano, «pago a proveedor» no se podía registrar: exigía una foto que a
 * veces no existe —«a veces no deja el DTE»— y quitarle la exigencia habría
 * dejado también las que sí llegan sin dónde ponerlas. Lo mismo con una compra
 * urgente: cuando el efectivo sale de la bolsa, la compra todavía no se hizo.
 *
 * ── Quien retira el efectivo se IDENTIFICA en un paso propio ───────────────
 * El bloque es `IdentidadDeQuienRetira`, el MISMO de la entrega del efectivo,
 * por pedido del usuario: «debe salir como sale en entrega de efectivo, el
 * lector o usuario / contraseña». Antes acá había un desplegable con la nómina
 * y un campo de contraseña — la pregunta contestada dos veces, porque el carné
 * ya dice de quién es.
 *
 * Y va en un **segundo paso**, no debajo del formulario, por una razón concreta:
 * el detector del lector es un `keydown` global que no cancela la tecla, así que
 * una ráfaga con el foco puesto en «detalle» escribiría el carné dentro del
 * `<textarea>`, a la vista. En el paso de identidad no hay ningún campo de
 * texto. De paso, la pantalla queda igual que la de la entrega.
 *
 * No todos los motivos lo piden. Una remesa no: quien recibe es el cliente y lo
 * identifica la boleta del POS. Un pago a proveedor tampoco, y eso lo decidió el
 * usuario el 2026-08-19 — «quien se lleva el efectivo no debe salir, porque no
 * es de la empresa»: el cobrador no tiene cuenta en el portal, así que pedirle
 * carné era pedir algo que no existe.
 */

const hhmm = (hora) => String(hora || '').slice(0, 5);
// El mediodía en UTC y no la fecha pelada: `2026-08-15` interpretado como
// medianoche se corre un día para atrás con el huso de la sala.
const fechaCorta = (f) => (f ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
}) : '');

/**
 * «el monto», «el monto y el número», «el monto, el número y la remesadora».
 *
 * Existe para el aviso de lo que llenó la foto. Con `join(', ')` la lista de
 * tres se lee como una enumeración de máquina; la coma final antes del último
 * es lo que la vuelve una frase.
 */
const juntarConY = (partes) => (
    partes.length <= 1 ? (partes[0] || '')
        : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
);

/**
 * Un nombre de comercio comparable: sin tildes, sin puntuación, en mayúsculas.
 *
 * Es la MISMA `norm` que usa la edge function `leer-boleta` para decidir si la
 * boleta nombra a la entidad. Escrita dos veces porque viven en dos runtimes
 * —y no hay un módulo compartido entre `src/` y `supabase/functions/`— pero es
 * una sola regla: si una se cambia, la otra queda diciendo algo distinto sobre
 * el mismo papel.
 */
const normalizarNombre = (v) => String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * Cómo se cuenta que la boleta no nombra a la entidad que se eligió.
 *
 * En un solo lugar porque lo dicen dos caminos —el aviso nuevo del servidor y
 * el veredicto viejo que puede venir de una respuesta en vuelo— y dos textos
 * para el mismo hecho se separan el día que alguien mejora uno.
 *
 * `warning` y no `danger`: no es un error de quien lo registra. La boleta de
 * una remesa la imprime el POS y arriba lleva el banco que procesa el cobro
 * —«BANCO PROMERICA»—, así que muchas no nombran a la remesadora en absoluto.
 * Lo que prueba que la foto es de ESTA operación son el monto y el número, y
 * ésos sí frenan.
 */
function avisoDeEntidad(leido, entidad) {
    return {
        tono: 'warning', bloquea: false,
        texto: `La boleta dice ${leido.entidad || 'otro nombre'} y no nombra a ${entidad.trim()}. `
             + 'Si es la boleta correcta, puedes guardarla: el monto y el número sí coinciden.',
    };
}

export default function SalidaDeBolsa({ abierto, bolsas, saldos, onClose, onHecho }) {
    const { user } = useAuth();
    const showToast = useToastStore((s) => s.showToast);

    const [tipos, setTipos] = useState([]);
    const [entidades, setEntidades] = useState([]);
    const [tipo, setTipo] = useState('');
    const [monto, setMonto] = useState('');
    const [entidad, setEntidad] = useState('');
    const [boleta, setBoleta] = useState('');
    const [nota, setNota] = useState('');
    const [foto, setFoto] = useState(null);
    // La foto recién elegida, en camino al editor. Ver la nota del `FileField`.
    const [porEditar, setPorEditar] = useState(null);
    // Qué dijo el lector de la foto: `{ leido, coincide, veredicto }` cuando
    // contestó, `{ error }` cuando no se pudo preguntar, `null` mientras lee.
    const [lectura, setLectura] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    /* Qué campos puso la FOTO y no la persona. Sirve para dos cosas: decirlo en
     * pantalla —nadie confía en un campo que se llenó solo si no sabe de dónde
     * salió— y para no volver a pisarlos si se elige otra foto. */
    const [deLaFoto, setDeLaFoto] = useState([]);
    /* Con qué operación choca el número de boleta, si choca con alguna. */
    const [repetida, setRepetida] = useState([]);
    // 'FORMULARIO' → 'IDENTIDAD'. El segundo paso sólo existe para los motivos
    // que piden receptor.
    const [paso, setPaso] = useState('FORMULARIO');
    const [persona, setPersona] = useState(null);
    const [vale, setVale] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    /* ── La salida a medio escribir se guarda sola ───────────────────────────
     *
     * Registrar una salida es elegir el motivo, escribir el monto, la entidad,
     * el número de boleta y una nota — y cada motivo pide lo suyo. La sesión de
     * los cargos de sala se cierra sola a los 5 minutos, así que un formulario a
     * medio llenar se perdía entero.
     *
     * **La foto NO entra.** Es un `File` sin subir: no se serializa, y guardar
     * su nombre sin el contenido prometería un comprobante que al recuperar no
     * está — justo el dato que administración usa para dar la salida por buena.
     * Tampoco entra la LECTURA de esa foto, que se deriva de ella.
     *
     * El paso tampoco se guarda: se vuelve a «FORMULARIO» a propósito. Reponer
     * a alguien en la pantalla de confirmación sobre datos que no revisó en esta
     * sesión es pedirle que confirme a ciegas un movimiento de dinero. */
    const { recuperado, descartar } = useBorrador(
        'salida_de_bolsa', { tipo, monto, entidad, boleta, nota }, { activo: abierto },
    );

    const repuesto = useRef(false);
    useEffect(() => {
        if (!abierto) { repuesto.current = false; return; }
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        if (recuperado.tipo) setTipo(recuperado.tipo);
        if (recuperado.monto) setMonto(recuperado.monto);
        if (recuperado.entidad) setEntidad(recuperado.entidad);
        if (recuperado.boleta) setBoleta(recuperado.boleta);
        if (recuperado.nota) setNota(recuperado.nota);
    }, [abierto, recuperado]);

    useEffect(() => {
        if (!abierto) return;
        // El motivo NO viene elegido de fábrica. Elegirlo por alguien mostraba
        // «Remesadora», «Número de boleta» y «Foto del comprobante» sobre una
        // decisión que nadie tomó —la más común no es la única—, y un motivo
        // preseleccionado se registra sin mirarlo. El panel se arma DESPUÉS de
        // la selección: hasta que no hay motivo, no hay campos de motivo.
        fetchTiposDeSalida().then(setTipos);
        fetchEntidadesDeSalida().then(setEntidades);

        // ── El motor de impresión se baja ANTES de escribir ─────────────────
        // Los dos papeles se arman con `import()` y eso los deja atados a un
        // chunk del servidor. Tras un despliegue, el chunk con el hash viejo ya
        // no existe: el `import()` falla, `main.jsx` recarga la página para
        // tomar el bundle nuevo, y la recarga pasa JUSTO DESPUÉS de registrar la
        // salida — el dinero queda escrito y ni el vale ni la etiqueta salen.
        // Pasó el 17-ago-2026 con la remesa REM-1000: el portal se recargó un
        // segundo después de escribir y la bolsa se quedó sin su vale adentro.
        // Bajarlo al ABRIR el diálogo no evita el chunk muerto —eso no se puede
        // desde acá—, lo adelanta a un momento en que recargar no cuesta nada.
        import('../../utils/ticketPrint').catch(() => {});
        import('../../utils/bolsaComprobante').catch(() => {});
    }, [abierto]);

    // Al cerrar se olvida TODO, y el vale el primero: es un permiso de un solo
    // uso que vive 5 minutos. El motivo también: si sobrevive, la próxima
    // apertura muestra los campos de la salida anterior y vuelve a ser una
    // decisión que nadie tomó.
    useEffect(() => {
        if (abierto) return;
        setTipo(''); setMonto(''); setEntidad(''); setBoleta(''); setNota(''); setFoto(null);
        setDeLaFoto([]); setRepetida([]);
        setPaso('FORMULARIO'); setPersona(null); setVale(null); setError(null);
    }, [abierto]);

    const t = useMemo(() => tipos.find((x) => x.codigo === tipo) || null, [tipos, tipo]);

    /** Las opciones del campo «entidad» de ESTE motivo. Vacío = campo libre. */
    const opciones = useMemo(
        () => entidades.filter((e) => e.tipo === tipo).map((e) => ({ value: e.nombre, label: e.nombre })),
        [entidades, tipo],
    );

    // Cambiar de motivo VACÍA la entidad. Sin esto, elegir «Remesa · RIA» y
    // corregir a «Pago a proveedor» dejaba a RIA escrita como proveedor: el
    // campo se llama igual en los dos, pero el dato no es el mismo. Y suelta la
    // identidad comprobada por lo mismo: el vale se emitió para la operación que
    // se estaba armando, no para otra. Va en el manejador y no en un efecto
    // sobre `tipo`: los dos cambian a la vez y son la misma decisión de quien
    // usa la pantalla.
    /* Cambiar de motivo borra TODO lo que dependía del motivo anterior.
     *
     * La entidad y la identidad ya se limpiaban. La foto no, y desde que la
     * foto llena el monto y el número eso dejó de ser un descuido menor: elegir
     * «Remesa», fotografiar la boleta y después cambiar a «Gasto» dejaba en el
     * formulario el monto y el número de una boleta que ya no pertenece a esta
     * salida — y el vale se habría impreso con ellos. Lo que la foto trajo se va
     * con la foto. */
    const elegirMotivo = useCallback((codigo) => {
        setTipo(codigo); setEntidad(''); setPersona(null); setVale(null);
        setFoto(null); setPorEditar(null); setLectura(null);
        setBoleta(''); setRepetida([]);
        // El monto sólo si lo había puesto la foto: uno escrito a mano es una
        // decisión de la persona y sobrevive al cambio de motivo, como siempre.
        setDeLaFoto((puestos) => {
            if (puestos.includes('el monto')) setMonto('');
            return [];
        });
    }, []);

    const lista = useMemo(() => disponibles(bolsas, saldos), [bolsas, saldos]);

    /* ── Cuándo la FOTO viene antes que los datos ───────────────────────────
     *
     * Reportado el 2026-08-21 mirando el formulario de una remesa: «¿por qué
     * sigue pidiendo la boleta y el monto? Normalmente sólo debe pedir
     * remesadora y foto, los demás datos los obtiene de la foto».
     *
     * Tenía razón y el orden estaba al revés: el formulario pedía a mano
     * —«Falta cuánto»— justo los dos datos que la foto iba a contestar sola. Un
     * campo obligatorio antes del papel que lo contiene es pedir dos veces lo
     * mismo, y encima frenaba el botón antes de dejar elegir la foto.
     *
     * Manda la foto cuando el motivo la exige Y pide número de boleta — o sea,
     * cuando hay un comprobante impreso con esos datos adentro. Sale del
     * catálogo (`bolsas_tipos_salida`) y no de un `if (tipo === 'REMESA')`: el
     * día que otro motivo pida boleta con foto obligatoria, se comporta igual
     * sin tocar esto. Hoy es sólo la remesa.
     */
    const laFotoManda = t?.foto === 'OBLIGATORIA' && !!t?.pide_boleta;

    /* Si ya se puede mostrar lo que la foto tenía que traer.
     *
     * `lectura` deja de ser null en cuanto el servidor contesta, HAYA PODIDO
     * leer o no. Las dos cosas abren los campos, y por el mismo motivo: si leyó,
     * aparecen con el dato puesto para confirmarlo; si no pudo, aparecen vacíos
     * para escribirlo. Eso es la mitad «si tiene dudas, que sí pida esos datos»
     * del pedido — la persona nunca queda sin forma de registrar la salida. */
    const datosALaVista = !laFotoManda || !!lectura;

    /* De qué sala es esta salida. La numeración de las boletas es por sucursal,
     * así que sin esto no hay contra qué comparar. Sale de las bolsas que se
     * están mirando —todas las de este diálogo son de la misma sala— y no de la
     * elección, que todavía no existe cuando alguien está escribiendo. */
    const salaId = bolsas?.[0]?.branch_id ?? null;
    /* El campo VACÍO no es un monto — y hay que decirlo, porque `Number('')` es
     * **0** y no `NaN`.
     *
     * Con la foto mandando, el campo está vacío justo cuando se elige la foto:
     * ese 0 viajaba como «lo que se espera que diga la boleta», el servidor
     * comparaba los $100.00 del papel contra 0 y devolvía MONTO_NO_COINCIDE —
     * que FRENA el registro—. Y para cuando el aviso se pintaba, la misma
     * lectura ya había escrito el 100 en el campo, así que el cartel rojo decía
     * la frase imposible que reportó el usuario el 2026-08-21: «la boleta dice
     * $100.00 y la salida es de $100.00». O sea que toda remesa que se leyera
     * bien quedaba trabada, y el motivo no se podía deducir de lo que se veía.
     *
     * `NaN` es lo correcto acá y no un 0 de cortesía: «no hay monto escrito» no
     * es «hay un monto y vale cero». `falta` ya exige `n > 0` y `elegirBolsas`
     * recibe 0 cuando no es finito, así que el resto no cambia. */
    const n = String(monto).trim() === '' ? NaN : Number(String(monto).trim().replace(',', '.'));
    const eleccion = useMemo(
        () => elegirBolsas(lista, Number.isFinite(n) ? n : 0),
        [lista, n],
    );

    /**
     * Al elegir la foto: primero se LEE, después se abre el editor.
     *
     * En ese orden porque la misma lectura devuelve el recuadro del papel, y el
     * editor abre con ese recorte ya puesto — la persona lo confirma en vez de
     * encuadrar a mano. Si la lectura falla, el editor abre igual y sin recorte
     * sugerido: no poder leer no puede impedir preparar la foto.
     *
     * Se lee la foto CRUDA, antes de recortar: es la que tiene el recuadro que
     * hay que devolver, y recortar primero volvería el recuadro un sinsentido.
     */
    const alElegirFoto = useCallback(async (f) => {
        if (!f) { setFoto(null); setLectura(null); setDeLaFoto([]); return; }
        setLeyendo(true);
        setLectura(null);
        const r = await leerBoleta(f, {
            entidad: entidad.trim() || null,
            numeroBoleta: boleta.trim() || null,
            monto: Number.isFinite(n) ? n : null,
        });
        setLeyendo(false);
        setLectura(r);

        /* ── Lo que la boleta dice, escrito en el formulario ────────────────
         *
         * Pedido del usuario (2026-08-21): «que se autoguarde esos datos, que
         * no necesite digitar por el usuario a no ser que no se distinga
         * bien». La foto ya viaja para verificarse, así que los datos ya están
         * leídos: hacerlos escribir a mano es pedir dos veces lo mismo.
         *
         * Sólo se llena lo que está VACÍO. Un campo que la persona escribió no
         * se pisa nunca — si difiere de la boleta, eso es justamente lo que el
         * veredicto tiene que decir, y pisarlo haría que coincidieran siempre
         * y la verificación dejaría de verificar nada.
         *
         * Y lo que no se pudo leer se queda vacío: ahí sí hay que digitarlo,
         * que es la mitad «a no ser que no se distinga bien» del pedido. */
        const l = r?.leido || {};
        const puestos = [];
        if (l.es_boleta) {
            if (!monto.trim() && Number.isFinite(Number(l.monto)) && Number(l.monto) > 0) {
                setMonto(String(l.monto));
                puestos.push('el monto');
            }
            if (!boleta.trim() && l.numero_boleta) {
                setBoleta(String(l.numero_boleta));
                puestos.push('el número');
            }
            /* La entidad SÓLO si lo leído es una de las de la lista.
             *
             * Es el único campo que no se puede copiar tal cual: arriba de la
             * boleta suele ir el banco del POS —«BANCO PROMERICA»—, que no es
             * la remesadora, así que escribirlo pondría en el vale una entidad
             * que no atendió la operación. Se busca la remesadora entre TODOS
             * los nombres que el lector encontró en el papel, y si ninguno
             * está en la lista, el campo se queda vacío. */
            if (!entidad.trim() && opciones.length) {
                const impresos = [l.entidad, ...(Array.isArray(l.nombres) ? l.nombres : [])];
                const acierto = opciones.find((o) =>
                    impresos.some((nom) => normalizarNombre(nom) && (
                        normalizarNombre(nom) === normalizarNombre(o.value)
                        || normalizarNombre(nom).includes(normalizarNombre(o.value))
                        || normalizarNombre(o.value).includes(normalizarNombre(nom))
                    )));
                if (acierto) {
                    setEntidad(acierto.value);
                    puestos.push(t?.etiqueta_entidad?.toLowerCase() || 'la entidad');
                }
            }
        }
        setDeLaFoto(puestos);

        setPorEditar(f);
    }, [entidad, boleta, monto, n, opciones, t]);

    /**
     * Qué pasa con lo que dijo el lector, dicho en una frase.
     *
     * Devuelve `null` cuando no hay nada que decir. Los tres casos son
     * distintos y la pantalla los separa: la boleta no cuadra (se arregla
     * sacando otra foto o corrigiendo el dato), no se pudo leer (se arregla
     * reintentando), o todo bien.
     */
    const problemaDeLaFoto = useMemo(() => {
        if (!foto || !lectura) return null;
        if (lectura.error) {
            return {
                tono: 'warning', bloquea: true, reintentable: true,
                texto: 'No se pudo revisar la foto. Vuelve a elegirla para intentar de nuevo.',
            };
        }
        const l = lectura.leido || {};
        switch (lectura.veredicto) {
            case 'OK': return null;
            case 'NO_ES_BOLETA':
                return { tono: 'danger', bloquea: true,
                    texto: `La foto no parece la boleta${l.motivo ? `: ${l.motivo}` : '.'}` };
            case 'ILEGIBLE':
                return { tono: 'danger', bloquea: true,
                    texto: 'La boleta no se lee en la foto. Acércate, sostén el papel plano y evita el reflejo.' };
            case 'MONTO_NO_COINCIDE':
                return { tono: 'danger', bloquea: true,
                    texto: `La boleta dice ${l.monto != null ? formatMoney(l.monto) : 'otro monto'} y la salida es de ${formatMoney(n)}.` };
            case 'BOLETA_NO_COINCIDE':
                return { tono: 'danger', bloquea: true,
                    texto: `El número de la boleta de la foto es ${l.numero_boleta || 'otro'} y aquí dice ${boleta.trim()}.` };
            // Se dice, pero NO frena. La boleta de una remesa la imprime el
            // POS y arriba lleva el banco que procesa el cobro —«BANCO
            // PROMERICA»—, no la remesadora: reportado el 2026-08-21, una
            // remesa real quedó trabada por eso. Desde entonces el servidor lo
            // manda en `avisos` y el veredicto ya no lo usa; este caso queda
            // por las respuestas viejas que puedan estar en vuelo, para que
            // tampoco frenen.
            case 'ENTIDAD_NO_COINCIDE':
                return avisoDeEntidad(l, entidad);
            default:
                return null;
        }
    }, [foto, lectura, n, boleta, entidad]);

    /* Si el servidor llegó a comparar ALGO contra lo escrito.
     *
     * `coincide.X` viene en `null` cuando el campo iba vacío: no es «no
     * coincide», es «no había contra qué». Sin esto, un formulario en blanco
     * más una foto daba veredicto OK y el cartel verde afirmaba una
     * verificación que nunca ocurrió. */
    const seComparoAlgo = useMemo(
        () => Object.values(lectura?.coincide || {}).some((v) => v === true),
        [lectura],
    );

    /* Qué de lo que la foto tenía que traer sigue vacío.
     *
     * Se calcula sobre los CAMPOS y no sobre lo que devolvió el lector: da igual
     * si el modelo no lo vio, si la lectura falló entera o si alguien lo borró
     * — el hecho que importa es que ese dato no está y hay que escribirlo. */
    const faltaLeer = useMemo(() => {
        if (!laFotoManda || !lectura) return [];
        return [
            !monto.trim() && 'el monto',
            !boleta.trim() && 'el número',
        ].filter(Boolean);
    }, [laFotoManda, lectura, monto, boleta]);

    // Lo que el bloqueo le dice a la lista de «qué falta».
    const bloqueoDeLaFoto = problemaDeLaFoto?.bloquea ? problemaDeLaFoto.texto : null;

    /* El aviso que NO frena: la boleta no nombra a la entidad elegida.
     *
     * Va en su propia variable y no dentro de `problemaDeLaFoto` a propósito:
     * los dos se pintan igual —un aviso bajo el campo de la foto— pero uno
     * detiene el guardado y el otro no, y mezclarlos es exactamente cómo se
     * pierde esa diferencia la próxima vez que alguien toque este bloque. */
    const avisoDeLaFoto = useMemo(() => {
        if (!foto || !lectura || lectura.error || problemaDeLaFoto) return null;
        const hay = (lectura.avisos || []).some((a) => a.campo === 'entidad');
        return hay ? avisoDeEntidad(lectura.leido || {}, entidad) : null;
    }, [foto, lectura, problemaDeLaFoto, entidad]);

    /* ── ¿Esta boleta ya se registró en esta sala? ───────────────────────────
     *
     * Pedido del usuario (2026-08-21): «se debe validar que sea correcta, que
     * no se repita (lleva numeracion por sucursal)».
     *
     * Se pregunta mientras se escribe y no al guardar, porque el número puede
     * venir de la foto: enterarse al apretar el botón obligaría a rehacer el
     * formulario entero. La garantía dura NO es esto —es el índice único
     * `bolsas_oper_boleta_unica`, que también gana la carrera de dos personas
     * registrando a la vez—; esto es lo que permite DECIRLO con folio y monto,
     * que un error de restricción no puede.
     *
     * El pequeño retardo evita preguntar por cada tecla de un número que se
     * está escribiendo: `0`, `00`, `000`… son seis consultas para una boleta.
     */
    useEffect(() => {
        const num = boleta.trim();
        if (!num || !salaId) { setRepetida([]); return; }
        let vivo = true;
        const id = setTimeout(() => {
            boletaYaRegistrada(salaId, num).then((filas) => {
                if (vivo) setRepetida(filas);
            });
        }, 400);
        return () => { vivo = false; clearTimeout(id); };
    }, [boleta, salaId]);

    /**
     * Qué pasa si el número ya está usado. Dos desenlaces, y no son el mismo.
     *
     * Mismo tipo y misma entidad es **la misma boleta**: registrarla otra vez
     * sacaría el dinero dos veces por una sola operación, así que frena. Y
     * frena acá además de en la base porque un error de índice único no se le
     * puede mostrar a nadie: no dice cuál era ni de cuánto.
     *
     * Otra entidad es otra cosa: cada red de remesas lleva su propio
     * correlativo y dos pueden dar el mismo número el mismo día sin que nadie
     * se equivoque. Eso se avisa y quien registra decide — frenarlo sería
     * repetir el bug de la entidad que se arregló hoy, esta vez desde el otro
     * lado.
     */
    const problemaDeLaBoleta = useMemo(() => {
        if (!repetida.length) return null;
        const mismaEnt = repetida.find((o) => o.tipo === tipo
            && normalizarNombre(o.entidad) === normalizarNombre(entidad));
        const o = mismaEnt || repetida[0];
        const cuando = fechaCorta(String(o.registrado_at || '').slice(0, 10));
        if (mismaEnt) {
            return {
                tono: 'danger', bloquea: true,
                texto: `La boleta ${o.numero_boleta} de ${o.entidad} ya se registró en esta sala `
                     + `el ${cuando} por ${formatMoney(o.monto)} (${o.folio}).`,
            };
        }
        return {
            tono: 'warning', bloquea: false,
            texto: `Ese número ya lo usó una boleta de ${o.entidad || 'otra entidad'} el ${cuando} `
                 + `(${o.folio}). Si son dos boletas distintas, puedes seguir.`,
        };
    }, [repetida, tipo, entidad]);

    /** Lo que falta ANTES de identificar a nadie. */
    const faltaEnElFormulario = useMemo(() => {
        if (!t) return 'Falta el motivo.';
        /* Con la foto mandando, lo primero que falta es la foto — y antes, a
         * quién se le entregó, que es lo único que el papel no dice. Pedir
         * «Falta cuánto» acá arriba era pedir a mano justo lo que la foto trae,
         * y frenaba el botón antes de dejar elegirla. */
        if (laFotoManda) {
            if (!entidad.trim()) return `Falta ${t.etiqueta_entidad.toLowerCase()}.`;
            if (!foto) return 'Falta la foto del comprobante.';
        }
        if (!Number.isFinite(n) || n <= 0) return 'Falta cuánto.';
        if (!eleccion.alcanza) {
            return `En la sala hay ${formatMoney(totalDisponible(lista))} en bolsas: no alcanza.`;
        }
        if (t.etiqueta_entidad && !entidad.trim()) return `Falta ${t.etiqueta_entidad.toLowerCase()}.`;
        if (t.pide_boleta && !boleta.trim()) return 'Falta el número de boleta.';
        if (t.foto === 'OBLIGATORIA' && !foto) return 'Falta la foto del comprobante.';
        // Decisión del usuario (2026-08-20): sin una boleta que cuadre, no se
        // registra. Va acá y no en un aviso aparte para que sea la MISMA lista
        // que ya frena el botón — un segundo camino para frenar se olvida de
        // frenar el día que alguien agrega un paso.
        if (bloqueoDeLaFoto) return bloqueoDeLaFoto;
        // Y una boleta que ya se registró no se registra de nuevo: sacaría el
        // dinero dos veces por una sola operación.
        if (problemaDeLaBoleta?.bloquea) return problemaDeLaBoleta.texto;
        return null;
    }, [t, n, eleccion, lista, entidad, boleta, foto, bloqueoDeLaFoto, problemaDeLaBoleta, laFotoManda]);

    const falta = useMemo(() => {
        if (faltaEnElFormulario) return faltaEnElFormulario;
        if (t?.pide_receptor && (!persona || !vale)) return 'Falta identificar a quien se lo lleva.';
        return null;
    }, [faltaEnElFormulario, t, persona, vale]);

    const alIdentificar = useCallback(({ persona: p, vale: v }) => {
        setPersona(p);
        setVale(v);
    }, []);

    /** Vuelve a la espera de identidad: el vale de antes ya no sirve para nada. */
    const olvidarLaIdentidad = useCallback(() => {
        setPersona(null);
        setVale(null);
    }, []);

    // Volver a corregir el formulario suelta la identidad. El vale prueba que
    // esa persona estuvo acá llevándose ESTO; si el monto o el motivo cambian,
    // ya no prueba lo mismo. Además vive 5 minutos, así que reusarlo tras una
    // corrección larga fallaría igual, pero recién al guardar.
    const volverAlFormulario = useCallback(() => {
        setPaso('FORMULARIO');
        setPersona(null);
        setVale(null);
        setError(null);
    }, []);

    const guardar = useCallback(async () => {
        if (falta || guardando) return;
        setGuardando(true);
        setError(null);
        try {
            let fotoUrl = null;
            if (foto) {
                fotoUrl = await subirComprobante(foto, {
                    salaId: eleccion.repartos[0] && bolsas.find((b) => b.id === eleccion.repartos[0].bolsa_id)?.branch_id,
                    userId: user?.id,
                });
            }

            const { data, error: err } = await registrarSalida({
                tipo: t.codigo,
                monto: n,
                repartos: eleccion.repartos.map(({ bolsa_id, monto: m }) => ({ bolsa_id, monto: m })),
                entidad, numeroBoleta: boleta, fotoUrl, nota,
                recibidoPor: t.pide_receptor ? persona?.id : null,
                vale: t.pide_receptor ? vale : null,
            });
            if (err) {
                // El vale se gasta en el servidor y vive 5 minutos: si algo
                // falló, el que había ya no vale y hay que volver a escanear.
                if (t.pide_receptor) olvidarLaIdentidad();
                setError(mensajeAmigable(err, 'Vuelve a intentar en un momento.'));
                return;
            }

            // El rastro de la revisión, para que administración pueda ver POR
            // QUÉ el portal dio por buena esa boleta. Falla en silencio a
            // propósito: es auditoría, y la salida ya ocurrió en la realidad.
            if (lectura && !lectura.error) guardarLecturaDeBoleta(data.id, lectura);

            // El dinero ya salió: el borrador se descarta ACÁ, antes de cerrar.
            descartar();
            showToast?.('Salida registrada', `${data.folio} · ${formatMoney(n)}`, 'success');
            onHecho?.(data, eleccion.repartos);
            onClose?.();
        } catch (e) {
            if (t?.pide_receptor) olvidarLaIdentidad();
            setError(mensajeAmigable(e, 'No se pudo registrar.'));
        } finally {
            setGuardando(false);
        }
    }, [falta, guardando, foto, eleccion, bolsas, user, t, n, entidad, boleta, nota,
        persona, vale, lectura, olvidarLaIdentidad, showToast, onHecho, onClose, descartar]);

    const enIdentidad = paso === 'IDENTIDAD' && !!t?.pide_receptor;

    /* De dónde sale. Se muestra y no sólo se calcula: el papel que va a entrar a
       esa bolsa dice justamente esto.

       El folio no alcanza para saber CUÁL es sobre la mesa: las bolsas de una
       sala se distinguen por el corte del que nacieron, y eso —día y hora— es lo
       que dice la etiqueta pegada afuera. Pedido del usuario el 2026-08-17. */
    /* ── Los campos que cambian de lugar según quién manda ──────────────────
     *
     * Armados acá y no en el `return` porque el ORDEN depende del motivo: en una
     * remesa la foto va antes que el monto y el número —los trae ella—, y en los
     * demás motivos el monto va primero como siempre. Escribirlos dos veces en
     * las dos ramas es cómo terminan siendo dos campos que se parecen y se
     * comportan distinto. */

    /* Un dato que trajo la boleta: se muestra, no se pide.
     *
     * Misma caja que «Sale de» —el otro bloque de la pantalla que informa en vez
     * de preguntar— para que se lea de un vistazo cuál de los dos es: lo que hay
     * que decidir tiene casilla, lo que el papel ya dijo tiene tarjeta.
     *
     * Y NO se puede escribir encima. Regla del usuario, 2026-08-21: «la única
     * forma en que no quede informativo es si la foto no logra distinguir el
     * monto o boleta». El papel es la verdad de una remesa; si lo que muestra no
     * es lo que dice la boleta, lo que hay que corregir es la FOTO —volver a
     * elegirla vuelve a leer y vuelve a decidir estos campos—, no el número.
     * Una casilla encima del dato leído invita justo a lo contrario: escribir un
     * monto que el comprobante no respalda. */
    const datoDeLaBoleta = (etiqueta, valor) => (
        <div data-surface="card" className="p-3">
            <span className="text-caption font-black uppercase tracking-widest text-content-3 block">
                {etiqueta}
            </span>
            <span className="text-body-lg font-bold tabular-nums text-content truncate block">
                {valor}
            </span>
        </div>
    );

    /* Qué campos los pone la foto. La regla vale para TODO motivo con foto y no
     * sólo para la remesa: si el dato salió del papel, salió del papel. Lo que
     * la lectura NO pudo distinguir no entra acá —se queda en casilla vacía—,
     * que es el único caso en que estos dos campos se escriben a mano. */
    const montoLoTrajoLaFoto = deLaFoto.includes('el monto');
    const boletaLoTrajoLaFoto = deLaFoto.includes('el número');

    /* `maskType="DECIMAL"` y no `type="number"`: el separador decimal del campo
     * nativo lo pone el idioma de CADA computadora, así que el mismo portal
     * aceptaba el punto en una caja y sólo la coma en la otra — y la tecla
     * rechazada no avisa, se pierde. En dinero eso es un monto equivocado. La
     * máscara acepta las dos y deja siempre punto. */
    const campoMonto = montoLoTrajoLaFoto ? datoDeLaBoleta('Cuánto', formatMoney(n)) : (
        <PortalInput
            label="Cuánto" name="monto" inputMode="decimal"
            maskType="DECIMAL" icon={HandCoins}
            value={monto} onChange={(e) => setMonto(e.target.value)}
            placeholder="0.00" inputClassName="tabular-nums"
        />
    );

    /* Si el campo tiene lista propia —las remesadoras—, es un desplegable: así
     * lo que se guarda coincide con el catálogo por construcción y no por cómo
     * lo escribió cada quien. */
    const campoEntidad = t?.etiqueta_entidad && (opciones.length ? (
        <div>
            <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                {t.etiqueta_entidad}
            </span>
            <LiquidSelect
                value={entidad} onChange={setEntidad}
                options={opciones}
                placeholder="Elegir…" ariaLabel={t.etiqueta_entidad}
            />
        </div>
    ) : (
        <PortalInput
            label={t.etiqueta_entidad} name="entidad"
            value={entidad} onChange={(e) => setEntidad(e.target.value)}
            placeholder="A quién se le paga"
        />
    ));

    const campoBoleta = t?.pide_boleta && (
        <div className="space-y-2">
            {/* El aviso de abajo NO se mueve con el campo: la boleta repetida
                frena el registro, y esconderlo al mostrar el número como dato
                dejaría sin explicación un botón trabado. */}
            {boletaLoTrajoLaFoto ? datoDeLaBoleta('Número de boleta', boleta) : (
                <PortalInput
                    label="Número de boleta" name="boleta"
                    value={boleta} onChange={(e) => setBoleta(e.target.value)}
                    placeholder={laFotoManda ? 'Lo trae la boleta' : 'El de la boleta del POS'}
                />
            )}
            {/* Va pegado al campo del número y no arriba con el error general:
                habla de ESTE campo, y un aviso lejos del control que lo causa se
                lee como un problema de otra cosa. */}
            {problemaDeLaBoleta && (
                <Notice variant={problemaDeLaBoleta.tono} compact icon={AlertTriangle}>
                    {problemaDeLaBoleta.texto}
                </Notice>
            )}
        </div>
    );

    const saleDe = eleccion.repartos.length > 0 && (
        <div data-surface="card" className="p-3 space-y-1.5">
            <span className="text-caption font-black uppercase tracking-widest text-content-3">
                Sale de
            </span>
            {eleccion.repartos.map((r) => {
                const b = lista.find((x) => x.id === r.bolsa_id);
                return (
                    <div key={r.bolsa_id} className="flex items-baseline justify-between gap-2">
                        <span className="text-label text-content truncate">
                            {r.folio}
                            <span className="text-caption text-content-3">
                                {b ? ` · corte del ${fechaCorta(b.fecha)} ${hhmm(b.hora)}` : ''}
                                {' '}· quedan {formatMoney((b?.saldo || 0) - r.monto)}
                            </span>
                        </span>
                        <span className="text-label font-bold tabular-nums text-content shrink-0">
                            {formatMoney(r.monto)}
                        </span>
                    </div>
                );
            })}
            {eleccion.combinada && (
                <p className="text-caption text-warning-text pt-1">
                    Ninguna bolsa alcanzaba sola: van a salir {eleccion.repartos.length} vales,
                    uno para cada bolsa.
                </p>
            )}
        </div>
    );

    return (
        <LiquidModal open={!!abierto} onClose={guardando ? undefined : onClose}
            maxWidth="max-w-lg" className="h-fit" ariaLabel="Sacar dinero de una bolsa">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Sacar dinero de una bolsa</h3>
                    <p className="text-caption text-content-3">
                        {enIdentidad
                            ? `${t.etiqueta} · ${formatMoney(n)}`
                            : lista.length
                                ? `${lista.length} ${lista.length === 1 ? 'bolsa' : 'bolsas'} en la sala · ${formatMoney(totalDisponible(lista))}`
                                : 'No hay bolsas con efectivo en la sala'}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {/* ── Paso 2: quién se lleva el efectivo ──────────────────────
                    Sólo esto en pantalla, y a propósito: el lector es un
                    `keydown` global y no cancela la tecla, así que mientras
                    espera un carné no puede haber ningún campo de texto
                    dibujado. Arriba queda el resumen de lo que se está por
                    sacar, que es lo que la persona firma. */}
                {enIdentidad ? (
                    <>
                        {saleDe}
                        <IdentidadDeQuienRetira
                            activo={!!abierto && !guardando}
                            persona={persona}
                            onIdentificada={alIdentificar}
                            onOlvidar={olvidarLaIdentidad}
                            bloqueado={guardando}
                        />
                    </>
                ) : (
                    <>
                        {!lista.length && (
                            <Notice variant="info" icon={Package}>
                                <span className="font-bold">No hay de dónde sacar</span>
                                <span className="block mt-0.5 font-normal text-content-2">
                                    Las bolsas nacen al confirmar un corte. Si el efectivo ya se entregó,
                                    el dinero para la remesa sale de la caja.
                                </span>
                            </Notice>
                        )}

                        {/* El motivo va PRIMERO porque gobierna el resto del panel:
                            de él dependen la remesadora, la boleta, la foto y si hay
                            que identificar a alguien. Leerlo después de rellenar
                            campos que él mismo decide es leerlo al revés. */}
                        {/* El MOTIVO manda y va primero; qué lo acompaña a su
                            derecha depende de él. Cuando la foto manda, el
                            monto todavía no se conoce —lo trae la boleta—, así
                            que al lado va la remesadora, que es el único dato
                            que el papel no dice.

                            Y mientras NO hay motivo, va solo y a lo ancho.
                            Reportado el 2026-08-21: «si no se ha puesto el
                            motivo, que no ponga los inputs, ya que no tiene
                            sentido». Tenía razón —el propio comentario de abajo
                            dice «sin motivo elegido no se pinta ninguno» y el
                            monto y el detalle se habían quedado fuera de esa
                            regla—: un «Cuánto» sobre una decisión que nadie
                            tomó pide un número para una salida que todavía no
                            se sabe qué es, y el motivo puede cambiar cuánto se
                            puede sacar y de qué bolsa. */}
                        <div className={t ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
                            <div>
                                <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                                    Motivo
                                </span>
                                <LiquidSelect
                                    value={tipo} onChange={elegirMotivo}
                                    options={tipos.map((x) => ({ value: x.codigo, label: x.etiqueta }))}
                                    placeholder="Elegir…" ariaLabel="Motivo de la salida"
                                />
                            </div>
                            {t && (laFotoManda ? campoEntidad : campoMonto)}
                        </div>

                        {/* `t &&` no es de más: sin motivo `laFotoManda` es
                            false, así que sin esto el bloque quedaba dependiendo
                            de que `eleccion` esté vacía en vez de decir la
                            regla. */}
                        {!!t && !laFotoManda && saleDe}

                        {/* ── De acá abajo, todo lo pide el MOTIVO ─────────────
                            Sin motivo elegido no se pinta ninguno: la remesadora es
                            de una remesa, no del formulario. Cuál aparece y cómo se
                            rotula sale del catálogo (`bolsas_tipos_salida`), no de
                            `if`s acá.

                            Y si el campo tiene lista propia —las remesadoras—, es un
                            desplegable: así lo que se guarda coincide con el catálogo
                            por construcción y no por cómo lo escribió cada quien. */}
                        {/* Con la foto mandando, la remesadora ya salió arriba
                            junto al motivo. */}
                        {!laFotoManda && campoEntidad}
                        {!laFotoManda && campoBoleta}
                        {/* `FileField` y no un `<input type="file">` suelto: el canónico
                            de §15.9. Las dos excepciones vivas son selectores de foto
                            donde el disparador ES la imagen (avatar, foto de producto) —
                            acá el adjunto es una fila más del formulario, que es
                            exactamente el caso que el canónico resuelve, con su límite
                            de tamaño y su estado de «falta y es error».

                            Cuando es opcional se dice EN el rótulo y la caja va en
                            neutro: la caja ámbar de «pendiente» sobre algo que no
                            frena se lee como un error que no lo es. */}
                        {/* La foto pasa por el EDITOR antes de guardarse
                            (2026-08-20). Hasta ese día entraba tal cual salía del
                            teléfono: el mostrador, la caja registradora y media
                            estantería alrededor de una boleta que ocupaba un
                            tercio del cuadro, y sin ninguna vista previa para
                            darse cuenta. El usuario lo pidió mirando una:
                            «que sólo se guarde la boleta, que detectes y
                            recortes el papel», «mostrar vista previa y ajustar».

                            El editor es el mismo canónico de las recetas de
                            bitácoras, con el perfil `boleta`: recorte, enderezado,
                            «Aclarada» —que es lo que hace legible una boleta
                            térmica— y un tamaño único de salida. Si alguien
                            cancela el editor, no queda foto: no se guarda a
                            medias lo que se pidió preparar. */}
                        {t?.foto !== 'NO' && !!t && (
                            <FileField
                                label={t.foto === 'OPCIONAL'
                                    ? 'Foto del comprobante (opcional)'
                                    : 'Foto del comprobante'}
                                accept="image/*"
                                maxSizeMB={10}
                                file={foto}
                                onChange={alElegirFoto}
                                emptyState={t.foto === 'OPCIONAL' ? 'neutral' : 'pending'}
                                hint={t.foto === 'OPCIONAL'
                                    ? 'Si te dieron comprobante, adjuntalo. Antes de guardarlo vas a poder recortarlo.'
                                    : laFotoManda
                                        ? 'La boleta que imprimió el POS. De ahí salen el monto y el número; antes de guardarla vas a poder recortarla.'
                                        : 'La boleta que imprimió el POS. Antes de guardarla vas a poder recortarla.'}
                            />
                        )}

                        {/* Qué dijo el lector. Va pegado al campo de la foto y
                            no arriba con el error general: habla de ESTA foto, y
                            un aviso lejos del control que lo causa se lee como
                            un problema de otra cosa. */}
                        {leyendo && (
                            <Notice variant="info" compact icon={ScanLine}>
                                Revisando la boleta…
                            </Notice>
                        )}
                        {!leyendo && problemaDeLaFoto && (
                            <Notice variant={problemaDeLaFoto.tono} compact icon={AlertTriangle}>
                                {problemaDeLaFoto.texto}
                            </Notice>
                        )}
                        {!leyendo && avisoDeLaFoto && (
                            <Notice variant={avisoDeLaFoto.tono} compact icon={AlertTriangle}>
                                {avisoDeLaFoto.texto}
                            </Notice>
                        )}
                        {/* Qué campos llenó la foto. Un campo que se llena solo
                            y no dice de dónde salió no se revisa: o se cree sin
                            mirar, o se desconfía y se vuelve a escribir. */}
                        {!leyendo && deLaFoto.length > 0 && (
                            <Notice variant="info" compact icon={ScanLine}>
                                {deLaFoto.length === 1
                                    ? `Se tomó de la boleta ${deLaFoto[0]}. Si no dice eso, vuelve a tomar la foto.`
                                    : `Se tomaron de la boleta ${juntarConY(deLaFoto)}. Si alguno no dice eso, vuelve a tomar la foto.`}
                            </Notice>
                        )}

                        {/* ── Lo que trajo la boleta, para confirmarlo ────────
                            Aparecen DESPUÉS de la foto y sólo cuando el lector
                            ya contestó: si leyó, vienen con el dato puesto; si
                            no pudo, vienen vacíos para escribirlo.

                            Lo que la foto trajo se muestra como DATO y no como
                            casilla (usuario, 2026-08-21: «¿no debería quedar como
                            informativo nada más?»): pedir que se revise algo que
                            ya está decidido invita a pisarlo sin querer, y esto
                            es el monto de una salida de dinero.

                            Lo único que viene en casilla es lo que la foto NO
                            pudo distinguir (usuario, 2026-08-21) — y entonces la
                            casilla sale vacía, con su aviso. Corregir un dato
                            leído es volver a tomar la foto: la boleta es la
                            verdad de una remesa, y un número escrito encima del
                            papel es justo lo que la revisión existe para
                            impedir. */}
                        {laFotoManda && datosALaVista && (
                            <>
                                {/* Lo que la boleta no dejó leer se dice, no se
                                    deja adivinar por un campo vacío: «si tiene
                                    dudas, que sí pida esos datos». */}
                                {!leyendo && faltaLeer.length > 0 && (
                                    <Notice variant="warning" compact icon={AlertTriangle}>
                                        {`La boleta no dejó leer ${juntarConY(faltaLeer)}. `
                                         + `${faltaLeer.length === 1 ? 'Escríbelo' : 'Escríbelos'} a mano.`}
                                    </Notice>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {campoMonto}
                                    {campoBoleta}
                                </div>
                                {saleDe}
                            </>
                        )}
                        {/* El «todo bien» sólo cuando de verdad se comparó y
                            de verdad coincidió.
                              · con el aviso de la entidad puesto, este cartel
                                diría lo contrario del que está justo encima;
                              · y con campos llenados por la foto no hubo nada
                                que comparar — el servidor no compara contra un
                                campo vacío—, así que decir «coincide con lo que
                                escribiste» sería afirmar una verificación que
                                no ocurrió. Ese caso ya tiene su propio aviso,
                                el que pide revisarlos. */}
                        {!leyendo && foto && lectura?.veredicto === 'OK' && !avisoDeLaFoto
                            && deLaFoto.length === 0 && seComparoAlgo && (
                            <Notice variant="success" compact icon={ScanLine}>
                                La boleta coincide con lo que escribiste.
                            </Notice>
                        )}

                        {porEditar && (
                            <Suspense fallback={null}>
                                <EditorDeDocumento
                                    tipo="boleta"
                                    file={porEditar}
                                    recuadro={lectura?.leido?.recuadro || null}
                                    onCancel={() => setPorEditar(null)}
                                    onConfirm={(lista) => { setFoto(lista); setPorEditar(null); }}
                                />
                            </Suspense>
                        )}

                        {/* El detalle también espera al motivo: es una nota
                            SOBRE la salida, y sin motivo todavía no hay salida
                            de la que anotar nada. */}
                        {!!t && (
                            <PortalTextarea
                                label="Detalle (opcional)" name="nota" rows={2}
                                value={nota} onChange={(e) => setNota(e.target.value)}
                                placeholder="Cualquier cosa que ayude a entenderlo después"
                            />
                        )}
                    </>
                )}

                {error && (
                    <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex items-center justify-between gap-3 w-full flex-wrap">
                    <span className="text-caption text-content-3 min-w-0 truncate">
                        {falta || 'Se imprime el vale para dejarlo dentro de la bolsa'}
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                        {enIdentidad ? (
                            <Button variant="ghost" icon={ArrowLeft} onClick={volverAlFormulario}
                                disabled={guardando}>
                                Volver
                            </Button>
                        ) : (
                            <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                        )}
                        {/* Un motivo que pide receptor no se registra desde el
                            formulario: primero se identifica a quien se lo lleva.
                            El botón lo dice, en vez de quedar apagado sin
                            explicar qué falta. */}
                        {t?.pide_receptor && !enIdentidad ? (
                            <Button variant="primary" icon={ArrowRight}
                                disabled={!!faltaEnElFormulario}
                                onClick={() => { setError(null); setPaso('IDENTIDAD'); }}>
                                Continuar
                            </Button>
                        ) : (
                            <Button variant="primary" icon={HandCoins} loading={guardando}
                                disabled={!!falta} onClick={guardar}>
                                Registrar e imprimir
                            </Button>
                        )}
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
