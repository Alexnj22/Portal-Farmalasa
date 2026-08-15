import React, { memo } from 'react';
import { AlertTriangle, Ban, CheckCircle2 } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidAvatar from '../common/LiquidAvatar';
import OjoDeTarjeta from '../common/OjoDeTarjeta';
import { clickable } from '../../utils/clickable';
import { contraste, diferenciaDelCorte, seConfirmaDeUnClic, severidad } from '../../utils/cortesDiagnostico';
import { formatMoney } from '../../utils/formatNumber';

/**
 * Un corte de caja, en tarjeta.
 *
 * La misma tarjeta la usan el módulo (en rejilla, agrupada por sala) y la
 * baldosa del Inicio (en columna, `compacta`). Es una sola definición a
 * propósito: si la sala confirma desde el Inicio y el supervisor revisa desde
 * el módulo, los dos tienen que estar mirando lo mismo.
 *
 * ── La regla de cuándo se abre el detalle ──────────────────────────────────
 * UNA sola definición, en `seConfirmaDeUnClic` (2026-08-14, pedido del
 * usuario). Vivía dentro de esta tarjeta, y se movió a `cortesDiagnostico`
 * —sin cambiarla— el día que la campana también empezó a ofrecer «Confirmar»:
 * quedarse acá habría obligado a la campana a repetirla, que es justo lo que la
 * regla evita. Los llamadores no la reimplementan; la aplican.
 *
 *   · cuadra al centavo  → «Confirmar» resuelve de un clic, no hay nada que leer
 *   · tiene diferencia   → «Confirmar» ABRE el detalle, con el monto, de dónde
 *                          sale la cifra y qué revisar; se firma después
 *   · «Descartar»        → siempre abre: descartar exige decir por qué
 *
 * Escrita en dos sitios se desincroniza, y el día que se desincronice va a
 * significar que desde una pantalla se puede dar por bueno un faltante sin
 * verlo.
 */

// El color va en el NÚMERO, que es donde el color ES el dato (§17.0), y la
// severidad se dice además con una palabra: un `Badge`, que es la etiqueta de
// estado canónica (§16.1). Antes iba una franja vertical dibujada a mano
// —`absolute left-0 inset-y-0 w-1`—, o sea un elemento de color inventado para
// esta pantalla que nadie más tenía y que sólo comunicaba por tono.
const TONO_TEXTO = { ok: 'text-success-text', sobra: 'text-warning-text', falta: 'text-danger-text' };
const SEVERIDAD_BADGE = {
    sobra: { variant: 'warning', label: 'Sobrante' },
    falta: { variant: 'danger',  label: 'Faltante' },
};

const hhmm = (hora) => String(hora || '').slice(0, 5);
const conSigno = (n) => (n > 0 ? `+${formatMoney(n)}` : formatMoney(n));

const selloDeTiempo = (iso) => (iso
    ? new Date(iso).toLocaleString('es-SV', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        hour12: true, timeZone: 'America/El_Salvador',
    })
    : '');

const iniciales = (nombre) => String(nombre || '?')
    .trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const TarjetaCorte = memo(function TarjetaCorte({
    corte,
    sala,                  // nombre de la sala; null para no mostrarlo
    persona = null,        // quien resolvió: { name, photo_url }
    puedeResolver = false,
    onAbrir,               // (corte, modo|null)
    onConfirmar,           // (corte) — el camino de un clic, sólo si cuadra
    ocupado = false,
    compacta = false,
}) {
    const esZ = corte.tipo === 'Z';
    const desc = corte.estado === 'DESCARTADO';
    const pendiente = corte.estado === 'PENDIENTE';
    const sev = severidad(corte.tramo);
    const ct = contraste(corte);
    const revisar = !!ct?.enDisputa && !ct.porCobrosCredito;
    const cuadra = seConfirmaDeUnClic(corte);

    const abrir = () => onAbrir?.(corte, null);

    // El botón principal: de un clic cuando cuadra, con el detalle delante
    // cuando no. Ver la nota de arriba.
    const confirmar = (e) => {
        e.stopPropagation();
        if (cuadra) onConfirmar?.(corte);
        else onAbrir?.(corte, 'confirmar');
    };
    const descartar = (e) => {
        e.stopPropagation();
        onAbrir?.(corte, 'descartar');
    };

    // ── En `compacta` las etiquetas y los botones COMPARTEN renglón ─────────
    // La baldosa del Inicio tiene alto fijo: cada renglón que se lleva una
    // tarjeta es una tarjeta menos a la vista. Con la píldora de severidad
    // arriba y los dos botones abajo entraban dos cortes de los cuatro que
    // había sin confirmar — o sea que la baldosa escondía justo la mitad del
    // trabajo que existe para anunciar.
    //
    // Se pueden juntar porque NUNCA compiten: los botones sólo salen mientras
    // el corte está pendiente, y el bloque de quién firmó sólo cuando ya no lo
    // está. En la vista completa siguen en renglones separados — ahí sobra
    // ancho y la fila de acciones alineada a la derecha es la forma del portal.
    const hayEtiquetas = esZ || !pendiente || revisar || (!cuadra && !desc);
    const hayAcciones = pendiente && !esZ && puedeResolver;

    const etiquetas = hayEtiquetas ? (
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {esZ && <Badge variant="info" size="sm">Cierre del día</Badge>}
            {!esZ && !desc && !cuadra && (
                <Badge variant={SEVERIDAD_BADGE[sev].variant} size="sm" dot>
                    {SEVERIDAD_BADGE[sev].label}
                </Badge>
            )}
            {corte.estado === 'CONFIRMADO' && <Badge variant="success" size="sm" icon={CheckCircle2}>Confirmado</Badge>}
            {desc && <Badge variant="neutral" size="sm" icon={Ban}>Descartado</Badge>}
            {revisar && <Badge variant="danger" size="sm" icon={AlertTriangle}>Revisar cifras</Badge>}
        </div>
    ) : null;

    // Alineados a la derecha y del ancho de su texto: estirados a todo lo
    // ancho, el botón azul pesaba más que la cifra, que es lo único que hay que
    // leer antes de decidir.
    //
    // `ml-auto` y NO `justify-between` en el renglón: un corte que cuadra al
    // centavo no lleva píldora de severidad, así que las acciones quedaban de
    // hijo único y `justify-between` las mandaba a la IZQUIERDA. O sea que los
    // botones cambiaban de sitio según si la tarjeta tenía etiqueta o no —
    // reportado sobre la baldosa, donde las tres tarjetas se ven juntas y el
    // salto canta. Empujándolas con `ml-auto` el sitio es el mismo siempre,
    // haya etiqueta o no.
    const acciones = hayAcciones ? (
        <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
            <Button variant="secondary" size="sm" icon={Ban} onClick={descartar}>
                Descartar
            </Button>
            <Button variant="primary" size="sm" icon={CheckCircle2} loading={ocupado}
                onClick={confirmar}>
                Confirmar
            </Button>
        </div>
    ) : null;

    return (
        <div
            data-surface="card"
            {...clickable(abrir, { label: `Revisar el corte de las ${hhmm(corte.hora)}${sala ? ` de ${sala}` : ''}` })}
            className={`group flex flex-col ${compacta ? 'gap-1.5 p-2' : 'gap-2 p-3'}`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                        {sala && (
                            <span className="text-label font-bold text-content truncate">{sala}</span>
                        )}
                        <span className="text-caption text-content-2 font-semibold tabular-nums">{hhmm(corte.hora)}</span>
                    </div>
                    <div className="text-caption text-content-3 truncate">
                        {corte.empleado_texto || 'Sin nombre'}
                    </div>
                </div>

                {/* La cifra manda y el ojo la acompaña: la tarjeta ABRE el corte
                    —con su detalle y su decisión— y hasta hoy no lo decía en
                    ninguna parte. Es el canónico de §5.3, el mismo que llevan
                    las solicitudes. */}
                <div className="flex items-start gap-1.5 shrink-0">
                    <div className={`font-bold tabular-nums text-right ${compacta ? 'text-label' : 'text-body'}
                        ${esZ ? 'text-content-2' : desc ? 'text-content-3 line-through' : TONO_TEXTO[sev]}`}>
                        {esZ
                            ? <>{formatMoney(corte.total_declarado)}<span className="block text-caption font-normal text-content-3">en ventas</span></>
                            : conSigno(desc ? diferenciaDelCorte(corte).valor : (corte.tramo ?? 0))}
                    </div>
                    <OjoDeTarjeta size={13} className="mt-0.5" />
                </div>
            </div>

            {/* Compacta: etiquetas y acciones en UN renglón. Ver la nota de
                arriba. `mt-auto` SÓLO cuando hay acciones: es lo que alinea los
                botones al pie en una rejilla de alturas iguales, pero en un
                corte ya resuelto abajo va el bloque de quién firmó, y empujar
                las etiquetas al fondo las metería debajo de él.

                `flex-wrap` es lo que salva al TELÉFONO: ahí la baldosa mide
                ~320px y la píldora más los dos botones no entran juntos. Sin
                envolver, los tres se aprietan en el mismo renglón y los botones
                le comen el ancho a la etiqueta —reportado—. Envolviendo, las
                acciones bajan a su propio renglón y `ml-auto` las deja igual de
                alineadas a la derecha que cuando entran al lado. */}
            {compacta && (etiquetas || acciones) ? (
                <div className={`flex items-center gap-x-2 gap-y-1.5 flex-wrap ${acciones ? 'mt-auto' : ''}`}>
                    {etiquetas}
                    {acciones}
                </div>
            ) : etiquetas}

            {/* Quién firmó la decisión, con su cara y la hora. Pedido del
                usuario: al confirmar o rechazar se ve SIEMPRE el nombre, la
                foto y la fecha/hora — un estado sin autor no se puede
                reclamar. */}
            {!pendiente && !esZ && (
                <div className="flex items-center gap-2 pt-2 border-t border-divider">
                    <LiquidAvatar
                        src={persona?.photo_url}
                        alt={persona?.name || 'Quien resolvió el corte'}
                        fallbackText={iniciales(persona?.name)}
                        className="w-6 h-6 rounded-full shrink-0 text-micro"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="text-caption font-semibold text-content-2 truncate">
                            {persona?.name || 'Sin registrar quién'}
                        </div>
                        {/* `text-caption`, no `text-micro`: 9px es para
                            contadores y superíndices (§7), y esto es un dato
                            que alguien tiene que poder leer. */}
                        <div className="text-caption text-content-3 tabular-nums truncate">
                            {selloDeTiempo(corte.resuelto_at) || 'Sin hora registrada'}
                            {desc && corte.motivo_descarte ? ` · ${corte.motivo_descarte}` : ''}
                        </div>
                    </div>
                </div>
            )}

            {/* En la vista completa las acciones van en su propio renglón. */}
            {!compacta && acciones && (
                <div className="mt-auto pt-0.5">{acciones}</div>
            )}
        </div>
    );
});

export default TarjetaCorte;
