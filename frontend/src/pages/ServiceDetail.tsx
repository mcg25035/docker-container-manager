import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Button, message, notification, Card, Spin, Badge, Tabs, Table, Select, DatePicker, Form, Switch } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServiceStatus, powerAction, getServiceConfig, getLogFiles, readLogFile, searchLogLinesByTimeRange } from '../api/client';
import type { SearchLogResult } from '../api/client';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import yaml from 'js-yaml';

interface ServiceStatus {
  status: 'Up' | 'Down';
}

interface ServiceConfig {
  dockerCompose: object;
  [key: string]: string | object;
}

const ServiceDetail: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();
  const [isPolling, setIsPolling] = useState(false);
  const [lastAction, setLastAction] = useState<'start' | 'stop' | 'restart' | 'down' | null>(null);
  const [selectedLogFile, setSelectedLogFile] = useState<string | null>(null);
  const [nextLineToFetch, setNextLineToFetch] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<[Date | null, Date | null]>([null, null]);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [isAutoUpdateOn, setIsAutoUpdateOn] = useState(false);
  const [isAutoScrollOn, setIsAutoScrollOn] = useState(true);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [timeTravelTotal, setTimeTravelTotal] = useState<number>(0);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const ignoreScrollEventRef = useRef(false);

  const { data: statusData, isLoading: isStatusLoading } = useQuery<ServiceStatus, Error>({
    queryKey: ['serviceStatus', name],
    queryFn: () => getServiceStatus(name!),
    enabled: !!name, // FIX: Prevent query from running if name is undefined
    refetchInterval: isPolling ? 2000 : false,
  });

  const { data: configData, isLoading: isConfigLoading, error: configError } = useQuery<ServiceConfig, Error>({
    queryKey: ['serviceConfig', name],
    queryFn: () => getServiceConfig(name!),
    enabled: !!name, // FIX: Prevent query from running if name is undefined
  });

  const { data: logFilesData, isLoading: isLogFilesLoading } = useQuery<string[], Error>({
    queryKey: ['logFiles', name],
    queryFn: () => getLogFiles(name!),
    enabled: !!name, // FIX: Prevent query from running if name is undefined
  });

  const { data: initialLogData, isLoading: isInitialLogLoading } = useQuery({
    queryKey: ['logContent', name, selectedLogFile, 'initial'],
    queryFn: (): Promise<string[]> => readLogFile(name!, selectedLogFile!, -100),
    enabled: !!name && !!selectedLogFile,
  });

  useEffect(() => {
    if (initialLogData) {
      setConsoleLogs(initialLogData ?? []);
      setNextLineToFetch(0);
    }
  }, [initialLogData]);

  const otherConfigs = configData
    ? Object.entries(configData)
      .filter(([key]) => key !== 'dockerCompose')
      .map(([key, value], index) => ({
        key: `config-${index}`,
        name: key,
        value: String(value),
      }))
    : [];

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

  const searchMutation = useMutation<SearchLogResult, Error, { from: string; to: string; offset: number }>({
    mutationFn: ({ from, to, offset }) => {
      if (!name || !selectedLogFile) {
        throw new Error('Service name or log file not selected');
      }
      return searchLogLinesByTimeRange(name, selectedLogFile, from, to, 1000, offset);
    },
    onSuccess: (data, variables) => {
      if (variables.offset === 0) {
        setConsoleLogs(data.lines);
      } else {
        setConsoleLogs(prev => [...prev, ...data.lines]);
      }
      setTimeTravelTotal(data.total);
      message.success(`Log search completed. Found ${data.total} lines.`);
    },
    onError: (error) => {
      message.error(`Failed to search logs: ${error.message}`);
    },
  });

  const handleTimeTravelSearch = () => {
    if (timeRange[0] && timeRange[1]) {
      // Reset state for new search
      setConsoleLogs([]);
      setTimeTravelTotal(0);
      searchMutation.mutate({
        from: timeRange[0].toISOString(),
        to: timeRange[1].toISOString(),
        offset: 0,
      });
    } else {
      message.warning('Please select both start and end times.');
    }
  };

  const handleTimeTravelLoadMore = () => {
    if (timeRange[0] && timeRange[1]) {
      searchMutation.mutate({
        from: timeRange[0].toISOString(),
        to: timeRange[1].toISOString(),
        offset: consoleLogs.length,
      });
    }
  };

  const handleLoadMore = async () => {
    if (name && selectedLogFile && nextLineToFetch !== null) {
      try {
        const data = await readLogFile(name, selectedLogFile, nextLineToFetch);
        setConsoleLogs(prev => [...(data ?? []), ...prev]);
        setNextLineToFetch(nextLineToFetch - 100);
      } catch (error) {
        message.error('Failed to load more log lines.');
      }
    }
  };

  const handleAutoUpdateToggle = (checked: boolean) => {
    setIsAutoUpdateOn(checked);
    if (checked) {
      if (!selectedLogFile) {
        message.error('Please select a log file first.');
        setIsAutoUpdateOn(false);
        return;
      }
      const newWs = new WebSocket(`ws://${window.location.hostname}:3000/ws/logs/${name}?file=${selectedLogFile}`);
      newWs.onopen = () => {
        message.success('Auto-update started.');
      };
      newWs.onmessage = (event) => {
        setConsoleLogs(prev => [...prev, event.data]);
      };
      newWs.onclose = () => {
        message.info('Auto-update stopped.');
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
      setWs(null);
    }
  };

  useEffect(() => {
    const logContainer = logContainerRef.current;
    if (logContainer && isAutoScrollOn) {
      ignoreScrollEventRef.current = true;
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }, [consoleLogs, isAutoScrollOn]);

  const handleScroll = () => {
    if (ignoreScrollEventRef.current) {
      ignoreScrollEventRef.current = false;
      return;
    }
    const logContainer = logContainerRef.current;
    if (logContainer) {
      const isScrolledToBottom = Math.abs(logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight) < 1;
      if (!isScrolledToBottom && isAutoScrollOn) {
        setIsAutoScrollOn(false);
      }
      if (isScrolledToBottom && !isAutoScrollOn) {
        setIsAutoScrollOn(true);
      }
    }
  };

  const statusText = isStatusLoading ? 'Loading...' : statusData?.status || 'Unknown';
  const statusType = statusData?.status === 'Up' ? 'success' : (statusData?.status === 'Down' ? 'error' : 'default');

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }}>
      <h1>{name}</h1>
      <div style={{ flexShrink: 0, overflowY: 'auto' }}>
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
        <Card title="Configuration" style={{ marginBottom: 24 }}>
          {isConfigLoading ? (
            <Spin />
          ) : configError ? (
            <div>Error loading configuration: {configError.message}</div>
          ) : (
            <Tabs
              defaultActiveKey="1"
              items={[
                {
                  key: '1',
                  label: 'Configurations',
                  children: <Table dataSource={otherConfigs} columns={columns} pagination={false} />,
                },
                {
                  key: '2',
                  label: 'docker-compose.yml',
                  children: (
                    <SyntaxHighlighter language="yaml">
                      {configData?.dockerCompose ? yaml.dump(configData.dockerCompose) : ''}
                    </SyntaxHighlighter>
                  ),
                },
              ]}
            />
          )}
        </Card>
        <Card
          title="Console"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '60vh' }}
          bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: '8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Select
                style={{ width: 200 }}
                placeholder="Select a log file"
                onChange={(value) => {
                  setSelectedLogFile(value);
                  setConsoleLogs([]);
                  setTimeTravelTotal(0);
                }}
                loading={isLogFilesLoading}
                options={logFilesData?.map(file => ({ label: file, value: file }))}
                value={selectedLogFile}
              />
              <DatePicker showTime onChange={(date) => setTimeRange(prev => [date ? date.toDate() : null, prev[1]])} placeholder="Start time" />
              <DatePicker showTime onChange={(date) => setTimeRange(prev => [prev[0], date ? date.toDate() : null])} placeholder="End time" />
              <Button type="primary" onClick={handleTimeTravelSearch} loading={searchMutation.isPending} disabled={!selectedLogFile}>
                Search
              </Button>
              <Button onClick={handleLoadMore} disabled={nextLineToFetch === null}>
                Load More Previous
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Form.Item label="Auto-update" style={{ marginBottom: 0 }}>
                <Switch
                  checked={isAutoUpdateOn}
                  onChange={handleAutoUpdateToggle}
                  disabled={!selectedLogFile}
                />
              </Form.Item>
              <Form.Item label="Auto-scroll" style={{ marginBottom: 0 }}>
                <Switch
                  checked={isAutoScrollOn}
                  onChange={setIsAutoScrollOn}
                />
              </Form.Item>
            </div>
          </div>

          <div ref={logContainerRef} onScroll={handleScroll} style={{ background: '#000', color: '#fff', padding: '8px', overflow: 'auto', flex: 1 }}>
            {isInitialLogLoading ? <Spin /> : (
              <pre style={{ margin: 0, fontFamily: 'monospace' }}>
                {consoleLogs.join('\n')}
              </pre>
            )}
            {searchMutation.isPending && <Spin />}
          </div>
          {consoleLogs.length > 0 && consoleLogs.length < timeTravelTotal && (
            <Button onClick={handleTimeTravelLoadMore} style={{ marginTop: 8, flexShrink: 0 }} loading={searchMutation.isPending}>
              Show More ({consoleLogs.length} / {timeTravelTotal})
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
};

export default ServiceDetail;