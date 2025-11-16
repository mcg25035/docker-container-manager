require('dotenv').config();
let DockerModule = require('./dockerModule');

/**
 * @typedef {() => Promise<void>} TestFunction
 */

let TestResult = Object.freeze({
    PASS: 'PASS',
    FAIL: 'FAIL',
    MANUALLY_VERIFY: 'MANUALLY_VERIFY',
});

/**
 * @type {Array<TestFunction>}
 */
let tests = [
    async function testListServices() {
        let services = await DockerModule.listServices();
        console.log('Services:', services);
        return TestResult.MANUALLY_VERIFY;
    },
    async function testIsServiceUp() {
        let serviceName = 'example_service'; 
        let isUp = await DockerModule.isServiceUp(serviceName);
        console.log(`Service ${serviceName} is up: ${isUp}`);
        return TestResult.MANUALLY_VERIFY;
    },
    async function testGetServicesConfig() {
        let service = [
            'filebrowser',
            'rc-web-app',
            'rc-backend-dev',
        ]

        for (let svc of service) {
            let config = await DockerModule.getServiceConfig(svc);
            console.log(`Config for ${svc}:`, config);
        }
        return TestResult.MANUALLY_VERIFY;
    },
]


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
        }
        else if (result === TestResult.PASS) {
            console.log(`✅ Test ${i + 1} passed.`);
        }
        else if (result === TestResult.MANUALLY_VERIFY) {
            console.log(`🔍 Test ${i + 1} requires manual verification.`);
        }
    }
}

runTests();