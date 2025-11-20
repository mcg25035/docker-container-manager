import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Button, message, notification, Card, Spin, Badge, Tabs, Table, Select, DatePicker, Form, Switch } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServiceStatus, powerAction, getServiceConfig, getLogFiles, readLogFile, searchLogLinesByTimeRange } from '../api/client';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

interface ServiceStatus {
  status: 'Up' | 'Down';
}

interface ServiceConfig {
  env: string;
  dockerCompose: string;
}

const ServiceDetail: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();
  const [isPolling, setIsPolling] = useState(false);
  const [lastAction, setLastAction] = useState<'start' | 'stop' | 'restart' | 'down' | null>(null);
  const [selectedLogFile, setSelectedLogFile] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [nextLineToFetch, setNextLineToFetch] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<[Date | null, Date | null]>([null, null]);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [isLiveTailOn, setIsLiveTailOn] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);


  const { data: statusData, isLoading: isStatusLoading } = useQuery<ServiceStatus, Error>({
    queryKey: ['serviceStatus', name],
    queryFn: () => getServiceStatus(name!),
    enabled: !!name,
    refetchInterval: isPolling ? 2000 : false,
  });

  const { data: configData, isLoading: isConfigLoading, error: configError } = useQuery<ServiceConfig, Error>({
    queryKey: ['serviceConfig', name],
    queryFn: () => getServiceConfig(name!),
    enabled: !!name,
  });

  const { data: logFilesData, isLoading: isLogFilesLoading } = useQuery<string[], Error>({
    queryKey: ['logFiles', name],
    queryFn: () => getLogFiles(name!),
    enabled: !!name,
  });

  const { data: initialLogData, isLoading: isInitialLogLoading } = useQuery<{ lines: string[], nextLine: number }, Error>({
    queryKey: ['logContent', name, selectedLogFile, 'initial'],
    queryFn: () => readLogFile(name!, selectedLogFile!, -100),
    enabled: !!name && !!selectedLogFile,
  });

  useEffect(() => {
    if (initialLogData) {
      setLogLines(initialLogData.lines);
      setNextLineToFetch(initialLogData.nextLine);
    }
  }, [initialLogData]);

  const envData = configData?.env.split('\n').map((line, index) => {
    const [key, value] = line.split('=');
    return { key: `${index}`, name: key, value };
  });

  const columns = [
    { title: 'Key', dataIndex: 'name', key: 'name' },
    { title: 'Value', dataIndex: 'value', key: 'value' },
  ];

  useEffect(() => {
    if (statusData) {
      if ((lastAction === 'start' && statusData.status === 'Up') ||
          (lastAction === 'stop' && statusData.status === 'Down') ||
          (lastAction === 'down' && statusData.status === 'Down')) {
        setIsPolling(false);
        setLastAction(null);
      }
    }
  }, [statusData, lastAction]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (isPolling) {
      timeout = setTimeout(() => {
        setIsPolling(false);
        notification.warning({
          message: 'Status Check Timed Out',
          description: `The status of ${name} could not be confirmed in time.`,
        });
      }, 30000);
    }
    return () => clearTimeout(timeout);
  }, [isPolling, name]);

  const { mutate, isPending, variables } = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart' | 'down') => {
        setLastAction(action);
        return powerAction(name!, action)
    },
    onSuccess: (_, action) => {
      message.success(`Action '${action}' initiated for ${name}.`);
      if (action !== 'restart') {
        setIsPolling(true);
      }
      queryClient.invalidateQueries({ queryKey: ['serviceStatus', name] });
    },
    onError: (error, action) => {
      message.error(`Failed to perform '${action}' on ${name}: ${error.message}`);
    },
  });

  const handlePowerAction = (action: 'start' | 'stop' | 'restart' | 'down') => {
    mutate(action);
  };

  const searchMutation = useMutation<string[], Error, { from: string; to: string }>({
    mutationFn: ({ from, to }) => {
      if (!name || !selectedLogFile) {
        throw new Error('Service name or log file not selected');
      }
      return searchLogLinesByTimeRange(name, selectedLogFile, from, to);
    },
    onSuccess: () => {
      message.success('Log search completed.');
    },
    onError: (error) => {
      message.error(`Failed to search logs: ${error.message}`);
    },
  });

  const handleTimeTravelSearch = () => {
    if (timeRange[0] && timeRange[1]) {
      searchMutation.mutate({
        from: timeRange[0].toISOString(),
        to: timeRange[1].toISOString(),
      });
    } else {
      message.warning('Please select both start and end times.');
    }
  };

  const handleLoadMore = async () => {
    if (name && selectedLogFile && nextLineToFetch !== null) {
      try {
        const data = await readLogFile(name, selectedLogFile, nextLineToFetch);
        setLogLines(prev => [...data.lines, ...prev]);
        setNextLineToFetch(data.nextLine);
      } catch (error) {
        message.error('Failed to load more log lines.');
      }
    }
  };

  const handleLiveTailToggle = (checked: boolean) => {
    setIsLiveTailOn(checked);
    if (checked) {
      if (!selectedLogFile) {
        message.error('Please select a log file first.');
        setIsLiveTailOn(false);
        return;
      }
      const host = window.location.host;
      const wsUrl = `ws://${host}/ws/logs/${name}?file=${selectedLogFile}`;
      const newWs = new WebSocket(wsUrl);
      newWs.onopen = () => {
        message.success('Live tail started.');
      };
      newWs.onmessage = (event) => {
        setLiveLogs(prev => [...prev, event.data]);
      };
      newWs.onclose = () => {
        message.info('Live tail stopped.');
      };
      newWs.onerror = (error) => {
        message.error('WebSocket error.');
        console.error('WebSocket error:', error);
      };
      setWs(newWs);
    } else {
      if (ws) {
        ws.close();
      }
      setLiveLogs([]);
      setWs(null);
    }
  };

  useEffect(() => {
    const logContainer = logContainerRef.current;
    if (logContainer && !userScrolledUpRef.current) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }, [liveLogs]);

  const handleScroll = () => {
    const logContainer = logContainerRef.current;
    if (logContainer) {
      const isScrolledToBottom = Math.abs(logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight) < 1;
      userScrolledUpRef.current = !isScrolledToBottom;
    }
  };

  const statusText = isStatusLoading ? 'Loading...' : statusData?.status || 'Unknown';
  const statusType = statusData?.status === 'Up' ? 'success' : (statusData?.status === 'Down' ? 'error' : 'default');

  return (
    <div style={{ padding: '24px' }}>
      <h1>{name}</h1>
      <Card title="Current Status" style={{ marginBottom: 24 }}>
        {isStatusLoading ? <Spin /> : <Badge status={statusType} text={statusText} />}
      </Card>
      <Card title="Control Panel" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={() => handlePowerAction('start')} disabled={isPending} loading={isPending && variables === 'start'}>Start</Button>
          <Button onClick={() => handlePowerAction('stop')} disabled={isPending} loading={isPending && variables === 'stop'}>Stop</Button>
          <Button onClick={() => handlePowerAction('restart')} disabled={isPending} loading={isPending && variables === 'restart'}>Restart</Button>
          <Button onClick={() => handlePowerAction('down')} danger disabled={isPending} loading={isPending && variables === 'down'}>Down</Button>
        </div>
      </Card>
      <Card title="Configuration">
        {isConfigLoading ? (
          <Spin />
        ) : configError ? (
          <div>Error loading configuration: {configError.message}</div>
        ) : (
          <Tabs defaultActiveKey="1">
            <Tabs.TabPane tab=".env" key="1">
              <Table dataSource={envData} columns={columns} pagination={false} />
            </Tabs.TabPane>
            <Tabs.TabPane tab="docker-compose.yml" key="2">
              <SyntaxHighlighter language="yaml">
                {configData?.dockerCompose || ''}
              </SyntaxHighlighter>
            </Tabs.TabPane>
            <Tabs.TabPane tab="Time Travel" key="3">
              <Form layout="inline" style={{ marginBottom: 16 }}>
                <Form.Item label="Start Time">
                  <DatePicker showTime onChange={(date) => setTimeRange(prev => [date ? date.toDate() : null, prev[1]])} />
                </Form.Item>
                <Form.Item label="End Time">
                  <DatePicker showTime onChange={(date) => setTimeRange(prev => [prev[0], date ? date.toDate() : null])} />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" onClick={handleTimeTravelSearch} loading={searchMutation.isPending} disabled={!selectedLogFile}>
                    Search
                  </Button>
                </Form.Item>
              </Form>
              {searchMutation.isPending && <Spin />}
              {searchMutation.error && <div style={{ color: 'red' }}>Error: {searchMutation.error.message}</div>}
              {searchMutation.data && (
                <div style={{ background: '#f0f2f5', padding: '8px', marginTop: '16px', maxHeight: '400px', overflowY: 'auto' }}>
                  <pre>
                    <code>
                      {searchMutation.data.join('\n')}
                    </code>
                  </pre>
                </div>
              )}
            </Tabs.TabPane>
          </Tabs>
        )}
      </Card>
      <Card title="Log Explorer" style={{ marginTop: 24 }}>
        <Select
          style={{ width: 200, marginBottom: 16 }}
          placeholder="Select a log file"
          onChange={(value) => setSelectedLogFile(value)}
          loading={isLogFilesLoading}
          options={logFilesData?.map(file => ({ label: file, value: file }))}
        />
        <Tabs defaultActiveKey="1">
          <Tabs.TabPane tab="History" key="1">
            <Button onClick={handleLoadMore} disabled={nextLineToFetch === null}>Load More Previous</Button>
            <div style={{ background: '#f0f2f5', padding: '8px', marginTop: '16px', maxHeight: '400px', overflowY: 'auto' }}>
              {isInitialLogLoading ? <Spin /> : (
                <pre>
                  <code>
                    {logLines.join('\n')}
                  </code>
                </pre>
              )}
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane tab="Live Tail" key="2">
            <Switch
              checkedChildren="Stop Monitoring"
              unCheckedChildren="Start Monitoring"
              checked={isLiveTailOn}
              onChange={handleLiveTailToggle}
              disabled={!selectedLogFile}
            />
            <div ref={logContainerRef} onScroll={handleScroll} style={{ background: '#000', color: '#fff', padding: '8px', marginTop: '16px', maxHeight: '400px', overflowY: 'auto', fontFamily: 'monospace' }}>
              <pre>
                <code>
                  {liveLogs.join('\n')}
                </code>
              </pre>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </Card>
    </div>
  );
};

export default ServiceDetail;