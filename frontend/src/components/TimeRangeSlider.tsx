import React, { useState } from 'react';
import { Slider, Tooltip, Modal, DatePicker, Button } from 'antd';
import dayjs from 'dayjs';

interface TimeRangeSliderProps {
    startTime: number;
    endTime: number;
    value: [number, number];
    onChange: (value: [number, number]) => void;
}

const TimeRangeSlider: React.FC<TimeRangeSliderProps> = ({ startTime, endTime, value, onChange }) => {
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingHandleIndex, setEditingHandleIndex] = useState<0 | 1 | null>(null);
    const [tempDate, setTempDate] = useState<dayjs.Dayjs | null>(null);

    const formatTime = (val: number) => dayjs(val).format('YYYY-MM-DD HH:mm:ss');

    const onHandleDoubleClick = (index: 0 | 1) => {
        setEditingHandleIndex(index);
        setTempDate(dayjs(value[index]));
        setEditModalOpen(true);
    };

    const handleModalOk = () => {
        if (tempDate && editingHandleIndex !== null) {
            const newValue = [...value] as [number, number];
            newValue[editingHandleIndex] = tempDate.valueOf();

            // Ensure constraint: start <= end
            if (editingHandleIndex === 0 && newValue[0] > newValue[1]) {
                newValue[1] = newValue[0];
            } else if (editingHandleIndex === 1 && newValue[1] < newValue[0]) {
                newValue[0] = newValue[1];
            }

            onChange(newValue);
        }
        setEditModalOpen(false);
        setEditingHandleIndex(null);
    };

    // Unused function removed


    // Antd Slider tooltip prop handles the hover logic nicely.
    // We just need to intercept default handle for double click.
    // The default handleRender implementation:

    const customHandleRender = (node: React.ReactElement, props: any) => {
        return (
            <Tooltip title={formatTime(props.value)} placement="top">
                {React.cloneElement(node as any, {
                    onDoubleClick: () => onHandleDoubleClick(props.index),
                    style: { ...(node.props as any).style, cursor: 'pointer' }
                })}
            </Tooltip>
        );
    };

    return (
        <div style={{ width: '100%', padding: '0 10px' }}>
            <Slider
                range
                min={startTime}
                max={endTime}
                value={value}
                onChange={(val) => onChange(val as [number, number])}
                tooltip={{ formatter: null }}
                // @ts-ignore
                handleRender={customHandleRender}
                styles={{
                    track: { background: '#1677ff' },
                }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', marginTop: '4px' }}>
                <span>{formatTime(value[0])}</span>
                <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => onHandleDoubleClick(0)}>Edit</span>
                <span style={{ flex: 1 }}></span>
                <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => onHandleDoubleClick(1)}>Edit</span>
                <span>{formatTime(value[1])}</span>
            </div>

            <Modal
                title={`Edit ${editingHandleIndex === 0 ? 'Start' : 'End'} Time`}
                open={editModalOpen}
                onOk={handleModalOk}
                onCancel={() => setEditModalOpen(false)}
                width={300}
            >
                <DatePicker
                    showTime
                    value={tempDate}
                    onChange={setTempDate}
                    allowClear={false}
                    minDate={editingHandleIndex === 1 ? dayjs(value[0]) : dayjs(startTime)}
                    maxDate={editingHandleIndex === 0 ? dayjs(value[1]) : dayjs(endTime)}
                />
            </Modal>
        </div>
    );
};

export default TimeRangeSlider;
