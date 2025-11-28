import React, { useState } from 'react';
import { Table, Button, Input, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { writeServiceEnvConfig } from '../api/client';

export const key = 'config-editor';

interface ConfigProps {
  dataSource: { key: string; name: string; value: string }[];
  columns: { title: string; dataIndex: string; key: string }[];
}

export const component: React.FC<ConfigProps> = ({ dataSource, columns }) => {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState('');
  const [formState, setFormState] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (newData: object) => writeServiceEnvConfig(name!, newData),
    onSuccess: () => {
      message.success('Configuration updated successfully');
      queryClient.invalidateQueries({ queryKey: ['serviceConfig', name] });
      setEditingKey('');
    },
    onError: (error) => {
      message.error(`Failed to update configuration: ${error.message}`);
    },
  });

  const isEditing = (record: { name: string }) => record.name === editingKey;

  const edit = (record: { name: string }) => {
    setFormState({ ...formState, [record.name]: dataSource.find(item => item.name === record.name)?.value || '' });
    setEditingKey(record.name);
  };

  const cancel = () => {
    setEditingKey('');
  };

  const save = async (key: string) => {
    try {
      const row = { [key]: formState[key] };
      await mutation.mutateAsync(row);
    } catch (errInfo) {
      console.log('Validate Failed:', errInfo);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    setFormState({ ...formState, [key]: e.target.value });
  };

  const mergedColumns = [...columns, {
    title: 'Operation',
    dataIndex: 'operation',
    render: (_: any, record: { name: string }) => {
      const editable = isEditing(record);
      return editable ? (
        <span>
          <Button onClick={() => save(record.name)} style={{ marginRight: 8 }}>
            Save
          </Button>
          <Button onClick={cancel}>Cancel</Button>
        </span>
      ) : (
        <Button disabled={editingKey !== ''} onClick={() => edit(record)}>
          Edit
        </Button>
      );
    },
  }];

  const components = {
    body: {
      cell: ({
        editing,
        dataIndex,
        title,
        inputType,
        record,
        index,
        children,
        ...restProps
      }: any) => {
        const isValueColumn = dataIndex === 'value';
        return (
          <td {...restProps}>
            {editing && isValueColumn ? (
              <Input
                value={formState[record.name]}
                onChange={(e) => handleInputChange(e, record.name)}
              />
            ) : (
              children
            )}
          </td>
        );
      },
    },
  };

  const tableData = dataSource.map(item => ({
    ...item,
    key: item.name,
  }));

  const mergedTableData = tableData.map(item => {
    return {
      ...item,
      editing: isEditing(item),
    };
  });

  return (
    <Table
      components={components}
      bordered
      dataSource={mergedTableData}
      columns={mergedColumns.map(col => {
        if (!col.dataIndex) {
          return col;
        }
        return {
          ...col,
          onCell: (record: { name: string }) => ({
            record,
            dataIndex: col.dataIndex,
            title: col.title,
            editing: isEditing(record),
          }),
        };
      })}
      rowClassName="editable-row"
      pagination={{
        onChange: cancel,
      }}
    />
  );
};