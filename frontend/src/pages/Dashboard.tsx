import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { List, Card, Badge, Button, Spin, message } from 'antd';
import { getServices, getServiceStatus, powerAction } from '../api/client';

interface Service {
  name: string;
}

interface ServiceStatus {
  status: 'Up' | 'Down';
}

const ServiceStatusIndicator: React.FC<{ serviceName: string }> = ({ serviceName }) => {
  const { data, isLoading, isError } = useQuery<ServiceStatus, Error>({
    queryKey: ['serviceStatus', serviceName],
    queryFn: () => getServiceStatus(serviceName),
    refetchInterval: 5000,
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

  const { data: services, isLoading } = useQuery<Service[], Error>({
    queryKey: ['services'],
    queryFn: getServices,
  });

  const { mutate, isPending, variables } = useMutation({
    mutationFn: (serviceName: string) => powerAction(serviceName, 'restart'),
    onSuccess: (_, serviceName) => {
      message.success(`Service ${serviceName} is restarting.`);
      queryClient.invalidateQueries({ queryKey: ['serviceStatus', serviceName] });
    },
    onError: (error, serviceName) => {
      message.error(`Failed to restart service ${serviceName}: ${error.message}`);
    },
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
        renderItem={(service) => (
          <List.Item>
            <Card
              title={<Link to={`/service/${service.name}`}>{service.name}</Link>}
              actions={[
                <Button
                  type="primary"
                  onClick={() => mutate(service.name)}
                  loading={isPending && variables === service.name}
                >
                  Quick Restart
                </Button>,
              ]}
            >
              <ServiceStatusIndicator serviceName={service.name} />
            </Card>
          </List.Item>
        )}
      />
    </div>
  );
};

export default Dashboard;