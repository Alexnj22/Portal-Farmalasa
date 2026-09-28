import { useState } from 'react';
import { XCircle } from 'lucide-react';
import ModalShell from '../../../components/common/ModalShell';
import CuerpoDialogo from '../../../components/common/CuerpoDialogo';
import LiquidSelect from '../../../components/common/LiquidSelect';
import Button from '../../../components/common/Button';
import PortalTextarea from '../../../components/common/PortalTextarea';
import { MOTIVO_AJUSTE } from './constants';

/**
 * Poner un producto en 0 en todas las salas — y decir por qué.
 *
 * A diferencia de `MotivoAjusteModal`, acá el porqué es OBLIGATORIO (pedido del
 * usuario, 2026-09-28): es la decisión más fuerte del módulo, la toma una sola
 * persona para las siete salas, y sin el motivo el historial sólo decía «0 en
 * todas» sin explicar nada. La base también lo exige (`FALTA_MOTIVO`).
 *
 * «Ya no rota» se ofrece sólo con alcance total —borra historial de demanda,
 * misma regla que el trigger `marcar_ajuste_manual_minmax`—; los demás lo
 * escriben como «otro» con su nota.
 */
export default function CeroEnTodasModal({ open, row, puedeYaNoRota, onConfirmar, onClose }) {
    // El llamador lo monta con `key` por producto: abrirlo sobre otra fila crea
    // un componente nuevo en vez de arrastrar lo escrito en la anterior.
    const [motivo, setMotivo] = useState('otro');
    const [nota, setNota]     = useState('');
    const [guardando, setGuardando] = useState(false);

    if (!open || !row) return null;

    const cls = row.draft_abc_class || row.abc_class;
    const altaRotacion = cls === 'A' || cls === 'B';
    const falta = !nota.trim() ? 'Escribe por qué se pone en 0.' : null;

    const opciones = [
        { value: 'otro', label: 'Otro motivo' },
        ...(puedeYaNoRota ? [{ value: 'ya_no_rota', label: MOTIVO_AJUSTE.ya_no_rota.label }] : []),
    ];

    const confirmar = async () => {
        if (falta || guardando) return;
        // `onConfirmar` no lanza: si la base rechaza, avisa con su propio toast
        // y el diálogo queda abierto con lo escrito.
        setGuardando(true);
        await onConfirmar({ motivo, nota: nota.trim() });
        setGuardando(false);
    };

    return (
        <ModalShell open onClose={onClose} maxWidthClass="max-w-md" zClass="z-tooltip"
                    surface={null} ariaLabel="Poner en 0 en todas las salas">
            <CuerpoDialogo
                titulo={row.product_name}
                subtitulo="Poner 0 en todas las salas"
                icono={XCircle}
                anchoEscritorio="max-w-md"
                pie={
                    <>
                        <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
                        <Button variant="danger" onClick={confirmar} disabled={!!falta || guardando} loading={guardando}>
                            Poner 0 en todas
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4 text-left">
                    <p className="text-body-sm text-content-2">
                        Quedará en 0 / 0 en todas las sucursales y en Bodega, y se publica en este momento.
                        {altaRotacion && (
                            <> Es clase {cls} y vende {Number(row.daily_velocity ?? 0).toFixed(1)} und/día.</>
                        )}
                    </p>

                    {opciones.length > 1 && (
                        <div className="flex flex-col gap-1.5">
                            <label className="text-label text-content-2">Motivo</label>
                            <LiquidSelect value={motivo} onChange={setMotivo} options={opciones} />
                            {motivo === 'ya_no_rota' && (
                                <p className="text-body-sm text-content-3">{MOTIVO_AJUSTE.ya_no_rota.detalle}</p>
                            )}
                        </div>
                    )}

                    <PortalTextarea
                        label="¿Por qué?"
                        name="motivo_cero_en_todas"
                        rows={3}
                        value={nota}
                        onChange={e => setNota(e?.target?.value ?? '')}
                        placeholder="Descontinuado, lo retiró el proveedor, sólo se trae por encargo…"
                    />

                    {falta && nota.length > 0 && <p className="text-body-sm text-warning-text">{falta}</p>}
                </div>
            </CuerpoDialogo>
        </ModalShell>
    );
}
