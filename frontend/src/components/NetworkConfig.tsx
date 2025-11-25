import React from 'react';
import { Card } from 'antd';
import { LaptopOutlined, ContainerOutlined, ArrowRightOutlined } from '@ant-design/icons';

interface NetworkConfigProps {
  network: {
    type: 'internal' | 'external';
    mappingSrcPort?: number;
    mappingDstIPv4?: string;
    mappingDstPort?: number;
    internalNetSegment?: string;
    externalIPv4?: string;
    externalIPv6?: string;
  };
}

const NetworkConfig: React.FC<NetworkConfigProps> = ({ network }) => {
  const renderInternal = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', textAlign: 'center' }}>
      <div>
        <LaptopOutlined style={{ fontSize: '48px' }} />
        <p>{network.mappingDstIPv4}:{network.mappingDstPort}</p>
      </div>
      <ArrowRightOutlined style={{ fontSize: '24px', margin: '0 20px' }} />
      <div>
        <ContainerOutlined style={{ fontSize: '48px' }} />
        <p>:{network.mappingSrcPort}</p>
        <p>{network.internalNetSegment}</p>
      </div>
    </div>
  );

  const renderExternal = () => (
    <div style={{ textAlign: 'center' }}>
      <ContainerOutlined style={{ fontSize: '48px' }} />
      {network.externalIPv4 && <p>IPv4: {network.externalIPv4}</p>}
      {network.externalIPv6 && <p>IPv6: {network.externalIPv6}</p>}
    </div>
  );

  return (
    <Card title="Network Configuration">
      {network.type === 'internal' ? renderInternal() : renderExternal()}
    </Card>
  );
};

export default NetworkConfig;