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
