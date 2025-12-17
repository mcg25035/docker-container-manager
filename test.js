require("dotenv").config();
let DockerModule = require("./dockerModule");
const ConfigUtils = require("./utils/configUtils");

/**
 * @typedef {() => Promise<void>} TestFunction
 */

let TestResult = Object.freeze({
    PASS: "PASS",
    FAIL: "FAIL",
    MANUALLY_VERIFY: "MANUALLY_VERIFY",
});

/**
 * @type {Array<TestFunction>}
 */
let tests = [
    async function testListServices() {
        let services = await DockerModule.listServices();
        console.log("Services:", services);
        return TestResult.MANUALLY_VERIFY;
    },
    async function testIsServiceUp() {
        let serviceName = "example_service";
        let isUp = await DockerModule.isServiceUp(serviceName);
        console.log(`Service ${serviceName} is up: ${isUp}`);
        return TestResult.MANUALLY_VERIFY;
    },
    async function testGetServicesConfig() {
        let service = ["test1", "test2", "rc-web-app", "rc-backend-dev"];

        for (let svc of service) {
            let config = await DockerModule.getServiceConfig(svc);
            console.log(`Config for ${svc}:`, config);
        }
        return TestResult.MANUALLY_VERIFY;
    },
    async function testGenerateConfig() {
       
        const internalConfigData = {
            service_name: "my-internal-service",
            network: {
                type: "internal",
                mappingDstIPv4: "172.30.0.1",
                mappingSrcPort: "8080",
                mappingDstPort: "8081",
                internalNetSegment: "172.28",
            },

        };

        
        const externalConfigData = {
            service_name: "my-external-service",
            network: {
                type: "external",
                externalIPv4: "23.146.248.87",
                externalIPv6: "2001:db8:0:1234::5678"
            },
        };
        ConfigUtils.generateConfig(internalConfigData, "/docker/test1")
        ConfigUtils.generateConfig(externalConfigData, "/docker/test2")
    },
    async function testGetServiceLogs() {
        const serviceName = "rc-backend-prod";
        console.log(`Fetching logs for service: ${serviceName}`);
        const logs = await DockerModule.getServiceLogs(serviceName);
        console.log(`Logs for ${serviceName}:`, logs);
        return TestResult.MANUALLY_VERIFY;
    },
    async function testGetServiceConfigData() {
        const serviceNames = ["test1", "test2"];
        for (let serviceName of serviceNames) {
            console.log(`Fetching config data for service: ${serviceName}`);
            const configData = await DockerModule.getServiceConfigData(serviceName);
            console.log(`Config data for ${serviceName}:`, configData);
        }
        return TestResult.MANUALLY_VERIFY;

    },
    async function testMonitorServiceLogs() {
        const serviceName = "rc-backend-prod";
        const logFileName = "app-2025-11-21_20-11-22.log.10";
        
        console.log(`Starting to monitor logs for ${serviceName} - ${logFileName}`);
        
        const stopMonitor = await DockerModule.monitorServiceLogs(serviceName, logFileName, (line) => {
            console.log(`[NEW LINE]: ${line}`);
        });

        console.log("Monitoring for 5 seconds...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        stopMonitor();
        console.log("Stopped monitoring.");
        return TestResult.MANUALLY_VERIFY;
    },
    async function testGetLogLines() {
        const serviceName = "rc-backend-prod";
        const logFileName = "app-2025-11-21_20-11-22.log";
        console.log(`Reading last 10 lines from ${serviceName}/${logFileName}`);
        const lines = await DockerModule.getLogLines(serviceName, logFileName, -10, 10);
        console.log(`Lines:`, lines);
        return TestResult.MANUALLY_VERIFY;
    },
    async function testSearchLogLinesByTimeRange() {
        const serviceName = "rc-backend-prod";
        // Please ensure this file contains logs for the target dates
        const logFileName = "app-2025-11-21_20-11-22.log"; 
        
        const startTime = "11/20/2025, 11:30:00 PM"; 
        const endTime = "11/21/2025, 1:00:00 AM";

        console.log(`🔎 Searching logs for ${serviceName} -> ${logFileName}`);
        console.log(`   Range: ${startTime} ~ ${endTime}`);

        const searchStart = Date.now();
        const lines = await DockerModule.searchLogLinesByTimeRange(serviceName, logFileName, startTime, endTime);
        const duration = Date.now() - searchStart;

        console.log(`✅ Search completed in ${duration}ms. Found ${lines.length} lines.`);
        
        if (lines.length > 0) {
            console.log(`[First Line]: ${lines[0]}`);
            console.log(`[Last Line]:  ${lines[lines.length - 1]}`);
        }
        
        return TestResult.MANUALLY_VERIFY;
    },
    async function testWriteEnvConfig() {
        const serviceName = "test1";
        const envConfig = {
            MODE: "production",
            NODE_VERSION: 20,
            GIT_REPO_URL: "https://github.com/example/repo",
            GIT_BRANCH: "main",
            RUNNER_TOKEN: "new_secure_token_12345",
            NODE_INIT_COMMAND: "npm install",
            STARTUP_COMMAND: "node server.js",
            ENV_FILE: ".env.production",
            TZ: "Asia/Taipei"
        };
        
        console.log(`Writing .env config for service: ${serviceName}`);
        await DockerModule.writeServiceEnvConfig(serviceName, envConfig);
        console.log(`.env config written successfully.`);
        return TestResult.MANUALLY_VERIFY;
    },
    async function testGetLogFileTimeRange() {
        const serviceName = "rc-backend-prod"; 
        // Use a file that is likely to exist based on other tests
        const logFileName = "app-2025-11-21_20-11-22.log";
        const rotatedLogFileName = "app-2025-11-21_20-11-22.log.10";

        console.log(`Getting time range for ${serviceName}/${logFileName}`);
        const range = await DockerModule.getLogFileTimeRange(serviceName, logFileName);
        console.log(`Time Range for ${logFileName}:`, range);

        console.log(`Getting time range for ${serviceName}/${rotatedLogFileName}`);
        const rangeRotated = await DockerModule.getLogFileTimeRange(serviceName, rotatedLogFileName);
        console.log(`Time Range for ${rotatedLogFileName}:`, rangeRotated);
        
        return TestResult.MANUALLY_VERIFY;
    }
    
];

async function runTests() {
    for (let i = 0; i < tests.length; i++) {
        let testFunc = tests[i];
        let result;
        console.log(`⏳ Running Test ${i + 1}...`);
        try {
            result = await testFunc();
        } catch (error) {
            result = TestResult.FAIL;
            console.error(`⚠️ Test ${i + 1} threw an error: ${error.message}`);
        }

        if (result === TestResult.FAIL) {
            console.log(`🚩 Test ${i + 1} failed.`);
        } else if (result === TestResult.PASS) {
            console.log(`✅ Test ${i + 1} passed.`);
        } else if (result === TestResult.MANUALLY_VERIFY) {
            console.log(`🔍 Test ${i + 1} requires manual verification.`);
        }
    }
}

runTests();
