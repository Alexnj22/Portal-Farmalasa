import React, { useCallback, useEffect, useState } from 'react';
import { AtSign, CheckCircle2, Mail, Send } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useToastStore } from '../../store/toastStore';
import { fetchDatosPedidos, responderDatoPedido } from '../../data/datosPedidos';

// ═══════════════════════════════════════════════════════════════════════════
// Lo que el portal le PIDE a la sala para poder terminar un documento.
//
// Hoy hay un solo caso: el correo de un cliente contribuyente que Hacienda
// rechazó y que el circuito no puede arreglar solo. Los errores de dedo
// —espacios, «.con» por «.com»— se corrigen sin molestar a nadie; acá sólo
// llega lo que hace falta AVERIGUAR, y quien puede es la sala que tuvo al
// cliente enfrente.
//
// ── Por qué se contesta ACÁ y no en Clientes ───────────────────────────────
// Porque la sala no puede editar clientes —ningún cargo de sala tiene
// `clientes.can_edit`— y dárselo para esto abriría las 28,000 fichas para
// resolver un campo de una. Acá no edita a un cliente: contesta una pregunta
// sobre SU venta. El portal hace el resto — escribe el correo donde se emite el
// documento y lo vuelve a transmitir.
//
// ── El resultado se dice tal cual ──────────────────────────────────────────
// Al confirmar, el documento se reintenta en el momento. Puede entrar, o puede
// volver a rechazarse por otra cosa. Decir «listo» en los dos casos sería
// mentirle a quien acaba de contestar, así que el aviso distingue: «ya entró» o
// «se guardó, pero el documento sigue pendiente por…».
//
// ── El correo no es un campo cualquiera ───────────────────────────────────
// Va a un documento fiscal a nombre de otra persona. Por eso no hay «guardar
// como borrador» ni autocompletado: se escribe, se confirma, y queda registrado
// quién lo contestó.
// ═══════════════════════════════════════════════════════════════════════════

const REFRESCO_MS = 5 * 60 * 1000;

const fmtFecha = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    : '—');

function Pedido({ p, onListo }) {
    const [valor, setValor] = useState('');
    const [enviando, setEnviando] = useState(false);

    const confirmar = async () => {
        setEnviando(true);
        const r = await responderDatoPedido(p.id, valor);
        setEnviando(false);
        if (!r?.ok) {
            useToastStore.getState().showToast('No se pudo guardar', r?.error || 'Intenta de nuevo.', 'error');
            return;
        }
        // El documento se reintentó: se informa lo que pasó de verdad.
        if (r.documento?.entro) {
            useToastStore.getState().showToast(
                'Listo', `${p.correlativo || 'La venta'} ya quedó completa.`, 'success');
        } else {
            useToastStore.getState().showToast(
                'Correo guardado',
                r.documento?.motivo
                    ? `El documento sigue pendiente: ${r.documento.motivo}`
                    : 'El documento se vuelve a intentar esta noche.',
                'info', 8000);
        }
        onListo();
    };

    return (
        <div data-surface="card" className="p-4 space-y-3">
            <div className="flex items-start gap-2 flex-wrap">
                <Badge variant="warning" uppercase={false}>Falta el correo</Badge>
                {p.correlativo && (
                    <span className="font-mono text-body-sm font-black text-content">{p.correlativo}</span>
                )}
                <span className="text-label text-content-3">{fmtFecha(p.fecha)}</span>
                <span className="text-label text-content-3 ml-auto">{p.sala}</span>
            </div>

            <p className="text-body-sm text-content-2 leading-relaxed">
                El correo de <span className="font-bold text-content">{p.cliente}</span> no
                es válido y esta venta no puede completarse sin uno correcto.
                {p.valor_actual && (
                    <> Hoy dice <span className="font-mono text-content-3">«{p.valor_actual}»</span>.</>
                )}
            </p>

            <PortalInput
                icon={AtSign}
                label="Correo correcto"
                name={`correo-${p.id}`}
                type="email"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="cliente@ejemplo.com"
                inputMode="email"
                autoComplete="off"
            />

            <Button
                variant="primary"
                icon={enviando ? undefined : Send}
                onClick={confirmar}
                disabled={enviando || !valor.trim()}
                className="w-full min-h-[var(--tap-min)]"
            >
                {enviando ? 'Guardando…' : 'Confirmar y enviar'}
            </Button>
        </div>
    );
}

export default function WidgetDatoPedido() {
    const [filas, setFilas]   = useState([]);
    const [cargando, setCarg] = useState(true);
    const [error, setError]   = useState(null);

    const cargar = useCallback(async () => {
        try {
            setFilas(await fetchDatosPedidos());
            setError(null);
        } catch (e) {
            // Un fallo NO puede quedar como «no hay nada pendiente»: ese silencio
            // es exactamente el defecto que este circuito vino a cerrar.
            setError(e?.message || String(e));
            setFilas([]);
        } finally {
            setCarg(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => {
        const id = setInterval(cargar, REFRESCO_MS);
        return () => clearInterval(id);
    }, [cargar]);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <Mail size={16} className="text-content-2" strokeWidth={2.5} />
                <h3 className="text-body-sm font-black text-content">Datos que faltan</h3>
                {filas.length > 0 && <Badge variant="warning" size="sm">{filas.length}</Badge>}
            </div>

            {error && <Notice tone="danger">{error}</Notice>}

            {cargando ? <SkeletonText lines={3} />
                : filas.length === 0 ? (
                    <EmptyState
                        icon={CheckCircle2}
                        title="Sin datos pendientes"
                        subtitle="Cuando una venta necesite un dato del cliente, aparece aquí."
                    />
                ) : filas.map(p => <Pedido key={p.id} p={p} onListo={cargar} />)}
        </div>
    );
}
