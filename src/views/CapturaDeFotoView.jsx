/**
 * La pantalla del teléfono: tomar la foto y mandarla.
 *
 * ── Por qué no pide iniciar sesión ──────────────────────────────────────────
 *
 * Quien escanea el QR puede no tener el portal abierto en ese teléfono, y
 * pedirle usuario y contraseña con la cámara esperando mata justo la fluidez
 * que esto viene a dar. La llave es el código del QR: vive cinco minutos, sirve
 * una vez, y lo único que consigue quien lo robe es meter una imagen en un
 * formulario que una persona está mirando y todavía no guardó.
 *
 * ── Una pantalla, un botón ──────────────────────────────────────────────────
 *
 * Sin menú, sin barra lateral, sin nada que tocar por error. Quien llega acá
 * llegó a hacer una cosa. Y cada estado DICE lo que pasa: «comprobando»,
 * «tomá la foto», «mandando», «lista». Un botón que no acusa recibo en un
 * teléfono es indistinguible de uno roto.
 *
 * ── Un escaneo, VARIAS hojas ────────────────────────────────────────────────
 *
 * *«es incómodo ir subiendo foto por foto: un solo escáner de QR, y desde el
 * teléfono dar en agregar otra foto; al finalizar sube todas convertido en un
 * PDF»* (usuario, 2026-08-30). Un currículum con sus atestados son ocho hojas,
 * y con el flujo viejo eran ocho códigos QR, ocho escaneos y ocho esperas.
 *
 * Las hojas se juntan ACÁ y se mandan de una sola vez al final, así que el
 * secreto sigue siendo de un solo uso: no hubo que tocar ni el esquema ni el
 * circuito. Lo único que cambió es que ahora el archivo que sube puede ser un
 * PDF.
 *
 * Con UNA sola hoja se manda el JPEG, no un PDF de una página: envolverla le
 * quitaría la vista previa y el «Ajustar» del editor en la computadora sin
 * darle nada a cambio.
 */
import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, CheckCircle2, AlertTriangle, Loader2, Plus, Send, X } from 'lucide-react';
import { capturaVigente, mandarFoto } from '../data/capturaDesdeElTelefono';
import { PROPS_CAMARA } from '../utils/capturaDeFoto';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';

/* ── El teléfono también AJUSTA, no sólo dispara ────────────────────────────
 *
 * Hasta hoy esta pantalla mandaba la foto tal cual y todo el arreglo pasaba en
 * la computadora. Pero quien tiene el documento en la mano es quien está acá:
 * ve si salió torcida, si le faltó una esquina, si quedó oscura — y tenía que
 * mandarla mal igual y avisarle a otra persona. El usuario lo pidió así: «si el
 * editor es desde el teléfono también, no sólo tomarla si no ahí mismo
 * ajustarla».
 *
 * Es el MISMO editor de la computadora, no una versión chica: un segundo
 * recortador para el teléfono se desincroniza del primero, que es la lección de
 * las dos copias del carné. Va diferido porque quien vuelve a tomar la foto
 * porque salió movida no necesita bajarlo dos veces.
 */
const EditorDeDocumento = lazy(() => import('../components/common/EditorDeDocumento'));

export default function CapturaDeFotoView() {
    const { secreto } = useParams();
    const [estado, setEstado] = useState('comprobando');   // comprobando · listo · mandando · hecho · error
    const [motivo, setMotivo] = useState('');
    const [para, setPara] = useState('');
    const [vista, setVista] = useState(null);
    /* Las hojas ya confirmadas, en orden. Se juntan acá y se mandan de una sola
       vez: por eso el secreto sigue siendo de un uso. */
    const [hojas, setHojas] = useState([]);   // [{ file, vista }]
    // La foto recién tomada, esperando que la persona la ajuste o la mande.
    const [porAjustar, setPorAjustar] = useState(null);
    // Dónde está el papel dentro de esa foto, según la lectura.
    const [sugerido, setSugerido] = useState(null);
    const [buscando, setBuscando] = useState(false);
    // Para no escribir estado después de que la pantalla se fue.
    const vivoRef = useRef(true);
    useEffect(() => () => { vivoRef.current = false; }, []);

    useEffect(() => {
        let vivo = true;
        (async () => {
            const r = await capturaVigente(secreto);
            if (!vivo) return;
            if (!r?.ok) {
                setEstado('error');
                setMotivo('Este código ya se usó o venció. Pide uno nuevo en la computadora.');
                return;
            }
            setPara(r.para || '');
            setEstado('listo');
        })();
        return () => { vivo = false; };
    }, [secreto]);

    /** Junta lo que haya y lo manda: una hoja va como foto, varias como PDF. */
    const enviar = async () => {
        if (!hojas.length) return;
        // La vista previa se pinta ANTES de mandar: en una red lenta, esos
        // segundos sin nada en pantalla se leen como que no pasó nada.
        setVista(hojas[0].vista);
        setEstado('mandando');
        try {
            let archivo = hojas[0].file;
            if (hojas.length > 1) {
                /* Cada hoja se reduce ANTES de entrar al PDF, y no después:
                   un PDF ya armado no se puede achicar, y ocho fotos de cámara
                   sin reducir pasan de largo el tope de 6 MB de la subida. Es
                   el mismo reductor que usa la foto suelta —1600 px al 85%—,
                   así que las dos rutas producen la misma calidad. */
                const [{ hojasEnPdf }, { hojaReducida }] = await Promise.all([
                    import('../utils/hojasEnPdf'),
                    import('../data/capturaDesdeElTelefono'),
                ]);
                const chicas = [];
                for (const h of hojas) chicas.push(await hojaReducida(h.file));
                archivo = await hojasEnPdf(chicas, 'documento');
            }
            const r = await mandarFoto(secreto, archivo);
            if (r.ok) { setEstado('hecho'); return; }
            setEstado('error');
            setMotivo(r.motivo);
        } catch (e) {
            /* Armar el PDF puede fallar por memoria con muchas hojas grandes, y
               ahí lo que NO se puede hacer es quedarse en «mandando» para
               siempre: las hojas siguen en pantalla y se puede reintentar o
               quitar alguna. */
            setEstado('error');
            setMotivo(e?.message || 'No se pudieron unir las hojas. Quita alguna e intenta de nuevo.');
        }
    };

    const quitarHoja = (i) => setHojas(prev => {
        const fuera = prev[i];
        if (fuera?.vista) URL.revokeObjectURL(fuera.vista);
        return prev.filter((_, j) => j !== i);
    });

    /* No se manda sola: se abre el editor. Mandarla y ADEMÁS ofrecer ajustarla
     * sería mandar dos veces la misma foto, y quien la tomó torcida no quiere
     * que la torcida llegue igual. Si no hay nada que arreglar, el editor se
     * confirma con un toque. */
    /* ── Las esquinas se buscan también acá ────────────────────────────────
     *
     * Hasta el 2026-08-29 el editor del teléfono abría con su recuadro de
     * siempre —un margen del 8%— y había que marcar las cuatro esquinas a mano
     * SIEMPRE. No es que la detección fallara: no se le preguntaba a nadie. La
     * ayuda vivía en `FileField`, o sea en la computadora, que es justo donde
     * las fotos vienen mejor encuadradas.
     *
     * La pregunta va con el secreto del QR, porque esta página no tiene sesión.
     * Y si no contesta —sin red, secreto vencido, una foto sin ningún papel— el
     * editor abre igual: una ayuda que se cae no puede impedir mandar la foto.
     */
    const tomar = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPorAjustar(file);
        setSugerido(null);
        setBuscando(true);
        import('../data/recorteSugerido')
            .then(m => m.buscarEsquinas(file, { secretoDeCaptura: secreto }))
            .then(r => { if (vivoRef.current) setSugerido(r); })
            .catch(() => {})
            .finally(() => { if (vivoRef.current) setBuscando(false); });
        // El `input` se limpia para que volver a elegir el MISMO archivo
        // dispare el evento otra vez: sin esto, cancelar el editor y reintentar
        // con la misma foto no hace nada.
        e.target.value = '';
    };

    return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-6 px-6 py-10
                        pt-[max(2.5rem,var(--sa-top))] pb-[max(2.5rem,var(--sa-bottom))]">
            <div className="text-center">
                <p className="text-caption font-black uppercase tracking-widest text-content-3">Foto para el expediente</p>
                {para && <p className="text-display-sm font-black text-content mt-1">{para}</p>}
            </div>

            {vista && (
                <img src={vista} alt="" className="w-40 h-40 rounded-3xl object-cover shadow-[var(--shadow-glass-3)]" />
            )}

            {estado === 'comprobando' && (
                <p className="text-body text-content-3 font-bold flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Comprobando el código…
                </p>
            )}

            {estado === 'listo' && (
                <>
                    {/* Las hojas que ya se confirmaron. Se ven todas y en orden,
                        porque ese orden es el del PDF: si la 3 quedó movida hay
                        que poder verlo ANTES de mandar, no después. */}
                    {hojas.length > 0 && (
                        <div className="w-full max-w-xs">
                            <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-2">
                                {hojas.length === 1 ? '1 hoja lista' : `${hojas.length} hojas listas`}
                            </p>
                            <div className="flex gap-2 overflow-x-auto pb-1">
                                {hojas.map((h, i) => (
                                    <div key={h.vista} className="relative shrink-0">
                                        <img src={h.vista} alt=""
                                            className="w-20 h-28 object-cover rounded-2xl
                                                       shadow-[var(--shadow-glass-2)]" />
                                        <Badge variant="neutral" size="sm"
                                            className="absolute bottom-1 left-1">
                                            {i + 1}
                                        </Badge>
                                        <button type="button" onClick={() => quitarHoja(i)}
                                            aria-label={`Quitar la hoja ${i + 1}`}
                                            className="absolute -top-1.5 -right-1.5 grid place-items-center
                                                       h-7 w-7 rounded-full bg-danger-solid text-white
                                                       shadow-sm active:scale-[0.9] transition-transform">
                                            <X size={14} strokeWidth={3} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Sin hojas el botón es la pantalla; con hojas se hace
                        secundario y la acción principal pasa a ser mandar. */}
                    <label htmlFor="captura-foto"
                        className={hojas.length === 0
                            ? `flex flex-col items-center justify-center gap-3 w-full max-w-xs
                               min-h-[var(--tap-min)] py-8 rounded-3xl cursor-pointer
                               bg-brand text-white font-black text-body-lg
                               active:scale-[0.97] transition-transform`
                            : `flex items-center justify-center gap-2 w-full max-w-xs
                               min-h-[var(--tap-min)] py-3 rounded-2xl cursor-pointer
                               border border-border-card bg-surface-card-hover
                               text-content font-black text-body
                               active:scale-[0.97] transition-transform`}>
                        {hojas.length === 0
                            ? <><Camera size={32} strokeWidth={2.5} />Tomar la foto</>
                            : <><Plus size={18} strokeWidth={3} />Agregar otra hoja</>}
                    </label>
                    <input id="captura-foto" type="file" {...PROPS_CAMARA} className="hidden" onChange={tomar} />

                    {hojas.length > 0 && (
                        <button type="button" onClick={enviar}
                            className="flex items-center justify-center gap-2 w-full max-w-xs
                                       min-h-[var(--tap-min)] py-4 rounded-3xl
                                       bg-brand text-white font-black text-body-lg
                                       active:scale-[0.97] transition-transform">
                            <Send size={20} strokeWidth={2.5} />
                            {hojas.length === 1 ? 'Mandar la foto' : `Mandar las ${hojas.length} hojas`}
                        </button>
                    )}

                    <p className="text-caption text-content-3 font-medium text-center max-w-xs leading-snug">
                        {hojas.length === 0
                            ? 'Puedes recortarla y enderezarla aquí mismo. Si el documento tiene varias hojas, las vas agregando y se mandan todas juntas.'
                            : (hojas.length === 1
                                ? 'Agrega las hojas que falten, o mándala así. Se va a ver sola en la computadora.'
                                : 'Se mandan como un solo documento, en este orden.')}
                    </p>
                </>
            )}

            {estado === 'mandando' && (
                <p className="text-body font-black text-brand-text flex items-center gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    {hojas.length > 1 ? `Mandando las ${hojas.length} hojas…` : 'Mandando la foto…'}
                </p>
            )}

            {estado === 'hecho' && (
                <div className="flex flex-col items-center gap-2 text-center">
                    <CheckCircle2 size={40} className="text-success" strokeWidth={2.5} />
                    <p className="text-body-lg font-black text-content">Lista</p>
                    <p className="text-caption text-content-3 font-medium max-w-xs leading-snug">
                        Ya está en la computadora. Puedes cerrar esta pantalla.
                    </p>
                </div>
            )}

            {porAjustar && (
                <Suspense fallback={
                    <p className="text-body text-content-3 font-bold flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" /> Abriendo el editor…
                    </p>
                }>
                    <EditorDeDocumento
                        tipo="documento"
                        file={porAjustar}
                        analizando={buscando && !sugerido}
                        recuadro={sugerido?.recuadro || null}
                        giroSugerido={sugerido?.giro || 0}
                        esquinas={sugerido?.esquinas || null}
                        onCancel={() => { setPorAjustar(null); setSugerido(null); }}
                        /* Confirmar NO manda: suma la hoja y devuelve a la
                           pantalla, que es lo que permite seguir agregando. */
                        onConfirm={(listo) => {
                            setPorAjustar(null); setSugerido(null);
                            setHojas(prev => [...prev, { file: listo, vista: URL.createObjectURL(listo) }]);
                        }}
                    />
                </Suspense>
            )}

            {estado === 'error' && (
                <div className="flex flex-col items-center gap-3 text-center">
                    <AlertTriangle size={36} className="text-danger" strokeWidth={2.5} />
                    <p className="text-body font-bold text-danger-text max-w-xs leading-snug">{motivo}</p>
                    {/* Reintentar sólo tiene sentido si el código sigue vivo. Si
                        venció, el botón prometería algo que no puede cumplir.

                        Y las hojas NO se borran al fallar: reintentar tiene que
                        ser volver a mandar lo que ya se armó, no volver a
                        fotografiar ocho papeles. */}
                    {!/venció|usó/.test(motivo) && (
                        <Button variant="secondary" onClick={() => { setEstado('listo'); setVista(null); }}>
                            Intentar de nuevo
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
