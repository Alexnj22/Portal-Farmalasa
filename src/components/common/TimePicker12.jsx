import React, { useState, useEffect } from 'react';

const TimePicker12 = ({ value, onChange, className, disabled }) => {
    const [hour, setHour] = useState('12');
    const [minute, setMinute] = useState('00');
    const [ampm, setAmpm] = useState('AM');

    useEffect(() => {
        if (value) {
            const [h, m] = value.split(':');
            let hInt = parseInt(h, 10);
            const isPm = hInt >= 12;
            setAmpm(isPm ? 'PM' : 'AM');
            hInt = hInt % 12;
            setHour(hInt === 0 ? '12' : hInt.toString().padStart(2, '0'));
            setMinute(m);
        } else {
            // Default
            setHour('12');
            setMinute('00');
            setAmpm('AM');
        }
    }, [value]);

    const updateTime = (h, m, ap) => {
        let hInt = parseInt(h, 10);
        if (hInt === 12) hInt = 0;
        if (ap === 'PM') hInt += 12;
        const timeStr = `${hInt.toString().padStart(2, '0')}:${m}`;
        onChange(timeStr);
    };

    return (
        <div className={`flex border rounded-md overflow-hidden bg-white items-center ${className} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <select
                disabled={disabled}
                className="p-2 outline-none text-sm bg-transparent appearance-none text-center"
                value={hour}
                onChange={(e) => {
                    setHour(e.target.value);
                    updateTime(e.target.value, minute, ampm);
                }}
            >
                {[...Array(12)].map((_, i) => (
                    <option key={i + 1} value={(i + 1).toString().padStart(2, '0')}>{i + 1}</option>
                ))}
            </select>
            <span className="text-slate-400 font-bold">:</span>
            <select
                disabled={disabled}
                className="p-2 outline-none text-sm bg-transparent appearance-none text-center"
                value={minute}
                onChange={(e) => {
                    setMinute(e.target.value);
                    updateTime(hour, e.target.value, ampm);
                }}
            >
                {['00', '15', '30', '45'].map(m => (
                    <option key={m} value={m}>{m}</option>
                ))}
            </select>
            <select
                disabled={disabled}
                className="p-2 outline-none text-sm bg-slate-50 font-medium text-slate-600 border-l"
                value={ampm}
                onChange={(e) => {
                    setAmpm(e.target.value);
                    updateTime(hour, minute, e.target.value);
                }}
            >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
            </select>
        </div>
    );
};

export default TimePicker12;