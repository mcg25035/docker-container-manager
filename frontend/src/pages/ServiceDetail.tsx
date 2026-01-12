import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CopyOutlined } from '@ant-design/icons';
import { Button, message, notification, Card, Spin, Badge, Tabs, Table, Select, DatePicker, Form, Switch, Input } from 'antd';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { getServiceStatus, powerAction, getServiceConfig, getServiceConfigData, getLogFiles, readLogFile, searchLogLinesByTimeRange, getLogFileTimeRange } from '../api/client';
import type { SearchLogResult } from '../api/client';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import yaml from 'js-yaml';
import NetworkConfig from '../components/NetworkConfig';
import TimeRangeSlider from '../components/TimeRangeSlider';
import extensions from '../extensions';

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
  const [searchTerm, setSearchTerm] = useState('');
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

  const { data: configDataFromUtils, isLoading: isConfigDataLoading, error: configDataError } = useQuery({
    queryKey: ['serviceConfigData', name],
    queryFn: () => getServiceConfigData(name!),
    enabled: !!name,
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
    if (initialLogData && initialLogData.length > 0) {
      setConsoleLogs(initialLogData);
      setNextLineToFetch(0);

      // Try to determine the time range of the initial chunk
      const timeRegex = /^(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (?:AM|PM))/;
      let start: Date | null = null;
      let end: Date | null = null;

      // Find first valid time
      for (const line of initialLogData) {
        const match = line.match(timeRegex);
        if (match) {
          const d = new Date(match[1]);
          if (!isNaN(d.getTime())) {
            start = d;
            break;
          }
        }
      }

      // Find last valid time (iterate backwards)
      for (let i = initialLogData.length - 1; i >= 0; i--) {
        const match = initialLogData[i].match(timeRegex);
        if (match) {
          const d = new Date(match[1]);
          if (!isNaN(d.getTime())) {
            end = d;
            break;
          }
        }
      }

      if (start && end) {
        setTimeRange([start, end]);
      }
    } else if (initialLogData) {
      // Empty logs
      setConsoleLogs([]);
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

  const generateTableData = (config: Record<string, any>): { key: string; name: string; value: string }[] => {
    const flattened: { name: string, value: string }[] = [];
    const flatten = (obj: any, path: string = '') => {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(key => {
        if (key === 'dockerCompose' || key === 'error' || key === 'message' || key === 'network') return;

        const newPath = path ? `${path}.${key}` : key;
        const value = obj[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          flatten(value, newPath);
        } else {
          flattened.push({
            name: newPath,
            value: String(value),
          });
        }
      });
    };
    flatten(config);
    return flattened.map((item, index) => ({
      ...item,
      key: `config-data-${index}`,
    }));
  };

  const getExtensionComponent = () => {
    if (!name || !configData) return null;

    // Prioritize specific extensions if they exist
    const image = (configData?.dockerCompose as any)?.services?.[name]?.image;
    if (image) {
      const extensionKey = Object.keys(extensions).find(prefix => image.startsWith(prefix) && prefix !== 'config-editor');
      if (extensionKey) {
        const ExtensionComponent = extensions[extensionKey].component;
        return <ExtensionComponent dataSource={otherConfigs} columns={columns} />;
      }
    }

    // Fallback to the generic config editor
    if (extensions['config-editor']) {
      const ExtensionComponent = extensions['config-editor'].component;
      return <ExtensionComponent dataSource={otherConfigs} columns={columns} />;
    }

    return null;
  }

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

  const searchMutation = useMutation<SearchLogResult, Error, { from: string | null; to: string | null; offset: number }>({
    mutationFn: ({ from, to, offset }) => {
      if (!name || !selectedLogFile) {
        throw new Error('Service name or log file not selected');
      }
      return searchLogLinesByTimeRange(name, selectedLogFile, from, to, 1000, offset, searchTerm);
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
    // Reset state for new search
    setConsoleLogs([]);
    setTimeTravelTotal(0);
    searchMutation.mutate({
      from: timeRange[0] ? timeRange[0].toISOString() : null,
      to: timeRange[1] ? timeRange[1].toISOString() : null,
      offset: 0,
    });
  };

  const handleCopyAll = () => {
    if (consoleLogs.length === 0) {
      message.info('No logs to copy');
      return;
    }
    navigator.clipboard.writeText(consoleLogs.join('\n'))
      .then(() => message.success('Logs copied'))
      .catch(() => message.error('Failed to copy logs'));
  };

  const handleTimeTravelLoadMore = () => {
    searchMutation.mutate({
      from: timeRange[0] ? timeRange[0].toISOString() : null,
      to: timeRange[1] ? timeRange[1].toISOString() : null,
      offset: consoleLogs.length,
    });
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
      const wsUrl = import.meta.env.VITE_API_URL.replace(/^http/, 'ws');
      const newWs = new WebSocket(`${wsUrl}/ws/logs/${name}?file=${selectedLogFile}&search=${encodeURIComponent(searchTerm)}`);
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
  const statusColors = {
    success: 'rgba(82, 196, 26, 0.6)',
    error: 'rgba(255, 77, 79, 0.6)',
    default: 'rgba(0, 0, 0, 0.25)',
  };
  const statusDotColors = {
    success: '#52c41a',
    error: '#ff4d4f',
    default: '#d9d9d9',
  };

  const logFiles = logFilesData || [];
  const logFileTimeRanges = useQueries({
    queries: logFiles.map(file => ({
      queryKey: ['logTimeRange', name, file],
      queryFn: () => getLogFileTimeRange(name!, file),
      enabled: !!name && !!file,
      staleTime: 1000 * 60 * 5, // Cache for 5 mins
    }))
  });

  const combinedLogData = logFiles.map((file, index) => {
    const query = logFileTimeRanges[index];
    return {
      file,
      data: query?.data,
      isLoading: query?.isLoading
    };
  });

  // Helper to parse log filename
  const parseLogName = (filename: string) => {
    // Regex matches "prefix-YYYY-MM-DD..." pattern
    // e.g., app-2026-01-09_20-48-51.log -> prefix: "app"
    // e.g., app-err-2026... -> prefix: "app-err"
    const match = filename.match(/^(.*?)-\d{4}-\d{2}-\d{2}.*\.log(?:\.\d+)?$/);
    if (match) {
      return { prefix: match[1], isTimestamped: true };
    }
    return { prefix: filename, isTimestamped: false };
  };

  // Group logs by prefix
  const groups: Record<string, typeof combinedLogData> = {};
  combinedLogData.forEach(item => {
    const { prefix } = parseLogName(item.file);
    if (!groups[prefix]) {
      groups[prefix] = [];
    }
    groups[prefix].push(item);
  });

  // Sort items within groups and sort groups themselves
  const groupData = Object.entries(groups).map(([prefix, items]) => {
    // Sort items by end time descending (Active/Future -> Newest -> Oldest)
    items.sort((a, b) => {
      const aData = a.data;
      const bData = b.data;

      // Rule 0: Files with NO time data go to bottom
      const aHasTime = (aData?.start != null || aData?.end != null);
      const bHasTime = (bData?.start != null || bData?.end != null);
      if (aHasTime && !bHasTime) return -1;
      if (!aHasTime && bHasTime) return 1;
      if (!aHasTime && !bHasTime) return 0;

      const now = Date.now();
      // If end is null/undefined but start exists, it's likely active -> treat as future
      const aEnd = (aData?.end) ? aData.end : (now + 10000000);
      const bEnd = (bData?.end) ? bData.end : (now + 10000000);

      if (aEnd !== bEnd) return bEnd - aEnd;

      const aStart = aData?.start || 0;
      const bStart = bData?.start || 0;
      return bStart - aStart;
    });

    // Determine "Max Time" of the group for group sorting
    // The first item is now the "freshest" thanks to the sort above
    const firstItem = items.length > 0 ? items[0] : null;
    const hasTime = firstItem && (firstItem.data?.start != null || firstItem.data?.end != null);

    let maxTime = 0;
    if (hasTime) {
      maxTime = (firstItem.data?.end) ? firstItem.data.end : (Date.now() + 10000000);
    }

    return { prefix, items, maxTime };
  });

  // Sort groups by their freshest content (descending)
  groupData.sort((a, b) => b.maxTime - a.maxTime);

  // Generate Options with OptGroup structure
  const logFileOptions = groupData.map(group => ({
    label: group.prefix,
    options: group.items.map(item => {
      const { file, data } = item;
      const { prefix, isTimestamped } = parseLogName(file);
      let label = file;

      if (data && (data.start || data.end)) {
        const start = data.start ? new Date(data.start).toLocaleString() : '...';
        const end = data.end ? new Date(data.end).toLocaleString() : '...';

        if (isTimestamped) {
          // User requested format: "app (Start - End)"
          label = `${prefix} (${start} - ${end})`;
        } else {
          label = `${file} (${start} - ${end})`;
        }
      }

      return { label, value: file };
    })
  }));

  const selectedLogFileIndex = logFiles.findIndex(f => f === selectedLogFile);
  const selectedLogTimeRange = selectedLogFileIndex >= 0 ? logFileTimeRanges[selectedLogFileIndex]?.data : null;

  // If we have a start time, we assume the log is supported for time-based operations.
  const isTimeSupported = selectedLogTimeRange?.start !== null && selectedLogTimeRange?.start !== undefined;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={{ margin: 0 }}>{name}</h1>
          {isStatusLoading ? <Spin /> : (
            <div style={{
              backgroundColor: statusColors[statusType],
              borderRadius: '12px',
              padding: '4px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: statusDotColors[statusType],
              }} />
              <span style={{ color: 'white', fontWeight: 'bold' }}>{statusText}</span>
            </div>
          )}
        </div>
        <Link to="/"><Button>Back to Dashboard</Button></Link>
      </div>
      <div style={{ flexShrink: 0, overflowY: 'auto' }}>
        <Card title="Control Panel" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={() => handlePowerAction('start')} disabled={isPending} loading={isPending && variables === 'start'}>Start</Button>
            <Button onClick={() => handlePowerAction('stop')} disabled={isPending} loading={isPending && variables === 'stop'}>Stop</Button>
            {/* <Button onClick={() => handlePowerAction('restart')} disabled={isPending} loading={isPending && variables === 'restart'}>Restart</Button> */}
            {/* <Button onClick={() => handlePowerAction('down')} danger disabled={isPending} loading={isPending && variables === 'down'}>Down</Button> */}
          </div>
        </Card>

        {configDataFromUtils && !configDataFromUtils.error && configDataFromUtils.network && (
          <Card title="Network Configuration" style={{ marginBottom: 24 }}>
            <NetworkConfig network={configDataFromUtils.network} />
          </Card>
        )}
        <Card title="Configuration" style={{ marginBottom: 24 }}>
          {isConfigDataLoading ? (
            <Spin />
          ) : configDataFromUtils && !configDataFromUtils.error && getExtensionComponent() ? (
            getExtensionComponent()
          ) : (
            <>
              {configDataError && (
                <div style={{ color: 'red', marginBottom: '16px' }}>
                  Error loading dynamic configuration: {configDataError.message}. Falling back to static config.
                </div>
              )}
              {isConfigLoading ? <Spin /> : (
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
            </>
          )}
        </Card>
        <Card
          title="Console"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '120vh' }}
          bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: '8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Select
                style={{ minWidth: 350 }}
                placeholder="Select a log file"
                onChange={(value) => {
                  setSelectedLogFile(value);
                  setConsoleLogs([]);
                  setTimeTravelTotal(0);
                  setTimeRange([null, null]);
                }}
                loading={isLogFilesLoading}
                options={logFileOptions}
                value={selectedLogFile}
              />
              {isTimeSupported && selectedLogTimeRange && (
                <div style={{ flex: 1, minWidth: 300, maxWidth: 600, marginLeft: 16, marginRight: 16 }}>
                  <TimeRangeSlider
                    startTime={selectedLogTimeRange.start!}
                    endTime={selectedLogTimeRange.end || Date.now()}
                    value={[
                      timeRange[0]?.getTime() ?? selectedLogTimeRange.start!,
                      timeRange[1]?.getTime() ?? (selectedLogTimeRange.end || Date.now())
                    ]}
                    onChange={(val) => setTimeRange([new Date(val[0]), new Date(val[1])])}
                  />
                </div>
              )}
              <Input
                placeholder="Search logs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: 200 }}
                onPressEnter={handleTimeTravelSearch}
              />
              <Button type="primary" onClick={handleTimeTravelSearch} loading={searchMutation.isPending} disabled={!selectedLogFile}>
                Search
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Button icon={<CopyOutlined />} onClick={handleCopyAll} disabled={consoleLogs.length === 0}>Copy All</Button>
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