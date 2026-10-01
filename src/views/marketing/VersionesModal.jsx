import React, { useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import FileField from '../../components/common/FileField';
import PieDeModal from '../../components/common/PieDeModal';
import Campo from '../promociones/Campo';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaHora12 } from '@nucleo/utils/hora';
import { versionesDe, tipoDeArchivo } from '@nucleo/utils/marketing';
import { subirDiseno } from '@nucleo/data/marketing';
import { medirArchivo } from './medir';

/**
 * Las versiones de un diseño, lado a lado. Por defecto compara la última con
 * la anterior —es la pregunta de quien revisa: «¿qué cambió?»—, y se puede
 * elegir cualquier par. Quien edita sube desde acá la versión siguiente.
 */
export default function VersionesModal({ archivos, archivo, firmadas, mesId, piezaId, yoId, puedeEditar, onClose, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const cadena = versionesDe(archivos, archivo);
    const ultima = cadena[cadena.length - 1];
    const [izq, setIzq] = useState(() => (cadena.length > 1 ? cadena[cadena.length - 2].id : ultima.id));
    const [der, setDer] = useState(ultima.id);
    const [subiendo, setSubiendo] = useState(false);
    const opciones = cadena.map((a) => ({ value: a.id, label: `V${a.version} · ${fechaHora12(a.created_at, { day: 'numeric', month: 'short' })}` }));

    const subir = async (nuevo) => {
        if (!nuevo) return;
        setSubiendo(true);
        try {
            const medidas = await medirArchivo(nuevo);
            await subirDiseno({ mesId, piezaId, archivo: nuevo, subidoPor: yoId, anteriorId: ultima.id, medidas });
            showToast(`V${ultima.version + 1} subida`, nuevo.name, 'success');
            onCambio?.();
            onClose();
        } catch (err) {
            showToast('No se pudo subir la versión', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setSubiendo(false);
        }
    };

    const panel = (id, setId, rotulo) => {
        const a = cadena.find((x) => x.id === id) || ultima;
        const src = firmadas?.get?.(a.url);
        const tipo = tipoDeArchivo(a);
        return (
            <div className="space-y-2 min-w-0">
                <Campo rotulo={rotulo}>
                    <LiquidSelect value={id} onChange={(v) => setId(v)} options={opciones} clearable={false} />
                </Campo>
                <div className="rounded-lg overflow-hidden border border-border-card bg-surface-input flex items-center justify-center min-h-[240px]">
                    {tipo === 'imagen' && src && <img src={src} alt={`Versión ${a.version}`} className="max-w-full max-h-[60dvh] object-contain" />}
                    {tipo === 'video' && src && <video src={src} controls playsInline className="max-w-full max-h-[60dvh]" />}
                    {(!src || !['imagen', 'video'].includes(tipo)) && (
                        <span className="flex flex-col items-center gap-1 text-content-3 p-6">
                            <FileText size={24} />
                            <span className="text-caption">{a.nombre || 'Archivo'}</span>
                        </span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-6xl" ariaLabel="Versiones del diseño">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content truncate">
                    Versiones · {ultima.nombre || 'diseño'} <span className="text-content-3 font-normal">({cadena.length})</span>
                </h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    {cadena.length > 1 ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            {panel(izq, setIzq, 'Antes')}
                            {panel(der, setDer, 'Después')}
                        </div>
                    ) : (
                        <p className="text-body-sm text-content-3">Es la primera versión: todavía no hay con qué comparar.</p>
                    )}
                    {puedeEditar && (
                        <FileField label={`Subir la V${ultima.version + 1}`} accept="image/*,video/*,.pdf" maxSizeMB={200}
                            file={null} onChange={subir} busy={subiendo} busyLabel="Subiendo la versión…"
                            conEditor={false} conTelefono={false} />
                    )}
                </div>
            </LiquidModal.Body>
            <PieDeModal izquierda={puedeEditar && <span className="text-caption text-content-3 flex items-center gap-1"><Upload size={13} /> La anterior queda guardada</span>}>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            </PieDeModal>
        </LiquidModal>
    );
}
