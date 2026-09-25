import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, HandCoins, Image as ImageIcon, Printer, ShieldCheck } from 'lucide-react';
import AbonosDeDiferencia from './AbonosDeDiferencia';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import FileField from '../common/FileField';
import Notice from '../common/Notice';
import PhotoLightbox from '../common/PhotoLightbox';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import SegmentedControl from '../common/SegmentedControl';
import { fetchTurnoDelCorte, subirEvidenciaDeDiferencia } from '../../data/cortes';
import { getSignedFileUrl } from '../../utils/storageFiles';
import { clearDraft, loadDraft, saveDraft } from '../../utils/draftUtils';
import { shortEmployeeName } from '../../utils/nameUtils';
import { repartirEnPartes, severidad } from '../../utils/cortesDiagnostico';
import { formatMoney } from '../../utils/formatNumber';
import { useAuth } from '../../context/AuthContext';
import useResolverDiferencia from '../../hooks/useResolverDiferencia';
import { fechaHora12 } from '../../utils/hora';

/**
 * Qué se hizo con el faltante o el sobrante de un corte.
 *
 * Lo pidió el usuario (2026-08-14): «si un corte tiene sobrante / faltante, se
 * debe poder editar... si se abre para agregar faltante, debe decir confirmar
 * faltante para reponer el dinero, al darle, imprime un ticket como ingreso de
 * dinero por faltante del día tal».
 *
 * ── Tres caminos, y el signo decide cuáles se ofrecen ──────────────────────
 * Un faltante se REPONE (entra dinero) y un sobrante se RETIRA (sale). Ofrecer
 * los dos siempre sería dejar que alguien «retire» un faltante, que no quiere
 * decir nada; el servidor además lo rechaza. El tercero —JUSTIFICA— existe
 * porque a veces la causa apareció y ya está corregida en el sistema, y forzar
 * un movimiento de dinero ahí inventaría un descuadre nuevo.
 *
 * ── Por qué el reparto se muestra y no sólo se calcula ─────────────────────
 * «Quedarán registrados los del turno, ahí se puede seleccionar o quitar si uno
 * no aportó» (usuario). O sea que la lista es una propuesta, no un hecho: se
 * reparte en partes iguales al marcar y desmarcar, pero cada monto es editable
 * y lo que falta o sobra para llegar al total se ve mientras se escribe. Un
 * reparto que no suma exacto deja a alguien debiendo un centavo que no está en
 * ningún lado, y el servidor lo rechaza — mejor verlo antes de apretar.
 *
 * ── 2026-09-25: dos caminos claros, y el faltante sin causa se ABONA ───────
 * «Si encontré causa, qué pasó y cómo lo valido. Si no encontré causa, que
 * pueda seleccionar los responsables —por defecto quienes hicieron ventas en
 * el rango de ese corte— y que se pueda abonar, individual o total» (usuario).
 *
 *   · «Se encontró la causa» exige comprobante: el número del documento que se
 *     corrigió o una foto. El servidor rechaza sin ninguno de los dos.
 *   · «No se encontró la causa» asigna responsables. Ya no significa que el
 *     dinero entró: entra por abonos (`AbonosDeDiferencia`), parciales y en
 *     días distintos. Por eso asignar no imprime nada.
 *   · La propuesta de responsables sale de quién VENDIÓ en el tramo del corte
 *     (`sales_invoices.cod_vendedor`), no de la sala entera: el turno sigue
 *     sin encenderse y proponer a todos obligaba a adivinar.
 */

function VerFoto({ url }) {
    const [firmando, setFirmando] = useState(false);
    const [ampliada, setAmpliada] = useState(null);
    const [fallo, setFallo] = useState(false);
    if (!url) return null;
    const abrir = async () => {
        setFirmando(true); setFallo(false);
        try {
            const firmada = await getSignedFileUrl(url);
            if (firmada) setAmpliada(firmada); else setFallo(true);
        } catch { setFallo(true); }
        setFirmando(false);
    };
    return (
        <>
            <Button variant="ghost" size="sm" icon={ImageIcon} loading={firmando} onClick={abrir}>
                {fallo ? 'No se pudo abrir' : 'Ver la foto'}
            </Button>
            <PhotoLightbox src={ampliada} alt="Comprobante de la causa" onClose={() => setAmpliada(null)} />
        </>
    );
}

const VIA_LARGO = {
    REPONE: 'Sin causa · con responsables',
    RETIRA: 'Se retiró el sobrante',
    JUSTIFICA: 'Se encontró la causa',
};

const centavos = (n) => Math.round(Number(n || 0) * 100);
const aMonto = (c) => Math.round(c) / 100;

const selloDeTiempo = (iso) => (iso ? fechaHora12(iso) : '');

export default function ResolverDiferencia({
    corte,
    nombreSala = {},
    diferencia = null,     // la resolución que ya tiene, si la tiene
    personasResueltas = [],
    puedeResolver = false,
    origen = 'modulo',
    onCambio,              // se llama tras guardar o anular, para recargar
}) {
    const { user } = useAuth();
    const { resolver, anular, imprimir, ocupado } = useResolverDiferencia({ nombreSala, origen });
    // Borrador por corte (`gate:borradores`): la sesión de sala se cierra sola
    // a los 5 minutos, y la causa y el número del comprobante se escriben
    // mientras se busca el papel. La foto no se guarda: es un archivo.
    const claveBorrador = corte?.id ? `corte_dif_${corte.id}` : null;
    const [borrador] = useState(() => (claveBorrador ? loadDraft(claveBorrador) : null));
    const [evidenciaRef, setEvidenciaRef] = useState(() => borrador?.evidenciaRef || '');
    const [foto, setFoto] = useState(null);
    const [subiendo, setSubiendo] = useState(false);
    const [errorFoto, setErrorFoto] = useState('');

    const tramo = Number(corte?.tramo ?? 0);
    const sev = severidad(tramo);
    const falta = tramo < 0;

    // Sin preseleccionar. La vía llegaba marcada según el signo, y eso hizo que
    // el sobrante de $50 de Salud 5 del 31-ago se guardara como RETIRA con una
    // causa que decía, literalmente, «ya se encontró la causa»: el portal le
    // pidió después un VALE por dinero que nadie iba a sacar del cajón. Escribir
    // la causa y guardar sin tocar el segmentado mandaba el default — «no lo
    // toco» y «lo mando como viene» son lo mismo, y las dos opciones significan
    // cosas muy distintas para el dinero. Ahora hay que elegir.
    const [via, setVia] = useState(() => borrador?.via || null);
    const [causa, setCausa] = useState(() => borrador?.causa || '');
    const [candidatos, setCandidatos] = useState([]);
    const [marcadas, setMarcadas] = useState(() => new Set());
    const [montos, setMontos] = useState(() => new Map());
    const [abriendo, setAbriendo] = useState(() => !!(borrador?.via || borrador?.causa));
    const [motivoAnular, setMotivoAnular] = useState('');
    const [anulando, setAnulando] = useState(false);

    const corteId = corte?.id ?? null;

    useEffect(() => {
        if (!claveBorrador || !abriendo) return;
        if (via || causa.trim() || evidenciaRef.trim()) saveDraft(claveBorrador, { via, causa, evidenciaRef });
    }, [claveBorrador, abriendo, via, causa, evidenciaRef]);
    const yaResuelta = !!diferencia && !diferencia.anulada_at;

    // Los candidatos a aportar. Se piden al abrir el formulario y no con el
    // corte: sólo hacen falta si alguien va a reponer.
    useEffect(() => {
        if (!abriendo || !corteId || via !== 'REPONE') return;
        let vivo = true;
        fetchTurnoDelCorte(corteId).then((filas) => {
            if (!vivo) return;
            setCandidatos(filas);
            // Preselección (usuario, 2026-09-25): quienes VENDIERON en el tramo
            // de este corte. Si nadie vendió —o las ventas todavía no llegaron—
            // cae a los del turno y a quien tiene la sesión, que era la regla de
            // antes. Nunca la sala entera: eso sería inventar responsables.
            const vendieron = filas.filter((f) => Number(f.ventas) > 0).map((f) => f.id);
            const previa = vendieron.length
                ? vendieron
                : filas.filter((f) => f.del_turno || f.id === user?.id).map((f) => f.id);
            setMarcadas(new Set(previa.length ? previa : filas.slice(0, 1).map((f) => f.id)));
        });
        return () => { vivo = false; };
    }, [abriendo, corteId, via, user]);

    // El reparto se rehace al cambiar quiénes aportan. Va en render y no en un
    // efecto —el proyecto prohíbe `setState` dentro de `useEffect`— usando el
    // patrón de «reaccionar a un cambio»: se compara con la clave anterior.
    const clave = [...marcadas].sort().join('|');
    const [clavePrevia, setClavePrevia] = useState(clave);
    if (clave !== clavePrevia) {
        setClavePrevia(clave);
        const ids = [...marcadas];
        const partes = repartirEnPartes(tramo, ids.length);
        setMontos(new Map(ids.map((id, i) => [id, partes[i]])));
    }

    const sumaAportes = useMemo(
        () => [...marcadas].reduce((a, id) => a + centavos(montos.get(id) ?? 0), 0),
        [marcadas, montos],
    );
    const objetivo = Math.abs(centavos(tramo));
    const restan = objetivo - sumaAportes;

    const alternar = useCallback((id) => {
        setMarcadas((prev) => {
            const s = new Set(prev);
            if (s.has(id)) s.delete(id); else s.add(id);
            return s;
        });
    }, []);

    const cambiarMonto = useCallback((id, valor) => {
        setMontos((prev) => new Map(prev).set(id, valor === '' ? '' : Number(valor)));
    }, []);

    const guardar = useCallback(async () => {
        const ids = [...marcadas];
        const personas = via === 'REPONE'
            ? ids.map((id) => ({
                employee_id: id,
                monto: Number(montos.get(id) ?? 0),
                del_turno: !!candidatos.find((c) => c.id === id)?.del_turno,
            }))
            : [];
        const nombres = personas.map((p) => ({
            nombre: candidatos.find((c) => c.id === p.employee_id)?.name || '',
            monto: p.monto,
        }));
        // La foto se sube ANTES de resolver: la URL es parte de la resolución.
        // Si la subida falla no se resuelve — una causa encontrada sin su
        // respaldo es justo lo que el servidor rechaza.
        let evidenciaFoto = null;
        if (via === 'JUSTIFICA' && foto) {
            setSubiendo(true); setErrorFoto('');
            try {
                evidenciaFoto = await subirEvidenciaDeDiferencia(foto, { salaId: corte?.branch_id, userId: user?.id });
            } catch (e) {
                setErrorFoto(e.message || 'No se pudo subir la foto.');
                setSubiendo(false);
                return;
            }
            setSubiendo(false);
        }
        const r = await resolver(corte, {
            via, causa, montoVisto: tramo, personas, nombres,
            evidenciaRef: via === 'JUSTIFICA' ? evidenciaRef.trim() : null,
            evidenciaFoto,
        });
        if (r) {
            if (claveBorrador) clearDraft(claveBorrador);
            setAbriendo(false); setCausa(''); setEvidenciaRef(''); setFoto(null);
            onCambio?.();
        }
    }, [marcadas, via, montos, candidatos, resolver, corte, causa, tramo, onCambio, foto, evidenciaRef, user, claveBorrador]);

    const confirmarAnular = useCallback(async () => {
        const ok = await anular(corte, diferencia, motivoAnular);
        if (ok) { setAnulando(false); setMotivoAnular(''); onCambio?.(); }
    }, [anular, corte, diferencia, motivoAnular, onCambio]);

    const reimprimir = useCallback(() => {
        imprimir(corte, diferencia, (personasResueltas || []).map((p) => ({
            nombre: p.nombre, monto: p.monto,
        })));
    }, [imprimir, corte, diferencia, personasResueltas]);

    // ── Ya resuelta: se muestra, se reimprime, se anula ─────────────────────
    if (yaResuelta) {
        return (
            <div data-surface="card" className="p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="success" size="sm" icon={ShieldCheck}>
                        {VIA_LARGO[diferencia.via] || 'Resuelta'}
                    </Badge>
                    <span className="text-label font-bold text-content tabular-nums">
                        {formatMoney(Math.abs(Number(diferencia.monto)))}
                    </span>
                    {diferencia.asentado_at && (
                        <Badge variant="info" size="sm">Registrado {diferencia.asentado_ref}</Badge>
                    )}
                    {!diferencia.asentado_at && diferencia.via === 'RETIRA' && (
                        <Badge variant="warning" size="sm" dot>Falta registrarlo en el sistema</Badge>
                    )}
                </div>

                <div className="text-caption text-content-2">{diferencia.causa}</div>

                {(diferencia.evidencia_ref || diferencia.evidencia_foto_url) && (
                    <div className="flex items-center gap-2 flex-wrap">
                        {diferencia.evidencia_ref && (
                            <span className="text-caption text-content-2">
                                Comprobante: <span className="font-bold">{diferencia.evidencia_ref}</span>
                            </span>
                        )}
                        <VerFoto url={diferencia.evidencia_foto_url} />
                    </div>
                )}

                {diferencia.via === 'RETIRA' && (personasResueltas || []).length > 0 && (
                    <div className="text-caption text-content-3">
                        {personasResueltas.map((p) => `${shortEmployeeName(p.nombre)} ${formatMoney(Math.abs(Number(p.monto)))}`).join(' · ')}
                    </div>
                )}

                <div className="text-caption text-content-3">
                    {diferencia.registrado_nombre ? shortEmployeeName(diferencia.registrado_nombre) : 'Sin registrar quién'} · {selloDeTiempo(diferencia.registrado_at)}
                    {diferencia.via === 'RETIRA' && (diferencia.impreso_at ? ' · comprobante impreso' : ' · sin imprimir')}
                </div>

                {diferencia.via === 'REPONE' && (
                    <AbonosDeDiferencia
                        corte={corte}
                        diferencia={diferencia}
                        nombreSala={nombreSala}
                        puedeResolver={puedeResolver}
                        origen={origen}
                        onCambio={onCambio}
                    />
                )}

                {anulando ? (
                    <div className="space-y-2">
                        <PortalTextarea
                            label="Por qué se anula"
                            name="motivo-anular"
                            value={motivoAnular}
                            onChange={(e) => setMotivoAnular(e.target.value)}
                            rows={2}
                            placeholder="Qué estaba mal en esta resolución"
                        />
                        <div className="flex items-center justify-end gap-1.5">
                            <Button variant="ghost" size="sm" onClick={() => setAnulando(false)} disabled={ocupado}>
                                Volver
                            </Button>
                            <Button variant="destructive" size="sm" loading={ocupado}
                                disabled={!motivoAnular.trim()} onClick={confirmarAnular}>
                                Anular
                            </Button>
                        </div>
                    </div>
                ) : puedeResolver && (
                    <div className="flex items-center justify-end gap-1.5">
                        {diferencia.via === 'RETIRA' && (
                            <Button variant="secondary" size="sm" icon={Printer} onClick={reimprimir} loading={ocupado}>
                                Imprimir comprobante
                            </Button>
                        )}
                        {/* Ya registrada en el sistema significa que el dinero se
                            movió allá: anularla acá dejaría las dos cuentas
                            distintas, y el servidor la rechaza. */}
                        {/* Con abonos vivos el servidor la rechaza: primero se
                            anulan los abonos, porque ese dinero ya entró. */}
                        {!diferencia.asentado_at
                            && !(diferencia.abonos || []).some((a) => !a.anulada_at) && (
                            <Button variant="ghost" size="sm" icon={Ban} onClick={() => setAnulando(true)}>
                                Anular
                            </Button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    if (sev === 'ok' || !puedeResolver || corte?.estado === 'DESCARTADO') return null;

    // ── Todavía sin resolver ────────────────────────────────────────────────
    // Un SOBRANTE no se resuelve: se acumula en la sala para el inventario
    // (usuario, 2026-09-25). Lo único que se puede hacer con él es explicarlo
    // con comprobante, y así sale del acumulado. Ya no existe «se retira».
    if (!abriendo) {
        if (!falta) {
            return (
                <div className="space-y-1.5">
                    <p className="text-caption text-content-3">
                        Queda en el acumulado de la sala. Si tiene causa, explícalo y sale del acumulado.
                    </p>
                    <Button variant="ghost" size="sm" icon={ShieldCheck} className="w-full"
                        onClick={() => { setVia('JUSTIFICA'); setAbriendo(true); }}>
                        Tiene causa: explicarlo
                    </Button>
                </div>
            );
        }
        return (
            <Button variant="secondary" icon={HandCoins} onClick={() => setAbriendo(true)} className="w-full">
                {`Resolver el faltante de ${formatMoney(Math.abs(tramo))}`}
            </Button>
        );
    }

    const opciones = [{ value: 'JUSTIFICA', label: 'Se encontró la causa' }, { value: 'REPONE', label: 'No se encontró' }];
    const faltaComprobante = via === 'JUSTIFICA' && !evidenciaRef.trim() && !foto;

    return (
        <div data-surface="card" className="p-3 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-caption font-black uppercase tracking-widest text-content-3">
                    {falta ? 'Resolver el faltante' : 'Explicar el sobrante'}
                </span>
                <span className="text-body font-bold tabular-nums text-content">
                    {formatMoney(Math.abs(tramo))}
                </span>
            </div>

            {falta && (
                <SegmentedControl
                    label="Qué se hizo"
                    value={via}
                    onChange={setVia}
                    options={opciones}
                />
            )}

            {via && (
                <PortalTextarea
                    label={via === 'JUSTIFICA' ? 'Qué pasó' : via === 'REPONE' ? 'Qué se revisó' : 'Causa'}
                    name="causa"
                    value={causa}
                    onChange={(e) => setCausa(e.target.value)}
                    rows={2}
                    placeholder={via === 'JUSTIFICA'
                        ? (falta ? 'Ej.: se cobró en efectivo una venta que se registró con tarjeta' : 'De dónde salió el dinero de más')
                        : via === 'REPONE'
                            ? 'Qué se revisó sin encontrar la causa'
                            : 'Por qué se retira el sobrante'}
                />
            )}

            {via === 'JUSTIFICA' && (
                <div className="space-y-2">
                    <PortalInput
                        label="Número del documento corregido"
                        name="evidencia-ref"
                        value={evidenciaRef}
                        onChange={(e) => setEvidenciaRef(e.target.value)}
                        placeholder="Ingreso, vale, factura o recibo"
                    />
                    <FileField
                        label="Foto del comprobante"
                        accept="image/*"
                        maxSizeMB={10}
                        file={foto}
                        onChange={(f) => { setErrorFoto(''); setFoto(f || null); }}
                        emptyState="neutral"
                        tipoDeDocumento="comprobante"
                        hint="El documento que muestra la causa. Basta con el número o con la foto."
                    />
                    {errorFoto && <Notice variant="danger">{errorFoto}</Notice>}
                    {faltaComprobante && (
                        <p className="text-caption text-content-3">
                            Para dar la causa por encontrada hace falta el número del documento o una foto.
                        </p>
                    )}
                </div>
            )}

            {via === 'REPONE' && (
                <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-caption font-black uppercase tracking-widest text-content-3">
                            Quién responde
                        </span>
                        <span className={`text-caption tabular-nums ${restan === 0 ? 'text-success-text' : 'text-danger-text'}`}>
                            {restan === 0
                                ? 'Suma exacto'
                                : restan > 0
                                    ? `Faltan ${formatMoney(aMonto(restan))}`
                                    : `Sobran ${formatMoney(aMonto(-restan))}`}
                        </span>
                    </div>

                    {!candidatos.length && (
                        <div className="text-caption text-content-3">Cargando la sala…</div>
                    )}

                    {candidatos.map((c) => {
                        const marcada = marcadas.has(c.id);
                        return (
                            <div key={c.id} className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <Checkbox
                                        name={`aporta-${c.id}`}
                                        checked={marcada}
                                        onChange={() => alternar(c.id)}
                                        label={shortEmployeeName(c.name)}
                                        description={Number(c.ventas) > 0
                                            ? `${c.ventas} ${Number(c.ventas) === 1 ? 'venta' : 'ventas'} en este corte`
                                            : c.del_turno ? 'Del turno' : 'Sin ventas en este corte'}
                                    />
                                </div>
                                {marcada && (
                                    <div className="w-28 shrink-0">
                                        <PortalInput
                                            name={`monto-${c.id}`}
                                            inputMode="decimal"
                                            maskType="DECIMAL"
                                            prefix="$"
                                            aria-label={`Cuánto le toca a ${shortEmployeeName(c.name)}`}
                                            value={montos.get(c.id) ?? ''}
                                            onChange={(e) => cambiarMonto(c.id, e.target.value)}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {candidatos.length > 0 && (
                        <p className="text-caption text-content-3">
                            {candidatos.some((c) => Number(c.ventas) > 0)
                                ? 'Vienen marcados quienes vendieron entre el corte anterior y este. Quita o agrega según corresponda.'
                                : 'Nadie tiene ventas registradas en este tramo todavía: marca a quienes responden.'}
                        </p>
                    )}
                </div>
            )}

            {via === 'RETIRA' && (
                <Notice variant="info">
                    <span className="font-bold">Al guardar sale el comprobante para firmar</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Anéxalo al corte. Después hay que registrar el vale en el sistema — se
                        puede hacer uno solo por varias diferencias.
                    </span>
                </Notice>
            )}
            {via === 'REPONE' && (
                <Notice variant="info">
                    <span className="font-bold">Al guardar, cada responsable queda con su saldo</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Después se abona por persona o todo junto, en uno o varios días. Cada abono
                        imprime su comprobante. Es una reposición voluntaria: nunca se descuenta del salario.
                    </span>
                </Notice>
            )}

            <div className="flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => {
                    if (claveBorrador) clearDraft(claveBorrador);
                    setAbriendo(false);
                }}>
                    Volver
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    loading={ocupado || subiendo}
                    disabled={!via || !causa.trim() || faltaComprobante
                        || (via === 'REPONE' && (restan !== 0 || !marcadas.size))}
                    onClick={guardar}
                >
                    {via === 'RETIRA' ? 'Guardar e imprimir' : via === 'REPONE' ? 'Asignar responsables' : 'Guardar'}
                </Button>
            </div>
        </div>
    );
}
