const fs = require('fs').promises;
const path = require('path');

class ConfigUtils {
  /**
   * @typedef {object} ConfigData
   * @property {string} service_name - The name of the service.
   * @property {object} network - Network configuration.
   * @property {'internal'|'external'} network.type - The type of network.
   * @property {string} [internalIPv4] - The IP address (for internal network).
   * @property {string} [internalDstPort] - The destination port (for internal network).
   * @property {string} [internalSrcPort] - The source port (for internal network).
   * @property {string} [internalNetSegment] - The network segment (for internal network).
   * @property {object} [env] - Environment variables (for external network).
   * @property {string} [env.hostIp] - The host IP address (for external network).
   * @property {string} [externalIPv4] - The IPv4 address (for external network).
   * @property {string} [externalIPv6] - The IPv6 address (for external network).
   */

  /**
   * Generates a docker-compose.yml configuration file based on the provided data object.
   * @param {ConfigData} configData - An object containing configuration values.
   * @param {string} directoryPath - The path to the directory where the file will be saved.
   */
  static async generateConfig(configData, directoryPath = '.') {
    // Destructure the incoming configuration data
    const {
      service_name,
      network,
      internalIPv4: IP,
      internalDstPort: destPort,
      internalSrcPort: srcPort,
      internalNetSegment: net,
      env,
      externalIPv4: ipv4,
      externalIPv6: ipv6
    } = configData;

    // Define the different parts of the template
    const baseTemplate = `version: '3.3'

services:
  ${service_name}:
    image: c0dingbear/nodejs-runner-for-ricecall:latest
    container_name: ${service_name}
    tty: true
    stdin_open: true

    env_file:
      - .env
    
    volumes:
      - ./service:/home/ubuntu
      - ./logs:/var/log
      - ./.env.project:/usr/share/.env
`;

    const internalNetworkTemplate = `
    ports:
      - "${IP}:${destPort}:${srcPort}"

    extra_hosts:
      - "host.docker.internal:${net}.0.1"

    networks:
      ${service_name}_net:
        ipv4_address: ${net}.0.114
        
networks:
  ${service_name}_net:
    driver: bridge
    ipam:
      driver: default
      config:
        - subnet: ${net}.0.0/16
`;

    const externalNetworkTemplate = `
    extra_hosts:
      - "host.docker.internal:${env.hostIp}"
    
    networks:
      ipvlan_net:
        ipv4_address: ${ipv4}
        ipv6_address: ${ipv6}

networks:
  ipvlan_net:
    external: true
`;

    // Select the corresponding network configuration based on network.type
    let networkConfig = '';
    if (network && network.type === 'internal') {
      networkConfig = internalNetworkTemplate;
    } else if (network && network.type === 'external') {
      networkConfig = externalNetworkTemplate;
    }

    // Combine the final configuration content
    const finalConfig = `${baseTemplate}${networkConfig}`;

    // Write the generated configuration to a file
    try {
      const filePath = path.join(directoryPath, 'docker-compose.yml');
      await fs.writeFile(filePath, finalConfig);
      console.log(`docker-compose.yml file has been successfully generated at ${filePath}!`);
    } catch (err) {
      console.error('An error occurred while writing the file:', err);
    }
  }
}

// --- Example Usage ---



// // Generate 'external' configuration file (if you want to run this example, please comment out the call in the example above)
// (async () => {
//   await ConfigUtils.generateConfig(externalConfigData);
// })();

module.exports = ConfigUtils;