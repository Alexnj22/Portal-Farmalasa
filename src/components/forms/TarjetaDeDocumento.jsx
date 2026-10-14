/**
 * Un documento del expediente, con lo que hay que saber de él a la vista.
 *
 * Pedido del usuario el 2026-10-13, sobre la pestaña Documentos del alta:
 * *«todos los documentos que tengan vence, se debe ver en la ficha del
 * documento»* y *«cada documento se debe ver quién lo subió»*. Hasta hoy el
 * vencimiento sólo aparecía DENTRO del campo de fecha —o sea, después de subir
 * el archivo y sólo para quien abría ese campo—, y quién lo subió no aparecía
 * en ningún lado.
 *
 * La tarjeta responde tres preguntas sin abrir nada, en este orden:
 *   1. ¿Está? — Completo / Pendiente / Vencido / Vence pronto.
 *   2. ¿Hasta cuándo sirve? — la fecha de vencimiento, o el año que cubre.
 *   3. ¿Quién lo puso y cuándo?
 *
 * Lo de subir, ver y cambiar el archivo sigue siendo el bloque de siempre
 * (`children`): esta tarjeta no tiene un segundo camino para guardar.
 */
import React from 'react';
import { CalendarClock, CheckCircle2 } from 'lucide-react';
import Badge from '../common/Badge';
import AvatarConEstado from '../common/AvatarConEstado';
import { iconoDeCategoria, tinteDeCategoria } from '../common/catalogos/documentos';
import { anioQueCubre, estadoDelDocumento } from '@nucleo/utils/documentosDelExpediente';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';

const FECHA = { day: '2-digit', month: 'short', year: 'numeric' };

/**
 * @param {string}  categoria
 * @param {string}  titulo
 * @param {object}  doc            la entrada de `employee_documents`
 * @param {boolean} [conVencimiento]  si este papel trae fecha de vencimiento
 * @param {boolean} [porAnio]      vale por año calendario (el certificado médico)
 * @param {string}  [vencimiento]  para el DUI: su fecha vive en la ficha, no en el documento
 * @param {React.ReactNode} [accion]  un botón chico debajo del título
 */
export default function TarjetaDeDocumento({ categoria, titulo, doc, conVencimiento = true, porAnio = false,
                                             vencimiento, accion, children }) {
    const fecha = vencimiento ?? doc?.expiry_date;
    const estado = estadoDelDocumento({ ...doc, expiry_date: fecha }, { conVencimiento });
    const Icono = iconoDeCategoria(categoria);
    const tinte = tinteDeCategoria(categoria);
    const anio = porAnio ? anioQueCubre(fecha) : null;

    return (
        <div data-surface="card" className="p-3.5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tinte.iconBg}`}>
                    {/* eslint-disable-next-line react-hooks/static-components -- Icono sale de `iconoDeCategoria`, que elige entre íconos ya importados; no crea un componente nuevo */}
                    <Icono size={16} className={tinte.iconCls} strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-black text-content leading-snug">{titulo}</p>
                    {/* El vencimiento SIEMPRE que el papel lo tiene, aun sin archivo:
                        «sin fecha» también es un dato — dice qué falta. */}
                    {conVencimiento && (
                        <p className="text-caption text-content-3 font-medium mt-0.5 flex items-center gap-1">
                            <CalendarClock size={12} className="shrink-0" />
                            {porAnio
                                ? (anio ? `Válido todo ${anio}` : 'Falta el año del certificado')
                                : (fecha ? `Vence ${fechaTexto(fecha, FECHA)}` : 'Sin fecha de vencimiento')}
                        </p>
                    )}
                    {/* La acción va DEBAJO del título y no al lado de la píldora:
                        en un teléfono las dos juntas se montaban sobre el nombre. */}
                    {accion && <div className="mt-1">{accion}</div>}
                </div>
                <Badge variant={estado.variant} size="sm" uppercase={false} className="shrink-0">
                    {estado.variant === 'success' && <CheckCircle2 size={11} className="mr-1 inline" strokeWidth={2.5} />}
                    {estado.label}
                </Badge>
            </div>

            {children}

            {doc?.url && doc?.subido_por && (
                <div className="flex items-center gap-2 pt-2 border-t border-divider min-w-0">
                    {doc.subido_por_id && (
                        <AvatarConEstado emp={{ id: doc.subido_por_id, name: doc.subido_por }} px={20}
                            mostrarChip={false} radio="rounded-full" marco="border border-border-card" />
                    )}
                    <p className="text-micro text-content-3 font-medium truncate">
                        Subido por <span className="font-bold text-content-2">{shortEmployeeName(doc.subido_por)}</span>
                        {doc.subido_el ? ` · ${fechaTexto(doc.subido_el, FECHA)}` : ''}
                    </p>
                </div>
            )}
        </div>
    );
}
