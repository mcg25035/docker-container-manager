const fs = require("fs").promises;
const path = require("path");
const YmlUtils = require("./ymlUtils");

let hostIp = process.env.HOST_IP;
if (!hostIp) throw new Error("Error: HOST_IP environment variable is not set.");

class ConfigUtils {
    /**
     * @typedef {object} ConfigData
     * @property {string} service_name - The name of the service.
     * @property {object} network - Network configuration.
     * @property {'internal'|'external'} network.type - The type of network.
     * @property {string} [network.mappingDstIPv4] - The IPv4 address for port mapping (for internal network).
     * @property {string} [network.mappingDstPort] - The destination port for port mapping (for internal network).
     * @property {string} [network.mappingSrcPort] - The source port for port mapping (for internal network).
     * @property {string} [network.internalNetSegment] - The network segment (for internal network).
     * @property {string} [network.externalIPv4] - The IPv4 address (for external network).
     * @property {string} [network.externalIPv6] - The IPv6 address (for external network).
     */

    /**
     * Generates a docker-compose.yml configuration file based on the provided data object.
     * @param {ConfigData} configData - An object containing configuration values.
     * @param {string} directoryPath - The path to the directory where the file will be saved.
     */
    static async generateConfig(configData, directoryPath = ".") {
        // Destructure the incoming configuration data
        const { service_name, network } = configData;

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
      - "${network.mappingDstIPv4}:${network.mappingDstPort}:${network.mappingSrcPort}"

    extra_hosts:
      - "host.docker.internal:${network.internalNetSegment}.0.1"

    networks:
      ${service_name}_net:
        ipv4_address: ${network.internalNetSegment}.0.114
        
networks:
  ${service_name}_net:
    driver: bridge
    ipam:
      driver: default
      config:
        - subnet: ${network.internalNetSegment}.0.0/16
`;

        const externalNetworkTemplate = `
    extra_hosts:
      - "host.docker.internal:${hostIp}"
    
    networks:
      ipvlan_net:
        ipv4_address: ${network.externalIPv4}
        ipv6_address: ${network.externalIPv6}

networks:
  ipvlan_net:
    external: true
`;

        // Select the corresponding network configuration based on network.type
        let networkConfig = "";
        if (network && network.type === "internal") {
            networkConfig = internalNetworkTemplate;
        } else if (network && network.type === "external") {
            networkConfig = externalNetworkTemplate;
        }

        // Combine the final configuration content
        const finalConfig = `${baseTemplate}${networkConfig}`;

        // Write the generated configuration to a file
        try {
            const filePath = path.join(directoryPath, "docker-compose.yml");
            await fs.writeFile(filePath, finalConfig);
            console.log(
                `docker-compose.yml file has been successfully generated at ${filePath}!`
            );
        } catch (err) {
            console.error("An error occurred while writing the file:", err);
        }
    }

    /**
     * Identifies the version of a configuration file based on its content.
     * @param {string} filePath - The path to the configuration file.
     * @returns {Promise<string|null>} - The version string if identified, otherwise null.
     */
    static async identifyConfigVersion(filePath) {
        try {
            const content = await fs.readFile(filePath, "utf8");
            const versionMatch = content.match(/# DCM:(\d+\.\d+)/);
            return versionMatch ? versionMatch[1] : null;
        } catch (error) {
            throw new Error(`Failed to read config file: ${error.message}`);
        }
    }

    /**
     * Reads and parses configuration data from a specified directory.
     * @param {string} directoryPath
     * @returns {Promise<ConfigData>} - The parsed configuration data.
     */
    static async getConfigData(directoryPath) {
        try {
            const filePath = path.join(directoryPath, "docker-compose.yml");
            const content = await fs.readFile(filePath, "utf8");

            const configVersion = ConfigUtils.identifyConfigVersion(filePath);
            if (!configVersion) throw new Error("Unsupported or missing configuration version.");


            const parsedData = await YmlUtils.loadFromPath(filePath);
            const serviceName = Object.keys(parsedData.services)[0];

            const networkConfig = parsedData.services[serviceName].networks;

            /**@type {ConfigData} */
            let configData = {
                service_name: serviceName,
                network: {},
            }
            
            if (networkConfig.ipvlan_net) configData.network.type = "external";
            else if (networkConfig[`${serviceName}_net`]) configData.network.type = "internal";
            else throw new Error("Unknown network configuration.");

            if (configData.network.type === "internal") {
                const ports = parsedData.services[serviceName].ports[0];
                const extraHost = parsedData.services[serviceName].extra_hosts[0];
                const subnet = parsedData.networks[`${serviceName}_net`].ipam.config[0].subnet;

                const [mappingDstIPv4, mappingDstPort, mappingSrcPort] = ports.split(":");
                const internalNetSegment = subnet.split(".0.0/16")[0];

                configData.network.mappingDstIPv4 = mappingDstIPv4;
                configData.network.mappingDstPort = mappingDstPort;
                configData.network.mappingSrcPort = mappingSrcPort;
                configData.network.internalNetSegment = internalNetSegment;
            }

            if (configData.network.type === "external") {
                const extraHost = parsedData.services[serviceName].extra_hosts[0];
                const externalIPv4 = networkConfig.ipvlan_net.ipv4_address;
                const externalIPv6 = networkConfig.ipvlan_net.ipv6_address;
                
                configData.network.externalIPv4 = externalIPv4;
                configData.network.externalIPv6 = externalIPv6;
            }
            
            return configData;

        }
        catch (error) {
            throw new Error(`Failed to read config file: ${error.message}`);
        }
    }
}

// --- Example Usage ---

module.exports = ConfigUtils;
