import React, { useState, useEffect } from 'react';
import LiquidSelect from './LiquidSelect';

const HOUR_OPTIONS = [...Array(12)].map((_, i) => {
    const v = (i + 1).toString().padStart(2, '0');
    return { value: v, label: v };
});
const MINUTE_OPTIONS = ['00', '15', '30', '45'].map(m => ({ value: m, label: m }));
const AMPM_OPTIONS = [{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }];

const TimePicker12 = ({ value, onChange, className = '', disabled, defaultMeridiem = 'AM' }) => {
    const [hour, setHour] = useState('');
    const [minute, setMinute] = useState('');
    const [ampm, setAmpm] = useState('');

    // Sincroniza el estado visual con el valor real del formulario
    useEffect(() => {
        if (value) {
            const [h, m] = value.split(':');
            let hInt = parseInt(h, 10);
            const isPm = hInt >= 12;
            setAmpm(isPm ? 'PM' : 'AM'); // eslint-disable-line react-hooks/set-state-in-effect -- sincroniza el estado visual desde el valor controlado
            hInt = hInt % 12;
            setHour(hInt === 0 ? '12' : hInt.toString().padStart(2, '0'));
            setMinute(m);
        } else {
            // Estado vacío visual
            setHour('');
            setMinute('');
            setAmpm('');
        }
    }, [value]);

    const updateTime = (h, m, ap) => {
        if (!h || !m || !ap) return;
        let hInt = parseInt(h, 10);
        if (hInt === 12) hInt = 0;
        if (ap === 'PM') hInt += 12;
        const timeStr = `${hInt.toString().padStart(2, '0')}:${m}`;
        onChange(timeStr);
    };

    const handleHourChange = (val) => {
        const newMin = minute || '00';
        const newAp = ampm || defaultMeridiem;
        setHour(val);
        setMinute(newMin);
        setAmpm(newAp);
        updateTime(val, newMin, newAp);
    };

    const handleMinuteChange = (val) => {
        const newHour = hour || '12';
        const newAp = ampm || defaultMeridiem;
        setMinute(val);
        setHour(newHour);
        setAmpm(newAp);
        updateTime(newHour, val, newAp);
    };

    const handleAmpmChange = (val) => {
        const newHour = hour || '12';
        const newMin = minute || '00';
        setAmpm(val);
        setHour(newHour);
        setMinute(newMin);
        updateTime(newHour, newMin, val);
    };

    return (
        <div className={`flex items-center justify-center p-1.5 rounded-[1rem] bg-white/50 backdrop-blur-xl border border-white/80 shadow-[0_4px_12px_rgba(0,82,204,0.06),inset_0_2px_6px_rgba(255,255,255,0.9)] transition-all ${disabled ? 'opacity-50 pointer-events-none grayscale-[0.5]' : 'hover:shadow-[0_6px_16px_rgba(0,82,204,0.12)] hover:bg-white/70'} ${className}`}>

            <div className="w-11">
                <LiquidSelect
                    nano
                    bare
                    clearable={false}
                    disabled={disabled}
                    value={hour}
                    onChange={handleHourChange}
                    options={HOUR_OPTIONS}
                    placeholder="--"
                />
            </div>

            <span className="text-slate-500 font-black px-0.5 animate-pulse">:</span>

            <div className="w-11">
                <LiquidSelect
                    nano
                    bare
                    clearable={false}
                    disabled={disabled}
                    value={minute}
                    onChange={handleMinuteChange}
                    options={MINUTE_OPTIONS}
                    placeholder="--"
                />
            </div>

            <div className="w-[2px] h-5 bg-black/[0.04] mx-1 rounded-full"></div>

            <div className="w-[3.25rem]">
                <LiquidSelect
                    nano
                    bare
                    clearable={false}
                    disabled={disabled}
                    value={ampm}
                    onChange={handleAmpmChange}
                    options={AMPM_OPTIONS}
                    placeholder="--"
                />
            </div>
        </div>
    );
};

export default TimePicker12;