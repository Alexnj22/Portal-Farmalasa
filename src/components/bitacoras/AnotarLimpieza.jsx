import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Sparkles, XCircle } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalTextarea from '../common/PortalTextarea';
import { ListaDePuntos } from './PuntosDeLimpieza';
import { anularLimpieza, corregirLimpieza, registrarLimpieza } from '../../data/bitacoras';
import { useStaffStore as useStaff } from '../../store/staffStore';

// ═══════════════════════════════════════════════════════════════════════════
// Registrar, corregir o quitar una limpieza.
//
// ── La observación es OPCIONAL a propósito ─────────────────────────────────
// La norma no pide describir cada limpieza —pide que exista el procedimiento
// escrito y su registro (RTS 5.5.5)— y un campo obligatorio que no aporta
// produce «ok» ciento veinte veces, que es exactamente el ruido que hace
// ilegible un libro. Cuando hay algo que decir, el campo está.
//
// ── Corregir y quitar SÍ exigen motivo ─────────────────────────────────────
// «Permite editar / quitar limpieza» (usuario). Hasta hoy, marcarla por error
// era definitivo, y un libro que no se puede corregir termina diciendo algo
// falso — peor que un hueco. Pero tocar un registro ya anotado no puede ser
// gratis: el motivo es lo que separa una corrección de un borrado, y queda en
// la bitácora de auditoría con quién lo hizo.
// ═══════════════════════════════════════════════════════════════════════════

const hhmm = (t) => String(t || '').slice(0, 5);

export default function AnotarLimpieza({ area, turno, fecha, registro, modo = 'registrar', onCerrar }) {
    const corrigiendo = modo === 'corregir';
    const quitando    = modo === 'quitar';

    const puntos = useMemo(() => area?.puntos || [], [area]);

    // Al registrar arranca con TODO marcado: el día normal es que se limpió
    // todo, y ese día no puede costar seis toques. Al corregir arranca con lo
    // que quedó anotado, que es lo que se viene a cambiar.
    const [marcadas, setMarcadas] = useState(() => (
        corrigiendo
            ? new Set((registro?.puntos || []).filter(p => p.hecho).map(p => p.clave))
            : new Set(puntos.map(p => p.clave))
    ));
    const [obs, setObs] = useState(() => (corrigiendo ? (registro?.observaciones || '') : ''));
    const [motivo, setMotivo] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    const faltaMotivo = (corrigiendo || quitando) && !motivo.trim();

    const guardar = useCallback(async () => {
        setError(null);
        setGuardando(true);

        const marcados = puntos.map(p => ({ clave: p.clave, hecho: marcadas.has(p.clave) }));
        let err = null;
        if (quitando) {
            ({ error: err } = await anularLimpieza({ limpiezaId: registro.id, motivo }));
        } else if (corrigiendo) {
            ({ error: err } = await corregirLimpieza({
                limpiezaId: registro.id, puntos: marcados, observaciones: obs, motivo,
            }));
        } else {
            ({ error: err } = await registrarLimpieza({
                areaId: area.id, fecha, turno: turno.clave, observaciones: obs, puntos: marcados,
            }));
        }
        setGuardando(false);
        if (err) { setError(err); return; }

        // Tocar un registro ya anotado deja rastro: es el canon del portal para
        // toda acción de usuario, y acá además es el único lugar donde vive el
        // motivo de un registro que se quitó.
        if (corrigiendo || quitando) {
            useStaff.getState().appendAuditLog(
                quitando ? 'QUITAR_LIMPIEZA_BITACORA' : 'CORREGIR_LIMPIEZA_BITACORA',
                String(registro?.id ?? ''),
                { area: area?.nombre ?? null, turno: turno?.label ?? null, fecha, motivo },
            );
        }
        onCerrar(true);
    }, [quitando, corrigiendo, registro, motivo, puntos, marcadas, obs, area, fecha, turno, onCerrar]);

    const titulo = quitando ? 'Quitar la limpieza'
        : corrigiendo ? 'Corregir la limpieza'
            : 'Registrar la limpieza';

    return (
        <LiquidModal open onClose={guardando ? undefined : () => onCerrar(false)}
            maxWidth="max-w-md" className="h-fit" ariaLabel={titulo}>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">{titulo}</h3>
                    <p className="text-caption text-content-3 truncate">
                        {area.nombre} · {turno.label} ({hhmm(turno.desde)}–{hhmm(turno.hasta)})
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {quitando ? (
                    <Notice variant="warning" compact icon={AlertTriangle}>
                        <span className="font-bold">El registro se va del libro.</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            El turno vuelve a aparecer como pendiente. Queda anotado quién lo quitó
                            y por qué.
                        </span>
                    </Notice>
                ) : (
                    <>
                        <Notice variant="info" compact icon={Sparkles}>
                            <span className="font-bold">Queda con tu nombre y la hora.</span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                Si el turno ya pasó, se guarda igual y se marca fuera de hora.
                            </span>
                        </Notice>

                        {puntos.length > 0 && (
                            <ListaDePuntos puntos={puntos} marcadas={marcadas} onCambiar={setMarcadas} />
                        )}

                        <PortalTextarea
                            label="Observaciones (opcional)" name="observaciones"
                            value={obs} onChange={(e) => setObs(e.target.value)}
                            rows={2} compact
                            placeholder="Sólo si hay algo que anotar: una gotera, una vitrina que hubo que reacomodar…"
                        />
                    </>
                )}

                {(corrigiendo || quitando) && (
                    <PortalTextarea
                        label={quitando ? 'Por qué se quita' : 'Motivo de la corrección'}
                        name="motivo" required rows={2} compact
                        value={motivo} onChange={(e) => setMotivo(e.target.value)}
                        placeholder={quitando
                            ? 'Se marcó por error: la limpieza todavía no se había hecho.'
                            : 'Faltó marcar el estante del fondo.'}
                    />
                )}

                {error && <Notice variant="danger" compact icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={() => onCerrar(false)} disabled={guardando}>
                    Cancelar
                </Button>
                <Button variant={quitando ? 'danger' : 'primary'}
                    icon={quitando ? XCircle : undefined}
                    onClick={guardar} loading={guardando} disabled={faltaMotivo}>
                    {quitando ? 'Quitar' : corrigiendo ? 'Guardar la corrección' : 'Registrar'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
