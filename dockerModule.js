const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');
const tail = require('tail').Tail;
const moment = require('moment-timezone');
const { parse, stringify } = require('envfile');
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
     * Performs binary search on file content to find the byte offset of a specific timestamp.
     * 
     * @param {fs.FileHandle} fileHandle
     * @param {number} fileSize
     * @param {number} targetTimeTs
     * @param {boolean} findStart - If true, find first log >= time. If false, acts as upper bound.
     * @param {number} minOffset - Optimization: don't search before this offset
     * @return {Promise<number>} Byte offset
     */
    async #findOffsetByTime(fileHandle, fileSize, targetTimeTs, findStart, minOffset = 0) {
        let low = minOffset;
        let high = fileSize;
        let resultOffset = fileSize;

        // Buffer size for reading timestamps (enough to cover a full line's date part)
        const CHUNK_SIZE = 256; 

        while (low < high) {
            // Calculate mid point
            let mid = Math.floor((low + high) / 2);

            // Adjust mid to find the start of a line
            // We read a chunk around mid
            const searchStart = Math.max(0, mid - CHUNK_SIZE);
            const buffer = Buffer.alloc(CHUNK_SIZE * 2); // Read enough context
            
            const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, searchStart);
            if (bytesRead === 0) break;

            const chunkString = buffer.toString('utf-8', 0, bytesRead);
            
            // Find the first newline after our 'mid' point relative to the chunk
            // If mid is 1000, searchStart might be 800. We want the first \n after offset 200 in buffer.
            const relativeMid = mid - searchStart;
            const newlineIndex = chunkString.indexOf('\n', relativeMid);

            let lineStartOffset;
            let logTimeTs = null;

            if (newlineIndex !== -1) {
                // The actual start of the next line in the file
                lineStartOffset = searchStart + newlineIndex + 1;
                
                // Extract date from this line
                // We need to read a bit more from this exact position to ensure we have the date string
                logTimeTs = await this.#extractTimeAtOffset(fileHandle, lineStartOffset);
            } else {
                // No newline found forward? We might be at the very end of file or a huge line.
                // For log files, this usually means end of file or check slightly earlier.
                // Strategy: assume end of file for this search context
                lineStartOffset = fileSize; 
            }

            // If we couldn't parse a time (e.g. stack trace line or EOF), 
            // we need a strategy. Assuming logs are mostly time-ordered:
            // If no time found, we scan forward linearly briefly until we find one.
            if (logTimeTs === null && lineStartOffset < fileSize) {
                const { nextTs, nextOffset } = await this.#scanForwardForTime(fileHandle, lineStartOffset, fileSize);
                if (nextTs !== null) {
                    logTimeTs = nextTs;
                    lineStartOffset = nextOffset; // Adjust our pivot to this valid line
                }
            }

            if (logTimeTs === null) {
                // Still no time found (EOF or bad chunk), treat as "End of Search Space"
                high = mid;
                continue;
            }

            // Binary Search Comparison
            if (logTimeTs >= targetTimeTs) {
                // Determine if we should move left
                resultOffset = lineStartOffset; // Potential candidate
                high = mid; 
            } else {
                // Too early, move right
                low = lineStartOffset; // Assuming strictly increasing, but +1 is safer to avoid stuck loops if lineStartOffset == mid
                if (low <= mid) low = mid + 1;
            }
        }

        return resultOffset;
    }

    /**
     * Reads a small chunk at specific offset and tries to parse the date.
     * Returns null if invalid format.
     * @param {fs.FileHandle} fileHandle 
     * @param {number} offset 
     * @return {Promise<number|null>} Timestamp or null
     */
    async #extractTimeAtOffset(fileHandle, offset) {
        const buffer = Buffer.alloc(100); // Date part is usually < 50 chars
        const { bytesRead } = await fileHandle.read(buffer, 0, 100, offset);
        if (bytesRead === 0) return null;

        const lineStr = buffer.toString('utf-8');
        
        // Regex matching: "11/21/2025, 4:57:52 AM"
        // Note: Added ^ to ensure match at start of line
        const timeRegex = /^(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (?:AM|PM))/;
        const match = lineStr.match(timeRegex);

        if (match) {
            const dateString = match[1];
            const tz = moment.tz.guess();
            const ts = moment.tz(dateString, "MM/DD/YYYY, hh:mm:ss A", tz).valueOf();
            return isNaN(ts) ? null : ts;
        }
        return null;
    }

    /**
     * Helper: If we landed on a line without a timestamp (e.g. stack trace),
     * scan forward line-by-line until we find a timestamp.
     */
    async #scanForwardForTime(fileHandle, startOffset, fileSize) {
        let currentOffset = startOffset;
        const buffer = Buffer.alloc(512); // Scan in 512 byte chunks

        while (currentOffset < fileSize) {
            const { bytesRead } = await fileHandle.read(buffer, 0, 512, currentOffset);
            if (bytesRead === 0) break;
            
            const chunk = buffer.toString('utf-8', 0, bytesRead);
            const lines = chunk.split('\n');
            
            let localOffset = 0;
            // Start from index 0 because currentOffset is already aligned to a line start (ideally)
            // checking all lines in this chunk
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // Calculate absolute offset of this line
                // Note: split removes \n, so we add +1 for calculation except for last part
                
                const timeRegex = /^(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (?:AM|PM))/;
                const match = line.match(timeRegex);
                
                if (match) {
                    const dateString = match[1];
                    const tz = moment.tz.guess();
                    const ts = moment.tz(dateString, "MM/DD/YYYY, hh:mm:ss A", tz).valueOf();
                    if (!isNaN(ts)) {
                        return { nextTs: ts, nextOffset: currentOffset + localOffset };
                    }
                }

                // Advance offset
                localOffset += Buffer.byteLength(line) + 1; // +1 for newline
            }
            
            // Move to next chunk, but be careful about split lines. 
            // Simplified: Just jump forward. For strict correctness, readline is better, 
            // but for "finding a nearby timestamp" this is acceptable.
            currentOffset += 512;
        }
        return { nextTs: null, nextOffset: fileSize };
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
        const command = `docker ps -q --filter "label=com.docker.compose.project=${serviceName}" --filter "status=running"`;

        try {
            const { stdout, stderr } = await execAsync(command, {
                env: process.env, 
                shell: '/bin/bash',
                encoding: 'utf-8',
            });

            if (stderr) {
                console.error(`Stderr checking service ${serviceName}: ${stderr.toString()}`);
            }

            return stdout.trim().length > 0;

        } catch (error) {
            console.error(`Error occurred while checking status (Service: ${serviceName}): ${error.message}`);
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
     * @param {Object} envData 
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async writeServiceEnvConfig(serviceName, envData) {
        if (!(await this.#checkServiceExists(serviceName))) return { success: false, message: 'Service not found' };
        
        let envPath = path.join(this.#containerDir, serviceName, '.env');
        try {
            let existingEnv = {};
            if (fs.existsSync(envPath)) {
                existingEnv = await EnvUtils.loadFromPath(envPath);
            }

            const mergedEnv = { ...existingEnv, ...envData };
            const envString = stringify(mergedEnv);

            await fs.promises.writeFile(envPath, envString, 'utf-8');

            return { success: true, message: 'Environment configuration updated successfully.' };

        } catch (error) {
            console.error(`Error writing .env for service "${serviceName}": ${error.message}`);
            return { success: false, message: `Error writing .env: ${error.message}` };
        }
    }

    async getServiceConfigData(serviceName) {
        if (!(await this.#checkServiceExists(serviceName))) return {};
        
        try {
            const serviceDir = path.join(this.#containerDir, serviceName);
            const configData = await ConfigUtils.getConfigData(serviceDir);
            return configData;
        }
        catch (error) {
            console.error(`Error getting config data for service "${serviceName}": ${error.message}`);
            return {"error": true, "message": error.message};
        }
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
        logFiles = logFiles.filter(file => 
            fs.statSync(path.join(targetDir, file)).isFile() && !file.endsWith('.timecache')
        );
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
    async monitorServiceLogs(serviceName, logFileName, onLineCallback, search = '') {
        if (!(await this.#checkServiceExists(serviceName))) return () => {};

        let logFilePath = path.join(this.#containerDir, serviceName, 'logs', logFileName);
        if (!fs.existsSync(logFilePath)) {
            console.error(`Error: Log file "${logFileName}" not found for service "${serviceName}"`);
            return () => {};
        }

        const tailOptions = {
            fromBeginning: false,
            follow: true,
            useWatchFile: false,
        };
        
        const tailInstance = new tail(logFilePath, tailOptions);
        tailInstance.on("line", function(line) {
            if (!search || line.includes(search)) {
                onLineCallback(line);
            }
        });
        
        tailInstance.on("error", function(error) {
            console.error(`Error while tailing log file "${logFileName}" for service "${serviceName}": ${error.message}`);
        });

        tailInstance.watch();

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
     * Efficiently search log file using Binary Search on file bytes.
     * 
     * @param {string} serviceName 
     * @param {string} logFileName
     * @param {string|Date} startTime
     * @param {string|Date} endTime
     * @param {number} [limit=1000] - The maximum number of lines to return.
     * @param {number} [offset=0] - The starting offset for pagination.
     * @return {Promise<{lines: string[], total: number}>}
     */
   async searchLogLinesByTimeRange(serviceName, logFileName, startTime, endTime, limit = 1000, offset = 0, search = '') {
       if (!(await this.#checkServiceExists(serviceName))) return { lines: [], total: 0 };

       const logFilePath = path.join(this.#containerDir, serviceName, 'logs', logFileName);
       if (!fs.existsSync(logFilePath)) {
           console.error(`Error: Log file "${logFileName}" not found`);
           return { lines: [], total: 0 };
       }

       const startTs = startTime ? new Date(startTime).getTime() : null;
       const endTs = endTime ? new Date(endTime).getTime() : null;

       if ((startTime && isNaN(startTs)) || (endTime && isNaN(endTs))) {
           console.error('Error: Invalid time format');
           return { lines: [], total: 0 };
       }
 
       let fileHandle = null;
       try {
           fileHandle = await fs.promises.open(logFilePath, 'r');
           const stats = await fileHandle.stat();
           const fileSize = stats.size;
 
           const startOffset = startTs ? await this.#findOffsetByTime(fileHandle, fileSize, startTs, true) : 0;
           const endOffset = endTs ? await this.#findOffsetByTime(fileHandle, fileSize, endTs + 1, false, startOffset) : fileSize;

           const readLength = endOffset - startOffset;
           if (readLength <= 0) return { lines: [], total: 0 };

           const buffer = Buffer.alloc(readLength);
           await fileHandle.read(buffer, 0, readLength, startOffset);
           
           const content = buffer.toString('utf-8');
           let allLines = content.split('\n').filter(line => line.trim().length > 0);

           if (search) {
               allLines = allLines.filter(line => line.includes(search));
           }

           const total = allLines.length;
           const paginatedLines = allLines.slice(offset, offset + limit);

           return { lines: paginatedLines, total: total };

       } catch (error) {
           console.error(`Error searching logs: ${error.message}`);
           return { lines: [], total: 0 };
       } finally {
           if (fileHandle) await fileHandle.close();
       }
   }

    

    /**
     * Find the first valid timestamp in the file.
     * @param {fs.FileHandle} fileHandle 
     * @param {number} fileSize 
     * @returns {Promise<number|null>} Timestamp or null
     */
    async #findFirstTimestamp(fileHandle, fileSize) {
        // Scan up to 50KB from start to find a timestamp
        const SCAN_LIMIT = 50 * 1024;
        const scanSize = Math.min(fileSize, SCAN_LIMIT);
        
        try {
            const { nextTs } = await this.#scanForwardForTime(fileHandle, 0, scanSize);
            return nextTs;
        } catch (error) {
            console.error('Error finding first timestamp:', error);
            return null;
        }
    }

    /**
     * Find the last valid timestamp in the file.
     * @param {fs.FileHandle} fileHandle 
     * @param {number} fileSize 
     * @returns {Promise<number|null>} Timestamp or null
     */
    async #findLastTimestamp(fileHandle, fileSize) {
        // We'll read chunks from the end backwards
        const CHUNK_SIZE = 10 * 1024; // 10KB
        let position = fileSize;
        
        // Scan up to 50KB from end? Or more? Let's try reasonable amount.
        const MAX_SCAN_BACK = 100 * 1024; // 100KB
        const minPos = Math.max(0, fileSize - MAX_SCAN_BACK);

        while (position > minPos) {
            const readSize = Math.min(CHUNK_SIZE, position - minPos);
            const startOffset = position - readSize;
            
            const buffer = Buffer.alloc(readSize);
            await fileHandle.read(buffer, 0, readSize, startOffset);
            const chunk = buffer.toString('utf-8');
            
            // We want to find the *last* timestamp in this chunk.
            const lines = chunk.split('\n');
            const tz = moment.tz.guess();
            
            // Iterate backwards
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                // Regex from #extractTimeAtOffset but strict
                const timeRegex = /^(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (?:AM|PM))/;
                const match = line.match(timeRegex);
                
                if (match) {
                    const dateString = match[1];
                    const ts = moment.tz(dateString, "MM/DD/YYYY, hh:mm:ss A", tz).valueOf();
                    if (!isNaN(ts)) {
                        return ts;
                    }
                }
            }

            position -= readSize;
        }
        
        return null;
    }
/**
     * Read the signature of the file header (used to determine if the file has been truncated)
     * @param {fs.FileHandle} fileHandle
     * @returns {Promise<string>}
     */
    async #getFileHeaderSignature(fileHandle) {
        const buffer = Buffer.alloc(64); // Read the first 64 bytes as the signature
        const { bytesRead } = await fileHandle.read(buffer, 0, 64, 0);
        if (bytesRead === 0) return '';
        // Convert to base64 or string storage is fine, here using hex to avoid newline issues affecting JSON
        return buffer.slice(0, bytesRead).toString('hex');
    }

    /**
     * Get start and end time of a log file, utilising caching.
     * @param {string} serviceName 
     * @param {string} logFileName 
     * @returns {Promise<{start: number|null, end: number|null}>}
     */
    async getLogFileTimeRange(serviceName, logFileName) {
        if (!(await this.#checkServiceExists(serviceName))) return { start: null, end: null };

        const logFilePath = path.join(this.#containerDir, serviceName, 'logs', logFileName);
        const cacheFilePath = path.join(this.#containerDir, serviceName, 'logs', `${logFileName}.timecache`);

        if (!fs.existsSync(logFilePath)) {
            return { start: null, end: null };
        }

        let cache = { 
            start: null, 
            end: null, 
            size: 0, 
            inode: 0,      // Check if file entity has changed
            headerSig: ''  // Check if file header signature has changed
        };

        try {
            if (fs.existsSync(cacheFilePath)) {
                const cacheContent = await fs.promises.readFile(cacheFilePath, 'utf-8');
                cache = JSON.parse(cacheContent);
            }
        } catch (e) {
            console.warn('Failed to read timecache:', e.message);
        }

        const isLogFile = logFileName.endsWith('.log');

        // Static files (rotated): if we have cache, return it.
        if (!isLogFile && cache.start != null && cache.end != null) {
            return { start: cache.start, end: cache.end };
        }

        let fileHandle = null;
        try {
            fileHandle = await fs.promises.open(logFilePath, 'r');
            const stats = await fileHandle.stat();
            const fileSize = stats.size;
            const inode = stats.ino;

            // Get signature of file header
            const currentHeaderSig = await this.#getFileHeaderSignature(fileHandle);

            let needsStart = cache.start == null;
            let needsEnd = cache.end == null;

            if (isLogFile) {
                let fileRotated = false;

                // Check 1: Inode changed (for mv/create type rotation)
                if (cache.inode && cache.inode !== inode) {
                    fileRotated = true;
                }

                // Check 2: File size decreased (for truncate before growing back)
                if (!fileRotated && cache.size && fileSize < cache.size) {
                    fileRotated = true;
                }

                // Check 3: File header signature changed (for truncate and growing back)
                if (!fileRotated && cache.headerSig && currentHeaderSig !== cache.headerSig) {
                    fileRotated = true;
                }

                if (fileRotated) {
                    // File rotated, invalidate old cache
                    needsStart = true;
                    cache.start = null;
                    // If rotated file is still empty, HeaderSig may be empty string, that's fine
                }

                // Update End time if file size changed or rotated
                if (fileRotated || fileSize !== cache.size) {
                    needsEnd = true;
                    cache.size = fileSize;
                    cache.inode = inode;
                    cache.headerSig = currentHeaderSig;
                }
            }

            if (!needsStart && !needsEnd) {
                // No changes, return cached values
                return { start: cache.start, end: cache.end };
            }

            if (needsStart) {
                const startTs = await this.#findFirstTimestamp(fileHandle, fileSize);
                if (startTs !== null) {
                    cache.start = startTs;
                } else {
                    // If file is empty or no timestamp found, reset
                    cache.start = null;
                }
            }

            if (needsEnd) {
                const endTs = await this.#findLastTimestamp(fileHandle, fileSize);
                if (endTs !== null) {
                    cache.end = endTs;
                }
            }

            // Write cache back
            const cacheToSave = { 
                start: cache.start, 
                end: isLogFile ? null : cache.end, 
                size: cache.size,
                inode: cache.inode,
                headerSig: cache.headerSig
            };
            
            // For log files, we mainly rely on memory state to determine needsEnd,
            // but write cache to disk for cross-process or restart acceleration.
            
            await fs.promises.writeFile(cacheFilePath, JSON.stringify(cacheToSave), 'utf-8');

        } catch (error) {
            console.error(`Error calculating time range for ${logFileName}:`, error);
        } finally {
            if (fileHandle) await fileHandle.close();
        }

        return { start: cache.start, end: cache.end };
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