const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');
const EnvUtils = require('./utils/envUtils');

const containerDir = process.env.container_dir;

if (!containerDir) {
    console.error('Error: Environment variable container_dir is not set (please check the .env file)');
}


/**
 * @param {string} serviceName 
 * @returns {Promise<boolean>}
 */
async function checkServiceExists(serviceName) {
    if (!(await listServices()).includes(serviceName)) {
        console.error(`Error: Service "${serviceName}" not found in the list of services.`);
        return false;
    }
    return true;
}

/**
 * @param {string} serviceName 
 * @returns {Promise<boolean>}
 */
async function isServiceUp(serviceName) {

    if (!serviceName) {
        console.error('Error: serviceName parameter is required');
        return false;
    }

    if (!(await checkServiceExists(serviceName))) return false;

    const containerDir = process.env.container_dir;

    if (!containerDir) {
        console.error('Error: Environment variable container_dir is not set (please check the .env file)');
        return false;
    }

    const command = 'cd "$TARGET_DIR" && docker-compose ps';
    const targetDir = path.join(containerDir, serviceName);

    try {
        const { stdout, stderr } = await execAsync(command, {
            env: {
                ...process.env,
                TARGET_DIR: targetDir,
            },
            shell: '/bin/bash',
            encoding: 'utf-8',
            // exec has a default stdout/stderr buffer; adjust maxBuffer if needed
        });

        if (stderr) {
            // Some commands write non-fatal info to stderr; log at debug level if needed
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
 * @returns {Promise<Array<string>>}
 */
async function listServices() {
    let files = await fs.promises.readdir(containerDir);
    const services = files.filter(file => fs.statSync(path.join(containerDir, file)).isDirectory());
    return services;

}


/**
 * @param {string} serviceName
 * @returns {Promise<Object>}
 * 
 */
async function getServiceConfig(serviceName) {
    
    if (!(await checkServiceExists(serviceName))) return {};

    let result = {};

    let envPath = path.join(containerDir, serviceName, '.env'); 
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
async function readServiceMetadata(serviceName) {
    console.error('readServiceMetadata not implemented yet');
    return {};
}

module.exports = {
    isServiceUp,
    listServices,
    readServiceMetadata,
    getServiceConfig,
};