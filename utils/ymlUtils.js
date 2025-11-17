const fs = require('fs').promises;
const yaml = require('js-yaml');

class YmlUtils {
    /**
     * Asynchronously load a yml file from a given path
     * @param {string} filePath
     * @returns {Promise<object>}
     */
    static async loadFromPath(filePath) {
        const yml = await fs.readFile(filePath, 'utf8');
        return yaml.load(yml);
    }

    /**
     * Asynchronously load a yml file from a given path, but return null if it does not exist
     * @param {string} filePath
     * @returns {Promise<object|null>}
     */
    static async loadOptional(filePath) {
        try {
            return await this.loadFromPath(filePath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }
}

module.exports = YmlUtils;
