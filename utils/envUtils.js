const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Utility class for handling environment configuration files without polluting the global scope.
 * @class
 */
class EnvUtils {
  /**
   * Asynchronously reads and parses a specific .env file into a JavaScript object.
   * This method does NOT inject the variables into `process.env`. It simply returns
   * them as a dictionary, allowing you to scope configuration to specific modules.
   *
   * @static
   * @param {string} filePath - The relative or absolute path to the .env file.
   * @returns {Promise<Object.<string, string>>} A promise that resolves to an object containing the parsed key-value pairs.
   * @throws {Error} Throws an error if the file does not exist or cannot be read.
   * @example
   * const config = await EnvUtils.loadFromPath('./config/special.env');
   * console.log(config.API_KEY); // Accessed from object
   * console.log(process.env.API_KEY); // Undefined (safe)
   */
  static async loadFromPath(filePath) {
    try {
      // Ensure we have a clean absolute path
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.resolve(process.cwd(), filePath);

      // Check if file exists (async equivalent of existsSync)
      try {
        await fs.promises.access(absolutePath);
      } catch (e) {
        throw new Error(`Env file not found at: ${absolutePath}`);
      }

      // Read the file content asynchronously
      const fileContent = await fs.promises.readFile(absolutePath);

      // Parse using dotenv's parsing engine
      const parsedConfig = dotenv.parse(fileContent);

      return parsedConfig;
    } catch (error) {
      // Re-throw with context or handle logging here
      throw new Error(`Failed to load env file: ${error.message}`);
    }
  }

  /**
   * Asynchronously reads and parses a file, returning a specific default value if the file is missing.
   * Useful for optional configuration files.
   * @static
   * @param {string} filePath - The path to the .env file.
   * @param {Object} [fallback={}] - The value to return if the file is missing (defaults to empty object).
   * @returns {Promise<Object.<string, string>>} A promise resolving to the parsed config or the fallback object.
   */
  static async loadOptional(filePath, fallback = {}) {
    try {
      return await this.loadFromPath(filePath);
    } catch (error) {
      // If the specific error is that the file is missing, return fallback
      if (error.message.includes('Env file not found')) {
        return fallback;
      }
      // If it's a read error (permission, etc), re-throw
      throw error;
    }
  }
}

module.exports = EnvUtils;