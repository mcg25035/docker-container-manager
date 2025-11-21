import React, { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { List, Card, Badge, Spin, message } from 'antd';
import { getServices, getServiceStatus } from '../api/client';

interface ServiceStatus {
  status: 'Up' | 'Down';
}

const ServiceStatusIndicator: React.FC<{ serviceName: string }> = ({ serviceName }) => {
  const { data, isLoading, isError } = useQuery<ServiceStatus, Error>({
    queryKey: ['serviceStatus', serviceName],
    queryFn: () => getServiceStatus(serviceName),
  });

  if (isLoading) return <Badge status="processing" text="Loading..." />;
  if (isError) return <Badge status="error" text="Error" />;

  switch (data?.status) {
    case 'Up':
      return <Badge status="success" text="Up" />;
    case 'Down':
      return <Badge status="error" text="Down" />;
    default:
      return <Badge status="default" text="Unknown" />;
  }
};

const Dashboard: React.FC = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3000/ws/status`);

    ws.onopen = () => {
      console.log('Connected to status WebSocket.');
    };

    ws.onmessage = (event) => {
      const { serviceName, status } = JSON.parse(event.data);
      queryClient.setQueryData(['serviceStatus', serviceName], { status });
    };

    ws.onclose = () => {
      console.log('Disconnected from status WebSocket.');
    };

    ws.onerror = (error) => {
      console.error('Status WebSocket error:', error);
      message.error('WebSocket connection for status updates failed.');
    };

    return () => {
      ws.close();
    };
  }, [queryClient]);

  const { data: services, isLoading } = useQuery<string[], Error>({
    queryKey: ['services'],
    queryFn: getServices,
  });

  if (isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin size="large" /></div>;
  }

  return (
    <div style={{ padding: '24px' }}>
      <h1>Service Dashboard</h1>
      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 4, xxl: 4 }}
        dataSource={services}
        renderItem={(serviceName) => (
          <List.Item>
            <Card
              title={<Link to={`/service/${serviceName}`}>{serviceName}</Link>}
              actions={[
                <Link to={`/service/${serviceName}`}>View</Link>
              ]}
            >
              <ServiceStatusIndicator serviceName={serviceName} />
            </Card>
          </List.Item>
        )}
      />
    </div>
  );
};

export default Dashboard;