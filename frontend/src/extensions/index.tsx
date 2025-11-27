import React from 'react';

interface ExtensionModule {
  key: string;
  component: React.FC<any>;
}

const modules = import.meta.glob<ExtensionModule>('./*.tsx', { eager: true });

const extensions: Record<string, { component: React.FC<any> }> = {};

for (const path in modules) {
  if (path === './index.tsx') continue;
  const module = modules[path];
  if (module.key && module.component) {
    extensions[module.key] = { component: module.component };
  }
}

export default extensions;