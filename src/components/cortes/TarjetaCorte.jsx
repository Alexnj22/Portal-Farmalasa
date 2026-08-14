import React, { memo } from 'react';
import { AlertTriangle, Ban, CheckCircle2 } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidAvatar from '../common/LiquidAvatar';
import { clickable } from '../../utils/clickable';
import { contraste, diferenciaDelCorte, severidad } from '../../utils/cortesDiagnostico';
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
 * Vive ACÁ y no en cada llamador (2026-08-14, pedido del usuario):
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

const TONO_TEXTO  = { ok: 'text-success-text', sobra: 'text-warning-text', falta: 'text-danger-text' };
const TONO_FRANJA = { ok: 'bg-success/40',     sobra: 'bg-warning',        falta: 'bg-danger' };

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
    const cuadra = sev === 'ok';

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

    return (
        <div
            data-surface="card"
            {...clickable(abrir, { label: `Revisar el corte de las ${hhmm(corte.hora)}${sala ? ` de ${sala}` : ''}` })}
            className={`relative overflow-hidden flex flex-col gap-2 ${compacta ? 'p-2.5 pl-3.5' : 'p-3 pl-4'}`}
        >
            {/* La franja es FORMA, no sólo color: se lee sin distinguir tonos. */}
            <span aria-hidden="true"
                className={`absolute left-0 inset-y-0 w-1 ${esZ || desc ? 'bg-transparent' : TONO_FRANJA[sev]}`} />

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

                <div className={`font-bold tabular-nums shrink-0 text-right ${compacta ? 'text-label' : 'text-body'}
                    ${esZ ? 'text-content-2' : desc ? 'text-content-3 line-through' : TONO_TEXTO[sev]}`}>
                    {esZ
                        ? <>{formatMoney(corte.total_declarado)}<span className="block text-caption font-normal text-content-3">en ventas</span></>
                        : conSigno(desc ? diferenciaDelCorte(corte).valor : (corte.tramo ?? 0))}
                </div>
            </div>

            {(esZ || !pendiente || revisar) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    {esZ && <Badge variant="info" size="sm">Cierre del día</Badge>}
                    {corte.estado === 'CONFIRMADO' && <Badge variant="success" size="sm" icon={CheckCircle2}>Confirmado</Badge>}
                    {desc && <Badge variant="neutral" size="sm" icon={Ban}>Descartado</Badge>}
                    {revisar && <Badge variant="danger" size="sm" icon={AlertTriangle}>Revisar cifras</Badge>}
                </div>
            )}

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
                        <div className="text-micro text-content-3 tabular-nums truncate">
                            {selloDeTiempo(corte.resuelto_at) || 'Sin hora registrada'}
                            {desc && corte.motivo_descarte ? ` · ${corte.motivo_descarte}` : ''}
                        </div>
                    </div>
                </div>
            )}

            {/* Alineados a la derecha y del ancho de su texto: estirados a todo
                lo ancho, el botón azul pesaba más que la cifra, que es lo único
                que hay que leer antes de decidir. */}
            {pendiente && !esZ && puedeResolver && (
                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                    <Button variant="secondary" size="sm" icon={Ban} onClick={descartar}>
                        Descartar
                    </Button>
                    <Button variant="primary" size="sm" icon={CheckCircle2} loading={ocupado}
                        onClick={confirmar}>
                        Confirmar
                    </Button>
                </div>
            )}
        </div>
    );
});

export default TarjetaCorte;
