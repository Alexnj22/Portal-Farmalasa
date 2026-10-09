import React, { useMemo, useState } from 'react';
import { Plus, Trash2, ExternalLink, Download, Palette, Image as ImageIcon, Type, FileText, Copy, BookOpen } from 'lucide-react';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import FileField from '../../components/common/FileField';
import ConfirmModal from '../../components/common/ConfirmModal';
import { EmptyState } from '../../components/common/StateViews';
import Campo from '../promociones/Campo';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { downloadStoredFile, openStoredFile } from '@nucleo/utils/storageFiles';
import { guardarRecurso, quitarRecurso } from '@nucleo/data/marketing';
import { TIPOS_DE_RECURSO, colorEscrito, colorValido as esColorValido, faltaEnRecurso, recursosPorMarca } from '@nucleo/utils/marketing';
import { abrirEnPestanaNueva } from '@plataforma/descargas';
import { puntoDeMarca } from './iconos';

// Rótulos, validación y agrupado: núcleo (`marketing`), lo mismo que la app; acá, los íconos.
const ICONO_RECURSO = { logo: ImageIcon, color: Palette, tipografia: Type, foto: ImageIcon, plantilla: FileText, manual: BookOpen, otro: FileText };
const TIPOS = TIPOS_DE_RECURSO.map((t) => ({ ...t, icono: ICONO_RECURSO[t.value] }));
const VACIO = { tipo: 'logo', marca_id: '', nombre: '', enlace: '', color: '' };

/**
 * La biblioteca de marca: logos, paleta, tipografías, fotos y plantillas de
 * cada farmacia (o de todas), para que el diseñador no tenga que pedirlos cada
 * vez. Un color se guarda como `#RRGGBB` y se copia con un toque.
 */
export default function TabBiblioteca({ recursos, marcas, firmadas, puedeGestionar, yoId, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [form, setForm] = useState(VACIO);
    const [archivo, setArchivo] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [quitando, setQuitando] = useState(null);
    const marcasLista = Object.values(marcas);

    const grupos = useMemo(() => recursosPorMarca(recursos, marcasLista), [recursos, marcasLista]);

    const esColor = form.tipo === 'color';
    const colorValido = esColorValido(form.color);
    const falta = faltaEnRecurso(form, !!archivo);

    const agregar = async () => {
        if (falta) return;
        setGuardando(true);
        try {
            await guardarRecurso({ ...form, color: esColor ? form.color.toUpperCase() : null, enlace: esColor ? null : form.enlace },
                esColor ? null : archivo, yoId);
            setForm((f) => ({ ...VACIO, tipo: f.tipo, marca_id: f.marca_id }));
            setArchivo(null);
            onCambio?.();
        } catch (err) {
            showToast('No se pudo agregar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    const quitar = async () => {
        try {
            await quitarRecurso(quitando);
            setQuitando(null);
            onCambio?.();
        } catch (err) {
            showToast('No se pudo quitar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    const copiarColor = async (c) => {
        try {
            await navigator.clipboard.writeText(c);
            showToast('Color copiado', c, 'success');
        } catch {
            showToast('No se pudo copiar', c, 'error');
        }
    };

    return (
        <div className="space-y-6">
            {puedeGestionar && (
                <section data-surface="card" className="p-4 space-y-3">
                    <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Agregar a la biblioteca</h3>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Campo rotulo="Qué es">
                            <LiquidSelect value={form.tipo} clearable={false}
                                onChange={(v) => setForm((f) => ({ ...f, tipo: v }))}
                                options={TIPOS.map((t) => ({ value: t.value, label: t.label }))} />
                        </Campo>
                        <Campo rotulo="De qué marca">
                            <LiquidSelect value={form.marca_id} placeholder="Todas"
                                onChange={(v) => setForm((f) => ({ ...f, marca_id: v || '' }))}
                                options={marcasLista.map((m) => ({ value: m.id, label: m.nombre }))} />
                        </Campo>
                        <PortalInput label="Nombre" name="recurso_nombre" value={form.nombre}
                            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                            placeholder={esColor ? 'Ej. Azul principal' : 'Ej. Logo horizontal blanco'} />
                    </div>
                    {esColor ? (
                        <PortalInput label="Color (#RRGGBB)" name="recurso_color" value={form.color}
                            onChange={(e) => { const v = colorEscrito(e.target.value); setForm((f) => ({ ...f, color: v })); }}
                            placeholder="Seis dígitos, ej. 1A47C5" hasError={!!form.color && !colorValido} />
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 items-end">
                            <FileField label="Archivo" accept="image/*,video/*,.pdf,.zip,.ttf,.otf,.ai,.psd" maxSizeMB={200}
                                file={archivo} onChange={setArchivo} conEditor={false} conTelefono={false} />
                            <PortalInput label="O un enlace (Drive, Canva)" name="recurso_enlace" value={form.enlace}
                                onChange={(e) => setForm((f) => ({ ...f, enlace: e.target.value }))} placeholder="https://…" />
                        </div>
                    )}
                    <div className="flex justify-end">
                        <Button icon={Plus} loading={guardando} disabled={falta} onClick={agregar}>Agregar</Button>
                    </div>
                </section>
            )}

            {!grupos.length && (
                <EmptyState icon={Palette} title="Sin recursos de marca"
                    subtitle={puedeGestionar ? 'Sube los logos, la paleta y las tipografías de cada farmacia.' : 'Todavía no se cargó la biblioteca de marca.'} />
            )}

            {grupos.map((g) => (
                <section key={g.id || 'todas'} className="space-y-3">
                    <h3 className="flex items-center gap-2 text-label uppercase tracking-wide font-semibold text-content-2">
                        {g.color && <span className={`w-2.5 h-2.5 rounded-full ${puntoDeMarca(g.color)}`} aria-hidden />}
                        {g.nombre}
                    </h3>
                    {TIPOS.map((t) => {
                        const items = g.items.filter((r) => r.tipo === t.value);
                        if (!items.length) return null;
                        return (
                            <div key={t.value} className="space-y-2">
                                <p className="text-caption text-content-3">{t.label}</p>
                                <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
                                    {items.map((r) => (
                                        <Recurso key={r.id} recurso={r} src={r.url ? firmadas?.get?.(r.url) : null}
                                            puedeGestionar={puedeGestionar} onQuitar={() => setQuitando(r)} onCopiarColor={copiarColor} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </section>
            ))}

            <ConfirmModal isOpen={!!quitando} onClose={() => setQuitando(null)} onConfirm={quitar}
                title="¿Quitar de la biblioteca?" message={`«${quitando?.nombre}» deja de estar disponible.`} confirmText="Quitar" />
        </div>
    );
}

function Recurso({ recurso: r, src, puedeGestionar, onQuitar, onCopiarColor }) {
    const esImagen = String(r.mime || '').startsWith('image/');
    return (
        <figure data-surface="card" className="p-0 overflow-hidden flex flex-col min-w-0">
            <div className="aspect-square bg-surface-input flex items-center justify-center">
                {r.color && (
                    // El color ES el dato: se pinta tal cual viene de la base.
                    <span className="w-full h-full" style={{ backgroundColor: r.color }} role="img" aria-label={`Color ${r.color}`} />
                )}
                {!r.color && esImagen && src && <img src={src} alt={r.nombre} loading="lazy" className="w-full h-full object-contain p-2" />}
                {!r.color && !(esImagen && src) && <FileText size={24} className="text-content-3" />}
            </div>
            <figcaption className="px-2 py-1.5 space-y-1 min-w-0">
                <p className="text-caption font-semibold text-content truncate" title={r.nombre}>{r.nombre}</p>
                {r.color && <p className="text-micro text-content-3 tabular-nums">{r.color}</p>}
                <div className="flex items-center gap-1">
                    {r.color && <Button variant="ghost" size="xs" iconOnly icon={Copy} title={`Copiar ${r.color}`} onClick={() => onCopiarColor(r.color)} />}
                    {r.url && <Button variant="ghost" size="xs" iconOnly icon={Download} title={`Descargar ${r.nombre}`} onClick={() => downloadStoredFile(r.url, r.nombre)} />}
                    {r.url && <Button variant="ghost" size="xs" iconOnly icon={ExternalLink} title={`Abrir ${r.nombre}`} onClick={() => openStoredFile(r.url)} />}
                    {r.enlace && <Button variant="ghost" size="xs" iconOnly icon={ExternalLink} title={r.enlace} onClick={() => abrirEnPestanaNueva(r.enlace)} />}
                    {puedeGestionar && <Button variant="ghost" size="xs" iconOnly icon={Trash2} title={`Quitar ${r.nombre}`} onClick={onQuitar} className="ml-auto" />}
                </div>
            </figcaption>
        </figure>
    );
}
