const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');

/**
 * @param {string} serviceName 
 * @returns {Promise<boolean>}
 */
async function isServiceUp(serviceName) {

    if (!serviceName) {
        console.error('Error: serviceName parameter is required');
        return false;
    }

    if (!(await listServices()).includes(serviceName)) {
        console.error(`Error: Service "${serviceName}" not found in the list of services.`);
        return false;
    }

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
    fs.readdir(containerDir, (err, files) => {
        if (err) {
            console.error('Error reading container directory:', err);
            return;
        }
        const services = files.filter(file => fs.statSync(path.join(containerDir, file)).isDirectory());
        return services;
    });

}


module.exports = {
    isServiceUp,
};