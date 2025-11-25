import axios from 'axios';

const apiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api`,
});

export const getServices = () => apiClient.get('/services').then(res => res.data);

export const getServiceStatus = (name: string) => apiClient.get(`/services/${name}/status`).then(res => res.data);

export const getServiceConfig = (name: string) => apiClient.get(`/services/${name}/config`).then(res => res.data);
export const getServiceConfigData = (name: string) => apiClient.get(`/services/${name}/config-data`).then(res => res.data);
export const powerAction = (name: string, action: 'start' | 'stop' | 'restart' | 'down') => apiClient.post(`/services/${name}/power`, { action });
export const getLogFiles = (name: string) => apiClient.get(`/services/${name}/logs/files`).then(res => res.data);

export const readLogFile = (name: string, file: string, startLine: number) => 
  apiClient.get(`/services/${name}/logs/read`, { params: { file, start: startLine, num: 100 } }).then(res => res.data);

export interface SearchLogResult {
  lines: string[];
  total: number;
}

export const searchLogLinesByTimeRange = (
  name: string,
  file: string,
  from: string | null,
  to: string | null,
  limit: number,
  offset: number,
  search: string,
): Promise<SearchLogResult> =>
  apiClient.post(`/services/${name}/logs/search`, { file, from, to, limit, offset, search }).then(res => res.data);