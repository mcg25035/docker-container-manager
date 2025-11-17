const fs = require('fs').promises;
const path = require('path');

let hostIp = process.env.HOST_IP;
if (!hostIp) throw new Error("Error: HOST_IP environment variable is not set.");

class ConfigUtils {
  /**
   * @typedef {object} ConfigData
   * @property {string} service_name - The name of the service.
   * @property {object} network - Network configuration.
   * @property {'internal'|'external'} network.type - The type of network.
   * @property {string} [mappingDstIPv4] - The IPv4 address for port mapping (for internal network).
   * @property {string} [mappingDstPort] - The destination port for port mapping (for internal network).
   * @property {string} [mappingSrcPort] - The source port for port mapping (for internal network).
   * @property {string} [internalNetSegment] - The network segment (for internal network).
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
      mappingDstIPv4: IP,
      mappingDstPort: destPort,
      mappingSrcPort: srcPort,
      internalNetSegment: net,
      externalIPv4: ipv4,
      externalIPv6: ipv6
    } = configData;

    // Define the different parts of the template
    const baseTemplate = `# this file is auto-generated. Do not edit directly.
# DCM:0.1
version: '3.3'

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
      - "host.docker.internal:${hostIp}"
    
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

  /**
   * Identifies the version of a configuration file based on its content.
   * @param {string} filePath - The path to the configuration file.
   * @returns {Promise<string|null>} - The version string if identified, otherwise null.
   */
  static async identifyConfigVersion(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const versionMatch = content.match(/# DCM:(\d+\.\d+)/);
            return versionMatch ? versionMatch[1] : null;
        } catch (error) {
            throw new Error(`Failed to read config file: ${error.message}`);
        }
    }
}

// --- Example Usage ---



// // Generate 'external' configuration file (if you want to run this example, please comment out the call in the example above)
// (async () => {
//   await ConfigUtils.generateConfig(externalConfigData);
// })();

module.exports = ConfigUtils;