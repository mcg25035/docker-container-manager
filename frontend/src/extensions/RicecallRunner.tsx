import React from 'react';
import { Table } from 'antd';
import type { TableProps } from 'antd';

export const key = 'c0dingbear/nodejs-runner-for-ricecall:';

interface RicecallRunnerProps {
  dataSource: TableProps['dataSource'];
  columns: TableProps['columns'];
}

export const component: React.FC<RicecallRunnerProps> = ({ dataSource, columns }) => {
  return <Table dataSource={dataSource} columns={columns} pagination={false} />;
};