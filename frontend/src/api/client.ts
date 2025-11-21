import axios from 'axios';

const apiClient = axios.create({
  baseURL: `http://${window.location.hostname}:3000/api`,
});

export const getServices = () => apiClient.get('/services').then(res => res.data);

export const getServiceStatus = (name: string) => apiClient.get(`/services/${name}/status`).then(res => res.data);

export const getServiceConfig = (name: string) => apiClient.get(`/services/${name}/config`).then(res => res.data);
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
  from: string,
  to: string,
  limit: number,
  offset: number
): Promise<SearchLogResult> =>
  apiClient.post(`/services/${name}/logs/search`, { file, from, to, limit, offset }).then(res => res.data);