const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');
const EnvUtils = require('./utils/envUtils');
const YmlUtils = require('./utils/ymlUtils');
const ConfigUtils = require('./utils/configUtils');

let PowerAction = Object.freeze({
    START: "START",
    STOP: "STOP",
    RESTART: "RESTART",
});

let processingPowerAction = new Set();

class DockerModule {
    #containerDir;

    PowerAction = PowerAction;

    constructor() {
        this.#containerDir = process.env.CONTAINER_DIR;
        if (!this.#containerDir) {
            throw new Error('Error: Environment variable CONTAINER_DIR is not set (please check the .env file)');
        }
    }

    /**
     * @param {string} serviceName 
     * @returns {Promise<boolean>}
     */
    async #checkServiceExists(serviceName) {
        if (!(await this.listServices()).includes(serviceName)) {
            console.error(`Error: Service "${serviceName}" not found in the list of services.`);
            return false;
        }
        return true;
    }

    /**
     * @param {string} serviceName 
     * @returns {Promise<boolean>}
     */
    async isServiceUp(serviceName) {

        if (!serviceName) {
            console.error('Error: serviceName parameter is required');
            return false;
        }

        if (!(await this.#checkServiceExists(serviceName))) return false;

        const command = 'cd "$TARGET_DIR" && docker-compose ps';
        const targetDir = path.join(this.#containerDir, serviceName);

        try {
            const { stdout, stderr } = await execAsync(command, {
                env: {
                    ...process.env,
                    TARGET_DIR: targetDir,
                },
                shell: '/bin/bash',
                encoding: 'utf-8',
            });

            if (stderr) {
                console.error(`Stderr: ${stderr.toString()}`);
            }

            return stdout.includes('Up');

        } catch (error) {
            console.error(`Error occurred while executing (Service: ${serviceName}): ${error.message}`);
            if (error.stderr) {
                console.error(`Stderr: ${error.stderr.toString()}`);
            }
            return false;
        }
    }

    /**
     * @typedef {Object} PowerActionResult
     * @property {boolean} success
     * @property {string} message
     * 
     * @param {string} actionType
     * @param {string} serviceName
     * @returns {Promise<PowerActionResult>}
     */
    async powerAction(actionType, serviceName) {
        if (!Object.values(PowerAction).includes(actionType)) {
            console.error(`Error: Invalid actionType "${actionType}". Valid types are: ${Object.values(PowerAction).join(', ')}`);
            return { success: false, message: 'Invalid action type' };
        }

        if (processingPowerAction.has(actionType)) {
            console.error(`Error: Another ${actionType} action is already in progress.`);
            return { success: false, message: `Another ${actionType} action is already in progress.` };
        }

        processingPowerAction.add(actionType);
        
        let result;
        try {
            let targetDir = path.join(this.#containerDir, serviceName);
            let command = `cd $TARGET_DIR && docker-compose ${actionType.toLowerCase()}`;
            
            const { stdout, stderr } = await execAsync(command, {
                env: {
                    ...process.env,
                    TARGET_DIR: targetDir,
                },
                shell: '/bin/bash',
                encoding: 'utf-8',
            });

            if (stderr) {
                console.error(`Stderr: ${stderr.toString()}`);
            }

            console.log(`Stdout: ${stdout.toString()}`);
            result = { success: true, message: `${actionType} action completed successfully.` };

        } catch (error) {
            console.error(`Error occurred while executing ${actionType} on service "${serviceName}": ${error.message}`);
            if (error.stderr) {
                console.error(`Stderr: ${error.stderr.toString()}`);
            }
            result = { success: false, message: `Error during ${actionType}: ${error.message}` };
        }

        processingPowerAction.delete(actionType);
        return result;
    }

    /**
     * @returns {Promise<Array<string>>}
     */
    async listServices() {
        let files = await fs.promises.readdir(this.#containerDir);
        const services = files.filter(file => fs.statSync(path.join(this.#containerDir, file)).isDirectory());
        return services;
    }

    /**
     * @param {string} serviceName
     * @returns {Promise<Object>}
     * 
     */
    async getServiceConfig(serviceName) {
        
        if (!(await this.#checkServiceExists(serviceName))) return {};

        let result = {};

        let envPath = path.join(this.#containerDir, serviceName, '.env'); 
        if (!fs.existsSync(envPath)) {
            console.error(`Error: .env file not found for service "${serviceName}"`);
        }
        else {
            try{
                result = {...result, ...(await EnvUtils.loadFromPath(envPath))};
            } catch (error) {
                console.error(`Error loading .env for service "${serviceName}": ${error.message}`);
            }
        }

        let dockerYmlPath = path.join(this.#containerDir, serviceName, 'docker-compose.yml');
        if (!fs.existsSync(dockerYmlPath)) {
            console.error(`Error: docker-compose.yml file not found for service "${serviceName}"`);
        }
        else {
            try {
                
                const version = await ConfigUtils.identifyConfigVersion(dockerYmlPath);

                
                const ymlConfig = await YmlUtils.loadFromPath(dockerYmlPath);
                ymlConfig['config_version'] = version;
                result = {...result, dockerCompose: ymlConfig};
            }
            catch (error) {
                console.error(`Error loading docker-compose.yml for service "${serviceName}": ${error.message}`);
            }
        }

        return result;
    }

    /**
     * @typedef {Object} ServiceMetadata
     * 
     */

    /**
     * implement in future
     * @param {string} serviceName 
     * @return {Promise<ServiceMetadata>}
     */
    async readServiceMetadata(serviceName) {
        console.error('readServiceMetadata not implemented yet');
        return {};
    }
}

module.exports = new DockerModule();