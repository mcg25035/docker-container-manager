import React, { useState } from 'react';
import { Table, Button, Input, message } from 'antd';
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
            acc[item.name] = item.value;
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
            await mutation.mutateAsync(formState);
        } catch (errInfo) {
            console.log('Validate Failed:', errInfo);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
        setFormState({ ...formState, [key]: e.target.value });
    };

    const editableColumns = columns.map(col => {
        if (col.dataIndex === 'value') {
            return {
                ...col,
                render: (_: any, record: { name: string }) => (
                    <Input
                        value={formState[record.name]}
                        onChange={(e) => handleInputChange(e, record.name)}
                    />
                ),
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
                        <Button onClick={handleSave} type="primary" style={{ marginRight: 8 }}>
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