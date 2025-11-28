import React, { useState } from 'react';
import { Table, Button, Input, message, Select } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { writeServiceEnvConfig } from '../api/client';
import type { TableProps } from 'antd';

export const key = 'c0dingbear/nodejs-runner-for-ricecall:';

interface RicecallRunnerProps {
    dataSource: { key: string; name: string; value: string }[];
    columns: { title: string; dataIndex: string; key: string }[];
}

export const component: React.FC<RicecallRunnerProps> = ({ dataSource, columns }) => {
    const { name } = useParams<{ name: string }>();
    const queryClient = useQueryClient();
    const [editMode, setEditMode] = useState(false);
    const [formState, setFormState] = useState<Record<string, string>>({});

    const mutation = useMutation({
        mutationFn: (newData: object) => writeServiceEnvConfig(name!, newData),
        onSuccess: () => {
            message.success('Configuration updated successfully');
            queryClient.invalidateQueries({ queryKey: ['serviceConfig', name] });
            setEditMode(false);
        },
        onError: (error) => {
            message.error(`Failed to update configuration: ${error.message}`);
        },
    });

    const handleEdit = () => {
        const initialState = dataSource.reduce((acc, item) => {
            if (item.name === 'NODE_INIT_COMMAND' || item.name === 'STARTUP_COMMAND') {
                acc[item.name] = item.value.split('&&').map(cmd => cmd.trim()).join('\n');
            } else {
                acc[item.name] = item.value;
            }
            return acc;
        }, {} as Record<string, string>);
        setFormState(initialState);
        setEditMode(true);
    };

    const handleCancel = () => {
        setFormState({});
        setEditMode(false);
    };

    const handleSave = async () => {
        try {
            const payload = { ...formState };
            if (payload.NODE_INIT_COMMAND) {
                payload.NODE_INIT_COMMAND = payload.NODE_INIT_COMMAND.split('\n').map(cmd => cmd.trim()).filter(Boolean).join(' && ');
            }
            if (payload.STARTUP_COMMAND) {
                payload.STARTUP_COMMAND = payload.STARTUP_COMMAND.split('\n').map(cmd => cmd.trim()).filter(Boolean).join(' && ');
            }
            await mutation.mutateAsync(payload);
        } catch (errInfo) {
            console.log('Validate Failed:', errInfo);
        }
    };

    const handleFormChange = (key: string, value: string) => {
        setFormState(prev => ({ ...prev, [key]: value }));
    };

    const editableColumns = columns.map(col => {
        if (col.dataIndex === 'value') {
            return {
                ...col,
                render: (_: any, record: { name: string; value: string }) => {
                    const fieldName = record.name;
                    const value = formState[fieldName];

                    if (fieldName === 'MODE') {
                        return (
                            <div>
                                <Select
                                    value={value}
                                    onChange={(newValue) => handleFormChange(fieldName, newValue)}
                                    style={{ width: '100%' }}
                                >
                                    <Select.Option value="init">init</Select.Option>
                                    <Select.Option value="production">production</Select.Option>
                                </Select>
                                <small style={{ color: '#888' }}>
                                    Container execution mode. `init` for project initialization, `production` for project execution.
                                </small>
                            </div>
                        );
                    }

                    if (fieldName === 'NODE_INIT_COMMAND' || fieldName === 'STARTUP_COMMAND') {
                        return (
                            <div>
                                <Input.TextArea
                                    value={value}
                                    onChange={(e) => handleFormChange(fieldName, e.target.value)}
                                    rows={4}
                                    placeholder="Enter commands, one per line"
                                />
                            </div>
                        );
                    }

                    return (
                        <Input
                            value={value}
                            onChange={(e) => handleFormChange(fieldName, e.target.value)}
                        />
                    );
                },
            };
        }
        return col;
    });

    const tableData = dataSource.map(item => ({
        ...item,
        key: item.name,
    }));

    return (
        <div>
            <div style={{ marginBottom: 16, textAlign: 'right' }}>
                {editMode ? (
                    <>
                        <Button onClick={handleSave} type="primary" style={{ marginRight: 8 }} loading={mutation.isPending}>
                            Save
                        </Button>
                        <Button onClick={handleCancel}>Cancel</Button>
                    </>
                ) : (
                    <Button onClick={handleEdit}>Edit</Button>
                )}
            </div>
            <Table
                bordered
                dataSource={tableData}
                columns={editMode ? editableColumns : columns}
                pagination={false}
            />
        </div>
    );
};