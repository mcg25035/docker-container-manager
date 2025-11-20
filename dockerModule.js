const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');
const tail = require('tail').Tail;
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
        try{
            if (!(await this.listServices()).includes(serviceName)) {
            console.error(`Error: Service "${serviceName}" not found in the list of services.`);
            return false;
        }
        } catch (error) {
            console.error(`Error checking service existence for "${serviceName}": ${error.message}`);
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
            if (error.stderr) console.error(`Stderr: ${error.stderr.toString()}`);
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
            if (error.stderr) console.error(`Stderr: ${error.stderr.toString()}`);
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
     * @param {string} serviceName 
     * @returns {Promise<Array<string>>}
     */
    async getServiceLogs(serviceName) {
        if (!(await this.#checkServiceExists(serviceName))) return [];

        let targetDir = path.join(this.#containerDir, serviceName, 'logs');
        if (!fs.existsSync(targetDir)) return [];

        let logFiles = await fs.promises.readdir(targetDir);
        logFiles = logFiles.filter(file => fs.statSync(path.join(targetDir, file)).isFile());
        return logFiles;
    }

    /**
     * @typedef {()=>void} StopMonitorFunction
     * 
     * @param {string} serviceName 
     * @param {string} logFileName 
     * @param {(line: string) => void} onLineCallback 
     * @return {Promise<StopMonitorFunction>}
     */
    async monitorServiceLogs(serviceName, logFileName, onLineCallback) {
        if (!(await this.#checkServiceExists(serviceName))) return () => {};

        let logFilePath = path.join(this.#containerDir, serviceName, 'logs', logFileName);
        if (!fs.existsSync(logFilePath)) {
            console.error(`Error: Log file "${logFileName}" not found for service "${serviceName}"`);
            return () => {};
        }

        const tailOptions = {
            fromBeginning: false,
            follow: true,
            useWatchFile: true,
        };
        
        const tailInstance = new tail(logFilePath, tailOptions);
        tailInstance.on("line", function(line) {
            onLineCallback(line);
        });
        
        tailInstance.on("error", function(error) {
            console.error(`Error while tailing log file "${logFileName}" for service "${serviceName}": ${error.message}`);
        });

        console.log(`Started monitoring log file "${logFileName}" for service "${serviceName}"`);

        return () => {
            tailInstance.unwatch();
            console.log(`Stopped monitoring log file "${logFileName}" for service "${serviceName}"`);
        }

    }

    /**
     * @param {string} serviceName 
     * @param {string} logFileName
     * @param {number} startLine
     * @param {number} numLines
     * @return {Promise<string[]>}
     */
    async getLogLines(serviceName, logFileName, startLine, numLines) {
        if (!(await this.#checkServiceExists(serviceName))) return [];
        
        let logFilePath = path.join(this.#containerDir, serviceName, 'logs', logFileName);
        if (!fs.existsSync(logFilePath)) {
            console.error(`Error: Log file "${logFileName}" not found for service "${serviceName}"`);
            return [];
        }

        
        
        try {
            const fileContent = await fs.promises.readFile(logFilePath, 'utf-8');
            const lines = fileContent.split('\n');

            if (startLine < 0) {
                startLine = Math.max(0, lines.length + startLine);
                startLine = Math.min(startLine, lines.length);
            }

            if (numLines <= 0) {
                console.error(`Error: numLines must be greater than 0`);
                return [];
            }

            const endLine = Math.min(startLine + numLines, lines.length);
            let result = lines.slice(startLine, endLine);
            return result;
        } catch (error) {
            console.error(`Error reading log file "${logFileName}" for service "${serviceName}": ${error.message}`);
            return [];
        }
    }

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