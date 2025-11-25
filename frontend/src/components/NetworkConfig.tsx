import React from 'react';
import { LaptopOutlined, ContainerOutlined, ArrowRightOutlined, CodeSandboxOutlined, GlobalOutlined, DockerOutlined } from '@ant-design/icons';

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
        <DockerOutlined style={{ fontSize: '48px' }} />
        <p>{network.internalNetSegment}.0.114:{network.mappingSrcPort}<br /> container </p>
      </div>
    </div>
  );

  const renderExternal = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', textAlign: 'center' }}>
      <div>
        <GlobalOutlined style={{ fontSize: '48px' }} />
        <p>{network.externalIPv4}<br />{network.externalIPv6}</p>
      </div>
      <ArrowRightOutlined style={{ fontSize: '24px', margin: '0 20px' }} />
      <div>
        <DockerOutlined style={{ fontSize: '48px' }} />
        <p> container </p>
      </div>
    </div>
  );

  return network.type === 'internal' ? renderInternal() : renderExternal();
};

export default NetworkConfig;